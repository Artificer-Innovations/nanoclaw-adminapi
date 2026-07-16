import { describe, expect, it, vi } from 'vitest';
import { assertConfigReady, resolveAdminApiConfig } from './adminapi-config.js';
import {
  AdminHttpError,
  handleAdminRequest,
  MAX_BODY_BYTES,
  stripBasePath,
  type CreateResult,
  type GroupsBackend,
  type GroupRecord,
} from './adminapi-http.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function mockRes() {
  const headers: Record<string, string | number> = {};
  let statusCode = 0;
  let body = '';
  const res = {
    writeHead(status: number, h: Record<string, string | number>) {
      statusCode = status;
      Object.assign(headers, h);
    },
    end(chunk?: string) {
      body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return {
    res,
    get status() {
      return statusCode;
    },
    get json() {
      return body ? JSON.parse(body) : null;
    },
  };
}

function mockReq(opts: {
  method?: string;
  url?: string;
  authorization?: string;
  body?: unknown;
  rawChunks?: Buffer[];
}): IncomingMessage {
  const chunks =
    opts.rawChunks ??
    (opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))]);
  const req = {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/',
    headers: {
      authorization: opts.authorization,
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  } as unknown as IncomingMessage;
  return req;
}

function memoryBackend(seed: GroupRecord[] = []): GroupsBackend {
  const groups = new Map(seed.map((g) => [g.id, { ...g }]));
  return {
    async list() {
      return [...groups.values()];
    },
    async get(id) {
      return groups.get(id) ?? null;
    },
    async create(body): Promise<CreateResult> {
      for (const g of groups.values()) {
        if (g.folder === body.folder) return { group: { ...g, warnings: [] }, created: false };
      }
      const group: GroupRecord = {
        id: `ag-${groups.size + 1}`,
        name: body.name,
        folder: body.folder,
        created_at: '2026-01-01T00:00:00.000Z',
        config: null,
        warnings: [],
      };
      groups.set(group.id, group);
      return { group, created: true };
    },
    async update(id, body) {
      const g = groups.get(id);
      if (!g) throw new Error(`group not found: ${id}`);
      g.name = body.name;
      return g;
    },
    async delete(id) {
      if (!groups.has(id)) throw new Error(`group not found: ${id}`);
      groups.delete(id);
      return { deleted: id };
    },
    async getConfig(id) {
      if (!groups.has(id)) return null;
      return { provider: 'claude', model: 'opus' };
    },
    async updateConfig(id, body) {
      if (!groups.has(id)) throw new Error(`group not found: ${id}`);
      return { agent_group_id: id, ...body };
    },
    async restart(id) {
      if (!groups.has(id)) throw new Error(`group not found: ${id}`);
      return { restarted: id };
    },
  };
}

describe('resolveAdminApiConfig', () => {
  it('defaults to disabled localhost:3210', () => {
    const cfg = resolveAdminApiConfig({}, {});
    expect(cfg.enabled).toBe(false);
    expect(cfg.bind).toBe('127.0.0.1');
    expect(cfg.port).toBe(3210);
    expect(cfg.basePath).toBe('/internal/admin');
  });

  it('prefers process env over file env', () => {
    const cfg = resolveAdminApiConfig(
      { ADMINAPI_ENABLED: 'true', ADMINAPI_TOKEN: 'proc', ADMINAPI_PORT: '4000' },
      { ADMINAPI_TOKEN: 'file', ADMINAPI_PORT: '3210' },
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.token).toBe('proc');
    expect(cfg.port).toBe(4000);
  });

  it('assertConfigReady fails closed without token', () => {
    expect(() =>
      assertConfigReady({
        enabled: true,
        token: '',
        bind: '127.0.0.1',
        port: 3210,
        basePath: '/internal/admin',
        healthPublic: false,
      }),
    ).toThrow(/ADMINAPI_TOKEN/);
  });

  it('reads ADMINAPI_HEALTH_PUBLIC opt-in', () => {
    expect(resolveAdminApiConfig({}, {}).healthPublic).toBe(false);
    expect(
      resolveAdminApiConfig({ ADMINAPI_HEALTH_PUBLIC: 'true' }, {}).healthPublic,
    ).toBe(true);
  });
});

describe('stripBasePath', () => {
  it('strips configured prefix', () => {
    expect(stripBasePath('/internal/admin/groups', '/internal/admin')).toBe('/groups');
    expect(stripBasePath('/internal/admin', '/internal/admin')).toBe('/');
    expect(stripBasePath('/other', '/internal/admin')).toBeNull();
  });
});

describe('handleAdminRequest', () => {
  const token = 'secret-token';

  it('returns 401 without bearer', async () => {
    const out = mockRes();
    await handleAdminRequest(mockReq({ url: '/internal/admin/health' }), out.res, {
      token,
      basePath: '/internal/admin',
      backend: memoryBackend(),
    });
    expect(out.status).toBe(401);
    expect(out.json.error).toBe('unauthorized');
  });

  it('returns health when authorized', async () => {
    const out = mockRes();
    await handleAdminRequest(
      mockReq({ url: '/internal/admin/health', authorization: `Bearer ${token}` }),
      out.res,
      { token, basePath: '/internal/admin', backend: memoryBackend() },
    );
    expect(out.status).toBe(200);
    expect(out.json.ok).toBe(true);
  });

  it('creates and lists groups', async () => {
    const backend = memoryBackend();
    const createOut = mockRes();
    await handleAdminRequest(
      mockReq({
        method: 'POST',
        url: '/internal/admin/groups',
        authorization: `Bearer ${token}`,
        body: { name: 'Support', folder: 'support' },
      }),
      createOut.res,
      { token, basePath: '/internal/admin', backend },
    );
    expect(createOut.status).toBe(201);
    expect(createOut.json.folder).toBe('support');

    const listOut = mockRes();
    await handleAdminRequest(
      mockReq({ url: '/internal/admin/groups', authorization: `Bearer ${token}` }),
      listOut.res,
      { token, basePath: '/internal/admin', backend },
    );
    expect(listOut.status).toBe(200);
    expect(listOut.json).toHaveLength(1);
  });

  it('rejects folder changes on PATCH', async () => {
    const backend = memoryBackend([
      { id: 'ag-1', name: 'A', folder: 'a', warnings: [] },
    ]);
    const out = mockRes();
    await handleAdminRequest(
      mockReq({
        method: 'PATCH',
        url: '/internal/admin/groups/ag-1',
        authorization: `Bearer ${token}`,
        body: { name: 'B', folder: 'b' },
      }),
      out.res,
      { token, basePath: '/internal/admin', backend },
    );
    expect(out.status).toBe(400);
    expect(out.json.error).toBe('immutable_folder');
  });

  it('returns 200 (not 201) on idempotent folder reuse', async () => {
    const backend = memoryBackend([{ id: 'ag-1', name: 'A', folder: 'a', warnings: [] }]);
    const out = mockRes();
    await handleAdminRequest(
      mockReq({
        method: 'POST',
        url: '/internal/admin/groups',
        authorization: `Bearer ${token}`,
        body: { name: 'A', folder: 'a' },
      }),
      out.res,
      { token, basePath: '/internal/admin', backend },
    );
    expect(out.status).toBe(200);
    expect(out.json.folder).toBe('a');
  });

  it('maps typed AdminHttpError from backend to its status', async () => {
    const backend = memoryBackend();
    backend.delete = async () => {
      throw new AdminHttpError(404, 'not_found', 'group not found: missing');
    };
    const out = mockRes();
    await handleAdminRequest(
      mockReq({
        method: 'DELETE',
        url: '/internal/admin/groups/missing',
        authorization: `Bearer ${token}`,
      }),
      out.res,
      { token, basePath: '/internal/admin', backend },
    );
    expect(out.status).toBe(404);
  });

  it('returns generic 500 without leaking backend error detail', async () => {
    const backend = memoryBackend();
    backend.list = async () => {
      throw new Error('SQLITE_CONSTRAINT: agent_groups.folder internal detail');
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = mockRes();
    await handleAdminRequest(
      mockReq({ url: '/internal/admin/groups', authorization: `Bearer ${token}` }),
      out.res,
      { token, basePath: '/internal/admin', backend },
    );
    expect(out.status).toBe(500);
    expect(out.json.error).toBe('internal_error');
    expect(out.json.message).toBe('Internal server error');
    expect(JSON.stringify(out.json)).not.toContain('SQLITE');
    errSpy.mockRestore();
  });

  it('rejects oversized request bodies with 413', async () => {
    const backend = memoryBackend();
    const chunk = Buffer.alloc(256 * 1024, 0x61);
    const rawChunks = [chunk, chunk, chunk, chunk, chunk]; // > 1 MB
    const out = mockRes();
    await handleAdminRequest(
      mockReq({
        method: 'POST',
        url: '/internal/admin/groups',
        authorization: `Bearer ${token}`,
        rawChunks,
      }),
      out.res,
      { token, basePath: '/internal/admin', backend },
    );
    expect(out.status).toBe(413);
    expect(out.json.error).toBe('payload_too_large');
  });

  it('rejects malformed JSON on restart with 400', async () => {
    const backend = memoryBackend([{ id: 'ag-1', name: 'A', folder: 'a', warnings: [] }]);
    const out = mockRes();
    await handleAdminRequest(
      mockReq({
        method: 'POST',
        url: '/internal/admin/groups/ag-1/restart',
        authorization: `Bearer ${token}`,
        rawChunks: [Buffer.from('{not json')],
      }),
      out.res,
      { token, basePath: '/internal/admin', backend },
    );
    expect(out.status).toBe(400);
    expect(out.json.error).toBe('invalid_json');
  });

  it('serves public health without a token when healthPublic', async () => {
    const out = mockRes();
    await handleAdminRequest(
      mockReq({ url: '/internal/admin/health' }),
      out.res,
      { token, basePath: '/internal/admin', backend: memoryBackend(), healthPublic: true },
    );
    expect(out.status).toBe(200);
    expect(out.json.ok).toBe(true);
  });

  it('MAX_BODY_BYTES is 1 MB', () => {
    expect(MAX_BODY_BYTES).toBe(1024 * 1024);
  });

  it('returns 404 for unknown paths under base', async () => {
    const out = mockRes();
    await handleAdminRequest(
      mockReq({ url: '/internal/admin/nope', authorization: `Bearer ${token}` }),
      out.res,
      { token, basePath: '/internal/admin', backend: memoryBackend() },
    );
    expect(out.status).toBe(404);
  });
});

describe('AdminHttpError', () => {
  it('carries status and code', () => {
    const err = new AdminHttpError(400, 'validation_error', 'bad');
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_error');
  });
});
