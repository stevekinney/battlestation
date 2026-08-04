#!/usr/bin/env bun
import { $ } from 'bun';

// Block commits that still contain Git conflict markers. `--cached` scans the
// staged content only, so this catches markers a developer forgot to resolve.
// git grep defaults to basic regex (| is literal), so each marker needs its own
// `-e`; the separator line is exactly `=======`, hence the `$` anchor. grep
// exits 0 when it finds a match.
const scan = await $`git grep --cached -n -e ${'^<<<<<<< '} -e ${'^=======$'} -e ${'^>>>>>>> '}`
  .nothrow()
  .quiet();

if (scan.exitCode === 0) {
  await Bun.write(Bun.stdout, scan.stdout);
  console.error('Conflict markers found in staged changes — resolve them before committing.');
  process.exit(1);
}
