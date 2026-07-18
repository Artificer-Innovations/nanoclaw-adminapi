/**
 * Pure HTTP router for the admin API. Host-coupled group logic is injected
 * via GroupsBackend so this module stays unit-testable without NanoClaw.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Max request body accepted before we reject with 413 (memory-DoS guard). */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface GroupRecord {
  id: string;
  name: string;
  folder: string;
  created_at?: string;
  config?: Record<string, unknown> | null;
  warnings?: string[];
  [key: string]: unknown;
}

/** Result of a create call: `created` distinguishes fresh vs idempotent reuse. */
export interface CreateResult {
  group: GroupRecord;
  created: boolean;
}

export interface GroupsBackend {
  list(): Promise<GroupRecord[]>;
  get(id: string): Promise<GroupRecord | null>;
  create(body: { name: string; folder: string; template?: string }): Promise<CreateResult>;
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
  /** When true, `GET /health` is served before auth (unauthenticated liveness). */
  healthPublic?: boolean;
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

/**
 * Error codes emitted by host ncl dispatch (`src/cli/frame.ts` in NanoClaw).
 * Mirrored here so this repo can typecheck and unit-test `mapDispatchError`
 * without the host sources; when the copied adapter compiles inside a host,
 * passing the host's real `ErrorCode` into `mapDispatchError` re-validates
 * that this union is still a superset of the host's.
 */
export type NclErrorCode =
  | 'unknown-command'
  | 'invalid-args'
  | 'forbidden'
  | 'approval-pending'
  | 'handler-error'
  | 'transport-error';

/**
 * Map an ncl dispatch error to an HTTP-facing error.
 * The host has no dedicated not-found code: missing resources arrive as
 * `handler-error` with a "<resource> not found: <id>" message (thrown by the
 * host's `src/cli/crud.ts` handlers, wrapped by `src/cli/dispatch.ts`), so
 * the 404 mapping keys off that message text. If the host ever rewords those
 * messages, the unit tests here pin the expected shape.
 */
export function mapDispatchError(code: NclErrorCode, message: string): Error {
  switch (code) {
    case 'invalid-args':
      return new AdminHttpError(400, 'validation_error', message);
    case 'forbidden':
      return new AdminHttpError(403, 'forbidden', message);
    case 'handler-error':
      if (/not found/i.test(message)) {
        return new AdminHttpError(404, 'not_found', message);
      }
      return new Error(message);
    default:
      // unknown-command / transport-error / approval-pending → unexpected for
      // a host caller; surface as a generic 500 (router logs it).
      return new Error(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  // JSON.stringify(undefined) returns undefined; coerce so Buffer.byteLength
  // never throws and responses are always valid JSON (e.g. void DELETE/restart).
  const payload = JSON.stringify(body ?? null);
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

/**
 * Constant-time bearer check. The token is root-equivalent for agent
 * lifecycle, so avoid `!==` which short-circuits and leaks length/prefix
 * timing that an attacker could use to reconstruct the secret.
 */
function tokenValid(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) {
      throw new AdminHttpError(413, 'payload_too_large', 'Request body exceeds 1 MB');
    }
    chunks.push(buf);
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

    // Optional unauthenticated liveness so reverse-proxy/LB probes don't need
    // the root-equivalent token. Opt-in via ADMINAPI_HEALTH_PUBLIC.
    if (opts.healthPublic && method === 'GET' && rel === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    const bearer = extractBearer(req);
    if (!bearer || !tokenValid(bearer, opts.token)) {
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
      const result = await opts.backend.create({ name, folder, template: template || undefined });
      // 201 only when a resource was actually created; idempotent folder reuse → 200.
      sendJson(res, result.created ? 201 : 200, result.group);
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
      // Parse like every other endpoint: malformed JSON → 400 (an empty body
      // is already treated as {}), rather than being silently swallowed.
      const body = asRecord(await readJsonBody(req));
      const rebuild = body.rebuild === true || body.rebuild === 'true';
      const result = await opts.backend.restart(id, { rebuild });
      sendJson(res, 200, result);
      return;
    }

    sendError(res, 404, 'not_found', 'Not found');
  } catch (err) {
    // Known conditions carry an explicit status/code (including typed errors
    // the backend raises by mapping ncl error codes). Everything else is an
    // unexpected failure: log the detail server-side, return a generic message
    // so internal DB/constraint strings never leak to the caller.
    if (err instanceof AdminHttpError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    console.error('[adminapi] unhandled request error', err);
    sendError(res, 500, 'internal_error', 'Internal server error');
  }
}
