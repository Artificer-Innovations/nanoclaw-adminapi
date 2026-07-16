#!/usr/bin/env node
/**
 * Integration: build package → prepare fixture → CLI install → verify → uninstall.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${cmd} ${args.join(' ')} failed with ${result.status}`);
  }
  return result;
}

console.log('Building package...');
run('pnpm', ['run', 'build']);

console.log('Preparing host fixture...');
run('node', ['scripts/prepare-host-fixture.mjs']);

const fixtureSrc = path.join(root, 'test/fixtures/nanoclaw-host');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'adminapi-integration-'));
fs.cpSync(fixtureSrc, work, { recursive: true });

console.log(`Workdir: ${work}`);

// Prefer file: link to monorepo so install can find packages/adapter/src
const pkgPath = path.join(work, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies = { ...(pkg.dependencies || {}), 'nanoclaw-adminapi': `file:${root}` };
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

run('pnpm', ['install'], { cwd: work });

const bin = path.join(root, 'dist/cli/bin.js');
run('node', [bin, 'install', '--path', work]);
run('node', [bin, 'verify', '--path', work]);

const boot = fs.readFileSync(path.join(work, 'src/index.ts'), 'utf8');
if (!boot.includes('startAdminApi')) {
  throw new Error('boot patch missing after install');
}
if (!fs.existsSync(path.join(work, 'src/adminapi-boot.ts'))) {
  throw new Error('adapter file missing after install');
}
if (!fs.existsSync(path.join(work, '.env'))) {
  throw new Error('.env missing after install');
}

run('node', [bin, 'uninstall', '--path', work]);
if (fs.existsSync(path.join(work, 'src/adminapi-boot.ts'))) {
  throw new Error('adapter file still present after uninstall');
}

fs.rmSync(work, { recursive: true, force: true });
console.log('Integration OK');
