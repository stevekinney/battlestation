#!/usr/bin/env bun
import { $ } from 'bun';

import {
  error,
  header,
  info,
  installDependencies,
  isContinuousIntegration,
  success,
  warning,
} from './utilities.ts';

if (isContinuousIntegration()) process.exit(0);

const changedList = await $`git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD`.text();
const changed = changedList.split('\n').filter(Boolean);

const configFiles = [
  'tsconfig.json',
  '.oxlintrc.json',
  '.prettierrc.json',
  'bunfig.toml',
  '.env.example',
];

const needsInstall = changed.some((f) => f === 'package.json' || f === 'bun.lock');
const changedConfig = configFiles.filter((f) => changed.includes(f));

// Check for leftover conflict markers regardless of what changed. git grep
// defaults to basic regex (| is literal), so each marker needs its own `-e`;
// the separator line is exactly `=======`, hence the `$` anchor.
const conflictScan = await $`git grep -n -e ${'^<<<<<<< '} -e ${'^=======$'} -e ${'^>>>>>>> '}`
  .nothrow()
  .quiet();
const hasConflicts = conflictScan.exitCode === 0;

// Nothing actionable — stay silent.
if (!needsInstall && changedConfig.length === 0 && !hasConflicts) process.exit(0);

header('Post-merge');

if (needsInstall) {
  await installDependencies();
}

if (changedConfig.length > 0) {
  info(`Config changed: ${changedConfig.join(', ')} — cleaning caches…`);
  try {
    await $`bun run clean`.quiet();
    success('Caches cleaned');
  } catch {
    warning('Clean task failed — run bun run clean manually');
  }
}

if (hasConflicts) {
  await Bun.write(Bun.stdout, conflictScan.stdout);
  error('Found conflict markers in files — please resolve any remaining conflicts.');
}

process.exit(0);
