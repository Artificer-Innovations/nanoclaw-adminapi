#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bin = path.join(root, 'dist/cli/bin.js');

if (!fs.existsSync(bin)) {
  console.error('Missing dist/cli/bin.js — CLI build failed');
  process.exit(1);
}

const resources = path.join(root, 'skills/add-adminapi/resources/adminapi-boot.ts');
if (!fs.existsSync(resources)) {
  console.error('Missing skills/add-adminapi/resources — sync-adapter-resources failed');
  process.exit(1);
}

console.log('Publish entry OK');
