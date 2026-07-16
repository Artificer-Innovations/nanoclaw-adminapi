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

export async function startAdminApiServer(config: AdminApiConfig): Promise<http.Server> {
  if (server) return server;

  const backend = createHostGroupsBackend();
  server = http.createServer((req, res) => {
    void handleAdminRequest(req, res, {
      token: config.token,
      basePath: config.basePath,
      backend,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(config.port, config.bind, () => resolve());
  });

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
