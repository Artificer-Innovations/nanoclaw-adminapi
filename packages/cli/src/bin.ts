#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNanoclawRoot } from './paths.js';
import {
  printInstallNextSteps,
  runInstall,
  runUninstall,
  runUpgrade,
  runVerify,
} from './install.js';
import { syncSkillToFork } from './patch.js';

function parseArgs(argv: string[]): { command: string; path?: string } {
  const args = argv.slice(2);
  const command = args[0] ?? 'help';
  let pathArg: string | undefined;
  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === '--path' && args[i + 1]) {
      pathArg = args[i + 1];
      i += 1;
    }
  }
  return { command, path: pathArg };
}

export function runCommand(argv: string[]): number {
  const { command, path: pathArg } = parseArgs(argv);

  try {
    switch (command) {
      case 'install': {
        const result = runInstall(pathArg);
        printInstallNextSteps(result);
        return 0;
      }
      case 'upgrade': {
        const result = runUpgrade(pathArg);
        printInstallNextSteps(result);
        return 0;
      }
      case 'sync-skill': {
        const root = pathArg ?? findNanoclawRoot();
        const dest = syncSkillToFork(root);
        console.log(`Synced skill → ${dest}`);
        return 0;
      }
      case 'verify': {
        const result = runVerify(pathArg);
        if (!result.ok) {
          console.error('Verification failed:');
          for (const issue of result.issues) console.error(`  - ${issue}`);
          return 1;
        }
        console.log(`Verification passed for ${result.root}`);
        return 0;
      }
      case 'uninstall': {
        const result = runUninstall(pathArg);
        console.log(`Removed adapter from ${result.root}`);
        console.log(`Deleted ${result.removedFiles.length} files.`);
        if (result.envRemoved.length > 0) {
          console.log(`Removed .env keys: ${result.envRemoved.join(', ')}`);
        }
        console.log('\nOptional: pnpm remove nanoclaw-adminapi');
        console.log('Then: pnpm run build && restart host');
        return 0;
      }
      default:
        console.log(`Usage: nanoclaw-adminapi <command> [--path <nanoclaw-root>]

Commands:
  install      Copy adapter, patch host, scaffold .env, sync skill
  upgrade      Re-copy adapter + skill (idempotent install)
  sync-skill   Copy bundled skill to .claude/skills/add-adminapi/
  verify       Check adapter files, boot patch, and env presence
  uninstall    Remove adapter files, boot patch, and scaffolded env keys
`);
        return command === 'help' ? 0 : 1;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

export { parseArgs };

export function isCliEntry(entryPath: string, argv: string[]): boolean {
  if (!argv[1]) return false;
  try {
    return realpathSync(entryPath) === realpathSync(path.resolve(argv[1]));
  } catch {
    return entryPath === argv[1];
  }
}

function main(): void {
  process.exit(runCommand(process.argv));
}

export { main };

/* v8 ignore start -- CLI entry when executed directly */
if (isCliEntry(fileURLToPath(import.meta.url), process.argv)) {
  main();
}
/* v8 ignore stop */
