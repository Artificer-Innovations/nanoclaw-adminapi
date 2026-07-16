/** Env + defaults for the admin API (no host imports — unit-testable). */

export const DEFAULT_BIND = '127.0.0.1';
export const DEFAULT_PORT = 3210;
export const DEFAULT_BASE_PATH = '/internal/admin';

export interface AdminApiConfig {
  enabled: boolean;
  token: string;
  bind: string;
  port: number;
  basePath: string;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no' && v !== 'off';
}

function normalizeBasePath(raw: string): string {
  let path = raw.trim() || DEFAULT_BASE_PATH;
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/**
 * Resolve config from process.env overlays plus optional .env map
 * (host `readEnvFile` result). process.env wins.
 */
export function resolveAdminApiConfig(
  processEnv: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = {},
): AdminApiConfig {
  const get = (key: string): string | undefined =>
    processEnv[key] || fileEnv[key] || undefined;

  const enabledRaw = get('ADMINAPI_ENABLED');
  const token = get('ADMINAPI_TOKEN') || get('NANOCLAW_ADMINAPI_TOKEN') || '';
  const bind = get('ADMINAPI_BIND') || DEFAULT_BIND;
  const portRaw = get('ADMINAPI_PORT') || String(DEFAULT_PORT);
  const port = Number.parseInt(portRaw, 10);
  const basePath = normalizeBasePath(get('ADMINAPI_BASE_PATH') || DEFAULT_BASE_PATH);

  return {
    enabled: truthy(enabledRaw),
    token,
    bind,
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    basePath,
  };
}

export function assertConfigReady(config: AdminApiConfig): void {
  if (!config.enabled) return;
  if (!config.token) {
    throw new Error(
      'ADMINAPI_ENABLED is set but ADMINAPI_TOKEN (or NANOCLAW_ADMINAPI_TOKEN) is missing — refusing to start',
    );
  }
}
