import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADAPTER_COPY_RULES,
  ADAPTER_OPTIONAL_COPY_RULES,
  ADMINAPI_BOOT_BLOCK,
  resourcesDir,
  skillDir,
} from './paths.js';

/** Keys written by scaffoldEnv — uninstall removes only these. */
export const SCAFFOLDED_ENV_KEYS = [
  'ADMINAPI_ENABLED',
  'ADMINAPI_PORT',
  'ADMINAPI_TOKEN',
] as const;

const ADMINAPI_BOOT_BLOCK_PATTERN =
  /^[ \t]*const \{ startAdminApi \} = await import\('\.\/adminapi-boot\.js'\);\r?\n^[ \t]*await startAdminApi\(\);\r?\n(?:\r?\n)?/m;

/** Insert index: immediately after `await startCliServer();` */
export function findAdminApiBootInsertIndex(content: string): number {
  const m = content.match(/^[ \t]*await startCliServer\(\);\r?\n/m);
  if (m?.index != null) return m.index + m[0].length;

  // Fallback: before initChannelAdapters (webchat-style hosts without CLI sock yet)
  const awaited = content.match(/^\s+await initChannelAdapters\(/m);
  if (awaited?.index != null) return awaited.index;

  const plain = content.match(/^\s+initChannelAdapters\(/m);
  if (plain?.index != null) return plain.index;

  return -1;
}

export function hasAdminApiBootBlock(content: string): boolean {
  return ADMINAPI_BOOT_BLOCK_PATTERN.test(content);
}

export function copyAdapterFiles(nanoclawRoot: string, resources?: string): string[] {
  const resolvedResources = resources ?? resourcesDir(undefined, nanoclawRoot);
  const missing: string[] = [];
  for (const rule of ADAPTER_COPY_RULES) {
    const from = path.join(resolvedResources, rule.source);
    if (!fs.existsSync(from)) missing.push(rule.source);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing adapter resource${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        'Run `pnpm run build` in nanoclaw-adminapi to sync skills/add-adminapi/resources.',
    );
  }

  const copied: string[] = [];
  for (const rule of [...ADAPTER_COPY_RULES, ...ADAPTER_OPTIONAL_COPY_RULES]) {
    const from = path.join(resolvedResources, rule.source);
    if (!fs.existsSync(from)) continue;
    const to = path.join(nanoclawRoot, rule.dest);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied.push(rule.dest);
  }
  return copied;
}

export function insertAdminApiBootBlock(nanoclawRoot: string): boolean {
  const filePath = path.join(nanoclawRoot, 'src/index.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  if (hasAdminApiBootBlock(content)) return false;
  const idx = findAdminApiBootInsertIndex(content);
  if (idx < 0) {
    throw new Error(
      'Could not find await startCliServer() or initChannelAdapters( in src/index.ts',
    );
  }
  const updated = `${content.slice(0, idx)}\n${ADMINAPI_BOOT_BLOCK}\n${content.slice(idx)}`;
  fs.writeFileSync(filePath, updated);
  return true;
}

export function removeAdminApiBootBlock(nanoclawRoot: string): boolean {
  const filePath = path.join(nanoclawRoot, 'src/index.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  if (!hasAdminApiBootBlock(content)) return false;
  fs.writeFileSync(filePath, content.replace(ADMINAPI_BOOT_BLOCK_PATTERN, ''));
  return true;
}

export function scaffoldEnv(nanoclawRoot: string): { created: string[]; skipped: string[] } {
  const envPath = path.join(nanoclawRoot, '.env');
  const created: string[] = [];
  const skipped: string[] = [];
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : [];
  const existing = new Set(lines.map((l) => l.split('=')[0]?.trim()).filter(Boolean));

  const additions: Record<string, string> = {
    ADMINAPI_ENABLED: 'true',
    ADMINAPI_PORT: '3210',
    ADMINAPI_TOKEN: randomBytes(16).toString('hex'),
  };

  for (const [key, value] of Object.entries(additions)) {
    if (existing.has(key)) {
      skipped.push(key);
      continue;
    }
    lines.push(`${key}=${value}`);
    created.push(key);
  }

  if (created.length > 0) {
    fs.writeFileSync(envPath, `${lines.join('\n').replace(/\n?$/, '')}\n`);
  }

  return { created, skipped };
}

export function removeEnvVars(nanoclawRoot: string): string[] {
  const envPath = path.join(nanoclawRoot, '.env');
  if (!fs.existsSync(envPath)) return [];
  const removed: string[] = [];
  const allowlist = new Set<string>(SCAFFOLDED_ENV_KEYS);
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const kept = lines.filter((line) => {
    const key = line.split('=')[0]?.trim();
    if (key && allowlist.has(key)) {
      removed.push(key);
      return false;
    }
    return true;
  });
  const body = kept.join('\n');
  fs.writeFileSync(envPath, `${body.replace(/\n?$/, '')}\n`);
  return removed;
}

export function syncSkillToFork(nanoclawRoot: string, skillSource = skillDir()): string {
  const dest = path.join(nanoclawRoot, '.claude/skills/add-adminapi');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyDir(skillSource, dest);
  return dest;
}

export function removeAdapterFiles(nanoclawRoot: string): string[] {
  const removed: string[] = [];
  for (const rule of [...ADAPTER_COPY_RULES, ...ADAPTER_OPTIONAL_COPY_RULES]) {
    const target = path.join(nanoclawRoot, rule.dest);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      removed.push(rule.dest);
    }
  }
  return removed;
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}
