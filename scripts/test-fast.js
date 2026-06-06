import { spawn } from 'node:child_process';
import process from 'node:process';

const suites = [
  { name: 'backend', command: 'npm', args: ['--prefix', 'backend', 'test'] },
  { name: 'frontend', command: 'npm', args: ['--prefix', 'frontend', 'test'] },
];

function prefixLines(name, stream) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.length) process.stdout.write(`[${name}] ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer.length) process.stdout.write(`[${name}] ${buffer}\n`);
  });
}

function runSuite({ name, command, args }) {
  const child = spawn(command, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  prefixLines(name, child.stdout);
  prefixLines(name, child.stderr);
  return new Promise((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ name, code: code ?? 1, signal });
    });
  });
}

const startedAt = Date.now();
const results = await Promise.all(suites.map(runSuite));
const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

for (const result of results) {
  const status = result.code === 0 ? 'passed' : `failed (${result.signal || result.code})`;
  process.stdout.write(`[test:fast] ${result.name} ${status}\n`);
}
process.stdout.write(`[test:fast] completed in ${elapsedSeconds}s\n`);

if (results.some(result => result.code !== 0)) {
  process.exit(1);
}
