import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants as osConstants } from 'node:os';

const require = createRequire(import.meta.url);
const knexCliPath = require.resolve('knex/bin/cli.js');
const child = spawn(process.execPath, ['--import', 'tsx', knexCliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error('runKnex spawn error:', error);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    const signalCode = osConstants.signals[signal];
    process.exit(signalCode ? 128 + signalCode : 1);
    return;
  }

  process.exit(code ?? 0);
});
