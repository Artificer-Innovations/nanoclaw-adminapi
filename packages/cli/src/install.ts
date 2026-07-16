import fs from 'node:fs';
import path from 'node:path';
import {
  copyAdapterFiles,
  insertAdminApiBootBlock,
  removeAdapterFiles,
  removeAdminApiBootBlock,
  removeEnvVars,
  scaffoldEnv,
  syncSkillToFork,
  hasAdminApiBootBlock,
} from './patch.js';
import {
  ADAPTER_COPY_RULES,
  findNanoclawRoot,
  readPackageVersion,
  REQUIRED_ADAPTER_FILES,
} from './paths.js';

export interface InstallResult {
  root: string;
  copied: string[];
  bootPatched: boolean;
  env: { created: string[]; skipped: string[] };
  version: string;
  skillPath: string;
}

export function runInstall(root?: string): InstallResult {
  const nanoclawRoot = root ?? findNanoclawRoot();
  console.log(`Detected NanoClaw root: ${nanoclawRoot}`);
  const skillPath = syncSkillToFork(nanoclawRoot);
  const copied = copyAdapterFiles(nanoclawRoot);
  const bootPatched = insertAdminApiBootBlock(nanoclawRoot);
  const env = scaffoldEnv(nanoclawRoot);
  return {
    root: nanoclawRoot,
    copied,
    bootPatched,
    env,
    version: readPackageVersion(),
    skillPath,
  };
}

export function runUpgrade(root?: string): InstallResult {
  return runInstall(root);
}

export function runUninstall(root?: string): {
  root: string;
  removedFiles: string[];
  bootRemoved: boolean;
  envRemoved: string[];
} {
  const nanoclawRoot = root ?? findNanoclawRoot();
  const removedFiles = removeAdapterFiles(nanoclawRoot);
  const bootRemoved = removeAdminApiBootBlock(nanoclawRoot);
  const envRemoved = removeEnvVars(nanoclawRoot);
  return { root: nanoclawRoot, removedFiles, bootRemoved, envRemoved };
}

export function runVerify(root?: string): {
  root: string;
  ok: boolean;
  issues: string[];
} {
  const nanoclawRoot = root ?? findNanoclawRoot();
  const issues: string[] = [];

  for (const rel of REQUIRED_ADAPTER_FILES) {
    if (!fs.existsSync(path.join(nanoclawRoot, rel))) {
      issues.push(`missing ${rel}`);
    }
  }

  const indexPath = path.join(nanoclawRoot, 'src/index.ts');
  if (!fs.existsSync(indexPath)) {
    issues.push('missing src/index.ts');
  } else {
    const content = fs.readFileSync(indexPath, 'utf8');
    if (!hasAdminApiBootBlock(content)) {
      issues.push('src/index.ts missing startAdminApi() boot block');
    }
  }

  const envPath = path.join(nanoclawRoot, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    if (!/ADMINAPI_TOKEN=/.test(env) && !/NANOCLAW_ADMINAPI_TOKEN=/.test(env)) {
      issues.push('.env missing ADMINAPI_TOKEN (ok if set only in process env)');
    }
  } else {
    issues.push('.env missing (token may still be set in process env)');
  }

  // Ensure copy rules stay in sync with required list
  if (ADAPTER_COPY_RULES.length !== REQUIRED_ADAPTER_FILES.length) {
    issues.push('internal: ADAPTER_COPY_RULES / REQUIRED_ADAPTER_FILES mismatch');
  }

  return { root: nanoclawRoot, ok: issues.length === 0, issues };
}

export function printInstallNextSteps(result: InstallResult): void {
  console.log(`Installed nanoclaw-adminapi@${result.version} adapter into ${result.root}`);
  console.log(`Copied ${result.copied.length} files.`);
  console.log(`Synced skill → ${result.skillPath}`);
  if (result.env.created.length > 0) {
    console.log(`Added .env: ${result.env.created.join(', ')}`);
  }
  console.log('\nNext steps:');
  console.log('  pnpm run build');
  console.log('  pnpm exec nanoclaw-adminapi verify');
  console.log('  # restart your NanoClaw host service');
  console.log('  curl -H "Authorization: Bearer $ADMINAPI_TOKEN" http://127.0.0.1:3210/internal/admin/health');
}
