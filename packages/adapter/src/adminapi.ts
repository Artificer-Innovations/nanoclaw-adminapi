/**
 * Standalone HTTP listener for the admin API.
 * Copied into the NanoClaw fork `src/`.
 */
import http from 'node:http';
import type { AdminApiConfig } from './adminapi-config.js';
import { createHostGroupsBackend } from './adminapi-groups.js';
import { handleAdminRequest } from './adminapi-http.js';
import { log } from './log.js';

let server: http.Server | null = null;

/** Drop stalled/slow clients so they can't hold connections open forever. */
const REQUEST_TIMEOUT_MS = 30_000;

export async function startAdminApiServer(config: AdminApiConfig): Promise<http.Server> {
  if (server) return server;

  const backend = createHostGroupsBackend();
  const candidate = http.createServer((req, res) => {
    void handleAdminRequest(req, res, {
      token: config.token,
      basePath: config.basePath,
      backend,
      healthPublic: config.healthPublic,
    });
  });
  candidate.requestTimeout = REQUEST_TIMEOUT_MS;
  candidate.timeout = REQUEST_TIMEOUT_MS;

  // Only publish the module-level singleton after listen succeeds. If listen
  // rejects (e.g. EADDRINUSE) `server` stays null so a later call retries
  // instead of returning a dead, non-listening server.
  await new Promise<void>((resolve, reject) => {
    candidate.once('error', reject);
    candidate.listen(config.port, config.bind, () => {
      candidate.removeListener('error', reject);
      resolve();
    });
  });
  server = candidate;

  log.info('Admin API listening', {
    bind: config.bind,
    port: config.port,
    basePath: config.basePath,
  });

  return server;
}

export async function stopAdminApiServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve, reject) => {
    s.close((err) => (err ? reject(err) : resolve()));
  });
}
