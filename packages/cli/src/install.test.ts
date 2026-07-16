import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyAdapterFiles,
  findAdminApiBootInsertIndex,
  hasAdminApiBootBlock,
  insertAdminApiBootBlock,
  removeAdminApiBootBlock,
  removeAdapterFiles,
  scaffoldEnv,
  removeEnvVars,
} from './patch.js';
import { ADMINAPI_BOOT_BLOCK, findNanoclawRoot, packageRoot } from './paths.js';
import { runInstall, runUninstall, runVerify } from './install.js';
import { parseArgs, runCommand } from './bin.js';

const tmpDirs: string[] = [];

function makeHost(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adminapi-host-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'src/channels'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/channels/index.ts'), 'export {};\n');
  fs.writeFileSync(
    path.join(dir, 'src/index.ts'),
    `async function main() {
  await startCliServer();

  await initChannelAdapters(() => ({}));
}
`,
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'host-fixture', private: true, type: 'module' }, null, 2),
  );
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('paths', () => {
  it('locates package root', () => {
    expect(packageRoot()).toContain('nanoclaw-adminapi');
  });

  it('finds nanoclaw root from nested cwd', () => {
    const host = makeHost();
    const nested = path.join(host, 'a/b');
    fs.mkdirSync(nested, { recursive: true });
    expect(findNanoclawRoot(nested)).toBe(host);
  });
});

describe('boot patch', () => {
  it('inserts after startCliServer', () => {
    const content = `async function main() {
  await startCliServer();

  log.info('done');
}
`;
    const idx = findAdminApiBootInsertIndex(content);
    expect(idx).toBeGreaterThan(0);
    const updated = `${content.slice(0, idx)}\n${ADMINAPI_BOOT_BLOCK}\n${content.slice(idx)}`;
    expect(hasAdminApiBootBlock(updated)).toBe(true);
  });

  it('inserts and removes boot block on host', () => {
    const host = makeHost();
    expect(insertAdminApiBootBlock(host)).toBe(true);
    expect(insertAdminApiBootBlock(host)).toBe(false);
    expect(removeAdminApiBootBlock(host)).toBe(true);
    expect(removeAdminApiBootBlock(host)).toBe(false);
  });
});

describe('install / uninstall / verify', () => {
  it('copies adapter, scaffolds env, verifies, uninstalls', () => {
    const host = makeHost();
    const result = runInstall(host);
    expect(result.copied.length).toBeGreaterThanOrEqual(5);
    expect(fs.existsSync(path.join(host, 'src/adminapi-boot.ts'))).toBe(true);
    expect(fs.existsSync(path.join(host, '.claude/skills/add-adminapi/SKILL.md'))).toBe(true);
    expect(result.env.created).toContain('ADMINAPI_TOKEN');

    // Fail closed: install must not enable the API on its own.
    const envAfter = fs.readFileSync(path.join(host, '.env'), 'utf8');
    expect(envAfter).toContain('ADMINAPI_ENABLED=false');

    const verify = runVerify(host);
    expect(verify.ok).toBe(true);

    const un = runUninstall(host);
    expect(un.removedFiles.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(host, 'src/adminapi-boot.ts'))).toBe(false);
  });

  it('scaffoldEnv skips existing keys', () => {
    const host = makeHost();
    fs.writeFileSync(path.join(host, '.env'), 'ADMINAPI_ENABLED=false\n');
    const first = scaffoldEnv(host);
    expect(first.skipped).toContain('ADMINAPI_ENABLED');
    expect(first.created).toContain('ADMINAPI_TOKEN');
    const second = scaffoldEnv(host);
    expect(second.created).toHaveLength(0);
    const removed = removeEnvVars(host);
    expect(removed).toContain('ADMINAPI_TOKEN');
  });

  it('copyAdapterFiles throws when resources missing', () => {
    const host = makeHost();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'adminapi-empty-'));
    tmpDirs.push(empty);
    expect(() => copyAdapterFiles(host, empty)).toThrow(/Missing adapter/);
  });

  it('removeAdapterFiles is idempotent', () => {
    const host = makeHost();
    expect(removeAdapterFiles(host)).toEqual([]);
  });
});

describe('CLI', () => {
  it('parseArgs reads command and --path', () => {
    expect(parseArgs(['node', 'bin', 'install', '--path', '/tmp/x'])).toEqual({
      command: 'install',
      path: '/tmp/x',
    });
  });

  it('help exits 0', () => {
    expect(runCommand(['node', 'bin', 'help'])).toBe(0);
  });

  it('unknown command exits 1', () => {
    expect(runCommand(['node', 'bin', 'nope'])).toBe(1);
  });
});
