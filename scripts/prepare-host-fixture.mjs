#!/usr/bin/env node
/**
 * Build a minimal NanoClaw host skeleton for CLI integration tests.
 * Does not require a full nanoclaw checkout — enough for install/verify/uninstall.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, 'test/fixtures/nanoclaw-host');

function write(relativePath, content) {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

fs.rmSync(fixtureRoot, { recursive: true, force: true });
fs.mkdirSync(fixtureRoot, { recursive: true });

write(
  'package.json',
  `${JSON.stringify(
    {
      name: 'nanoclaw-host-fixture',
      private: true,
      type: 'module',
      scripts: { build: 'echo ok' },
    },
    null,
    2,
  )}\n`,
);

write('src/channels/index.ts', `export {};\n`);

write(
  'src/index.ts',
  `async function main() {
  await startCliServer();

  await initChannelAdapters(() => ({}));
  console.log('NanoClaw running');
}

declare function startCliServer(): Promise<void>;
declare function initChannelAdapters(factory: unknown): Promise<void>;

void main();
`,
);

write('src/env.ts', `export function readEnvFile(_keys: string[]): Record<string, string> { return {}; }\n`);
write('src/log.ts', `export const log = { info() {}, debug() {}, error() {}, warn() {} };\n`);

console.log(`Wrote fixture → ${path.relative(root, fixtureRoot)}`);
