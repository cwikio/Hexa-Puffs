/**
 * CodeExec Node.js REPL wrapper.
 *
 * Reads code blocks delimited by boundary markers from stdin,
 * evaluates them via AsyncFunction, and prints a done sentinel
 * to stdout after each block completes.
 *
 * Protocol:
 *   Parent writes lines of code, then a boundary line:
 *     __CODEXEC_BOUNDARY_<uuid8>__
 *   Wrapper executes the code, then prints:
 *     __CODEXEC_DONE_<uuid8>__
 */

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });

let lines = [];

rl.on('line', (line) => {
  if (line.startsWith('__CODEXEC_BOUNDARY_') && line.endsWith('__')) {
    const doneSentinel = line.replace('BOUNDARY', 'DONE');
    const code = lines.join('\n');
    lines = [];
    executeBlock(code, doneSentinel);
    return;
  }
  lines.push(line);
});

rl.on('close', () => {
  process.exit(0);
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function executeBlock(code, doneSentinel) {
  if (!code.trim()) {
    console.log(doneSentinel);
    return;
  }

  try {
    const fn = new AsyncFunction(code);
    const result = await fn();
    if (result !== undefined) {
      console.log(result);
    }
  } catch (err) {
    console.error(err.stack || err.message || String(err));
  } finally {
    console.log(doneSentinel);
  }
}
