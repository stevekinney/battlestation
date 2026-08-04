#!/usr/bin/env bun
import {
  fileChangedBetween,
  header,
  info,
  isContinuousIntegration,
  installDependencies,
} from './utilities.ts';

if (isContinuousIntegration()) process.exit(0);

const [, , prevHead = '', newHead = '', checkoutType = ''] = Bun.argv;
// Only branch checkouts (checkoutType === '1'), and not the initial clone.
if (checkoutType !== '1') process.exit(0);
if (prevHead === '0000000000000000000000000000000000000000') process.exit(0);

const lockChanged = await fileChangedBetween('bun.lock', prevHead, newHead);
const packageChanged = await fileChangedBetween('package.json', prevHead, newHead);

const configFiles = ['tsconfig.json', '.oxlintrc.json', '.prettierrc.json', 'bunfig.toml'];
const changedConfig: string[] = [];
for (const f of configFiles) {
  if (await fileChangedBetween(f, prevHead, newHead)) changedConfig.push(f);
}

// Nothing actionable changed — stay silent.
if (!lockChanged && !packageChanged && changedConfig.length === 0) process.exit(0);

header('Post-checkout');

if (lockChanged) {
  await installDependencies();
} else if (packageChanged) {
  info("package.json changed but bun.lock didn't — you may need to run 'bun install'.");
}

if (changedConfig.length > 0) {
  info(`Config changed: ${changedConfig.join(', ')} — you may need to restart dev/editor.`);
}

process.exit(0);
