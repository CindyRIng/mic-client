#!/usr/bin/env node
import { runCli } from './adapters/cli/index.js';
import { isAppError } from './core/errors.js';

runCli().catch((e: unknown) => {
  if (process.env.MIC_DEBUG_ERRORS) {
    process.stderr.write(String((e as Error)?.stack ?? e) + '\n');
  }
  if (isAppError(e)) {
    // error message is already printed by fail(); only make sure exit code is set
    process.exitCode = process.exitCode ?? 1;
  } else {
    process.stderr.write(`fatal: ${String((e as Error)?.message ?? e)}\n`);
    process.exitCode = 1;
  }
});
