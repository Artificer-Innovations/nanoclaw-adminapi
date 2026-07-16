#!/usr/bin/env node
/**
 * Sync packages/adapter/src → skills/add-adminapi/resources for the npm publish bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'packages/adapter/src');
const destDir = path.join(root, 'skills/add-adminapi/resources');

fs.mkdirSync(destDir, { recursive: true });

// Clear previous synced resources (keep directory)
for (const name of fs.readdirSync(destDir)) {
  fs.rmSync(path.join(destDir, name), { recursive: true, force: true });
}

for (const name of fs.readdirSync(srcDir)) {
  if (!name.endsWith('.ts')) continue;
  // Skip unit tests in the published resources bundle (optional copy still supported from monorepo)
  if (name.endsWith('.test.ts')) continue;
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
}

console.log(`Synced adapter resources → ${path.relative(root, destDir)}`);
