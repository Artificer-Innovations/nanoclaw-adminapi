import { describe, expect, it } from 'vitest';
import { assertConfigReady, resolveAdminApiConfig } from './adminapi-config.js';
import {
  AdminHttpError,
  handleAdminRequest,
  stripBasePath,
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
}): IncomingMessage {
  const payload = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body));
  let consumed = false;
  const req = {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/',
    headers: {
      authorization: opts.authorization,
    },
    async *[Symbol.asyncIterator]() {
      if (payload && !consumed) {
        consumed = true;
        yield payload;
      }
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
    async create(body) {
      for (const g of groups.values()) {
        if (g.folder === body.folder) return { ...g, warnings: [] };
      }
      const created: GroupRecord = {
        id: `ag-${groups.size + 1}`,
        name: body.name,
        folder: body.folder,
        created_at: '2026-01-01T00:00:00.000Z',
        config: null,
        warnings: [],
      };
      groups.set(created.id, created);
      return created;
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
      }),
    ).toThrow(/ADMINAPI_TOKEN/);
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

  it('maps not-found backend errors to 404', async () => {
    const backend = memoryBackend();
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
