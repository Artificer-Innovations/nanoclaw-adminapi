/**
 * Skill entry point — start the admin HTTP API when enabled.
 * Copied into the NanoClaw fork `src/`.
 */
import { assertConfigReady, resolveAdminApiConfig } from './adminapi-config.js';
import { startAdminApiServer } from './adminapi.js';
import { readEnvFile } from './env.js';
import { log } from './log.js';

export async function startAdminApi(): Promise<void> {
  const fileEnv = readEnvFile([
    'ADMINAPI_ENABLED',
    'ADMINAPI_TOKEN',
    'NANOCLAW_ADMINAPI_TOKEN',
    'ADMINAPI_BIND',
    'ADMINAPI_PORT',
    'ADMINAPI_BASE_PATH',
  ]);
  const config = resolveAdminApiConfig(process.env, fileEnv);

  if (!config.enabled) {
    log.info('Admin API disabled (ADMINAPI_ENABLED not set)');
    return;
  }

  assertConfigReady(config);
  await startAdminApiServer(config);
  log.info(`Admin API enabled — http://${config.bind}:${config.port}${config.basePath}`);
}
