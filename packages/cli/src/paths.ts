import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of the published nanoclaw-adminapi package. */
export function packageRoot(startDir: string = __dirname): string {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name === 'nanoclaw-adminapi') {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate nanoclaw-adminapi package root');
}

export function skillDir(startDir: string = __dirname): string {
  return path.join(packageRoot(startDir), 'skills/add-adminapi');
}

/** Canonical adapter source in the monorepo. */
export function adapterSrcDir(startDir: string = __dirname): string {
  return path.join(packageRoot(startDir), 'packages/adapter/src');
}

/**
 * Directory to copy adapter files from.
 * Monorepo: packages/adapter/src
 * Published npm package: skills/add-adminapi/resources (synced at build time)
 */
export function resourcesDir(startDir: string = __dirname, nanoclawRoot?: string): string {
  const adapterSrc = adapterSrcDir(startDir);
  if (fs.existsSync(path.join(adapterSrc, 'adminapi-boot.ts'))) {
    return adapterSrc;
  }
  if (nanoclawRoot) {
    const linked = resolveLinkedAdapterSrc(nanoclawRoot);
    if (linked) return linked;
  }
  return path.join(skillDir(startDir), 'resources');
}

export function resolveLinkedAdapterSrc(nanoclawRoot: string): string | null {
  const pkgPath = path.join(nanoclawRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dep =
    pkg.dependencies?.['nanoclaw-adminapi'] ?? pkg.devDependencies?.['nanoclaw-adminapi'];
  if (!dep?.startsWith('file:')) return null;
  const linkedRoot = path.resolve(nanoclawRoot, dep.slice('file:'.length));
  const adapterSrc = path.join(linkedRoot, 'packages/adapter/src');
  if (fs.existsSync(path.join(adapterSrc, 'adminapi-boot.ts'))) return adapterSrc;
  return null;
}

export interface AdapterCopyRule {
  source: string;
  dest: string;
}

/** Host-copied files (tests optional — only copied when present in resources). */
export const ADAPTER_COPY_RULES: AdapterCopyRule[] = [
  { source: 'adminapi-config.ts', dest: 'src/adminapi-config.ts' },
  { source: 'adminapi-http.ts', dest: 'src/adminapi-http.ts' },
  { source: 'adminapi-groups.ts', dest: 'src/adminapi-groups.ts' },
  { source: 'adminapi.ts', dest: 'src/adminapi.ts' },
  { source: 'adminapi-boot.ts', dest: 'src/adminapi-boot.ts' },
];

export const ADAPTER_OPTIONAL_COPY_RULES: AdapterCopyRule[] = [
  { source: 'adminapi-http.test.ts', dest: 'src/adminapi-http.test.ts' },
];

export const ADMINAPI_BOOT_BLOCK = `  const { startAdminApi } = await import('./adminapi-boot.js');
  await startAdminApi();`;

export const REQUIRED_ADAPTER_FILES = ADAPTER_COPY_RULES.map((r) => r.dest);

export function findNanoclawRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const channelsIndex = path.join(dir, 'src/channels/index.ts');
    const hostIndex = path.join(dir, 'src/index.ts');
    if (fs.existsSync(channelsIndex) && fs.existsSync(hostIndex)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'NanoClaw root not found (expected src/channels/index.ts and src/index.ts). Use --path.',
  );
}

export function readPackageVersion(): string {
  const pkgPath = path.join(packageRoot(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}
