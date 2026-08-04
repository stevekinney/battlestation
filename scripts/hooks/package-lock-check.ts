#!/usr/bin/env bun
import { $ } from 'bun';

import { getStagedFiles, info, warning } from './utilities.ts';

const staged = await getStagedFiles();

if (staged.includes('package.json') && !staged.includes('bun.lock')) {
  const bunLockStatus = await $`git status --porcelain -- bun.lock`.text();
  if (bunLockStatus.trim().length > 0) {
    // bun install was run but bun.lock wasn't staged — block until it is.
    warning('bun.lock has unstaged changes');
    info('Run bun install and stage bun.lock before committing');
    process.exit(1);
  } else {
    // package.json changed but bun.lock has no diff at all — likely a hand-edit
    // without `bun install`. Warn (soft) since not every edit touches deps.
    warning('package.json is staged but bun.lock has no changes');
    info('If you changed dependencies, run bun install and stage bun.lock');
  }
}
