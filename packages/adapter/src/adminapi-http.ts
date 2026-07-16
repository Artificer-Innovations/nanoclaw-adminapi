/**
 * Pure HTTP router for the admin API. Host-coupled group logic is injected
 * via GroupsBackend so this module stays unit-testable without NanoClaw.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface GroupRecord {
  id: string;
  name: string;
  folder: string;
  created_at?: string;
  config?: Record<string, unknown> | null;
  warnings?: string[];
  [key: string]: unknown;
}

export interface GroupsBackend {
  list(): Promise<GroupRecord[]>;
  get(id: string): Promise<GroupRecord | null>;
  create(body: { name: string; folder: string; template?: string }): Promise<GroupRecord>;
  update(id: string, body: { name: string }): Promise<GroupRecord>;
  delete(id: string): Promise<unknown>;
  getConfig(id: string): Promise<Record<string, unknown> | null>;
  updateConfig(id: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  restart(id: string, opts?: { rebuild?: boolean }): Promise<unknown>;
}

export interface AdminHttpOptions {
  token: string;
  basePath: string;
  backend: GroupsBackend;
}

export class AdminHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminHttpError';
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: code, message });
}

function extractBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AdminHttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminHttpError(400, 'invalid_body', 'Request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new AdminHttpError(400, 'validation_error', `\`${key}\` is required and must be a non-empty string`);
  }
  return v.trim();
}

/** Strip basePath; return remaining path starting with / (or "/" if exact). */
export function stripBasePath(urlPath: string, basePath: string): string | null {
  const pathOnly = urlPath.split('?')[0] || '/';
  if (pathOnly === basePath || pathOnly === `${basePath}/`) return '/';
  if (pathOnly.startsWith(`${basePath}/`)) {
    return pathOnly.slice(basePath.length) || '/';
  }
  return null;
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AdminHttpOptions,
): Promise<void> {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://localhost');
    const rel = stripBasePath(url.pathname, opts.basePath);
    if (rel == null) {
      sendError(res, 404, 'not_found', 'Not found');
      return;
    }

    const bearer = extractBearer(req);
    if (!bearer || bearer !== opts.token) {
      sendError(res, 401, 'unauthorized', 'Missing or invalid bearer token');
      return;
    }

    if (method === 'GET' && rel === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && rel === '/groups') {
      const groups = await opts.backend.list();
      sendJson(res, 200, groups);
      return;
    }

    if (method === 'POST' && rel === '/groups') {
      const body = asRecord(await readJsonBody(req));
      const name = requireString(body, 'name');
      const folder = requireString(body, 'folder');
      const template = typeof body.template === 'string' ? body.template.trim() : undefined;
      const created = await opts.backend.create({ name, folder, template: template || undefined });
      sendJson(res, 201, created);
      return;
    }

    const groupMatch = /^\/groups\/([^/]+)(.*)$/.exec(rel);
    if (!groupMatch) {
      sendError(res, 404, 'not_found', 'Not found');
      return;
    }

    const id = decodeURIComponent(groupMatch[1]);
    const rest = groupMatch[2] || '';

    if (rest === '' || rest === '/') {
      if (method === 'GET') {
        const group = await opts.backend.get(id);
        if (!group) {
          sendError(res, 404, 'not_found', `group not found: ${id}`);
          return;
        }
        sendJson(res, 200, group);
        return;
      }
      if (method === 'PATCH') {
        const body = asRecord(await readJsonBody(req));
        if (body.folder !== undefined) {
          throw new AdminHttpError(400, 'immutable_folder', 'folder cannot be changed');
        }
        const name = requireString(body, 'name');
        const updated = await opts.backend.update(id, { name });
        sendJson(res, 200, updated);
        return;
      }
      if (method === 'DELETE') {
        const result = await opts.backend.delete(id);
        sendJson(res, 200, result);
        return;
      }
    }

    if (rest === '/config' || rest === '/config/') {
      if (method === 'GET') {
        const config = await opts.backend.getConfig(id);
        if (!config) {
          sendError(res, 404, 'not_found', `config not found for group: ${id}`);
          return;
        }
        sendJson(res, 200, config);
        return;
      }
      if (method === 'PATCH') {
        const body = asRecord(await readJsonBody(req));
        const updated = await opts.backend.updateConfig(id, body);
        sendJson(res, 200, updated);
        return;
      }
    }

    if ((rest === '/restart' || rest === '/restart/') && method === 'POST') {
      const body = asRecord(await readJsonBody(req).catch(() => ({})));
      const rebuild = body.rebuild === true || body.rebuild === 'true';
      const result = await opts.backend.restart(id, { rebuild });
      sendJson(res, 200, result);
      return;
    }

    sendError(res, 404, 'not_found', 'Not found');
  } catch (err) {
    if (err instanceof AdminHttpError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    if (lower.includes('not found')) {
      sendError(res, 404, 'not_found', message);
      return;
    }
    if (lower.includes('already exists') || lower.includes('unique') || lower.includes('duplicate')) {
      sendError(res, 409, 'conflict', message);
      return;
    }
    sendError(res, 500, 'internal_error', message);
  }
}
