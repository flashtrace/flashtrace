/*
 * Transition gate between the JavaScript CLI (dist/flashtrace.mjs) and the
 * Rust CLI: runs both over every example x variant and over a matrix of
 * CLI-surface cases, and requires identical stdout, stderr and exit codes.
 * Version output is normalized (the two implementations report their own
 * versions). The example corpus is ASCII, so the gate proves the port on
 * real projects without pinning the Rust CLI to JavaScript's string
 * semantics (character columns, Unicode whitespace and code-point ordering
 * are the Rust CLI's own).
 *
 * Usage: node .github/scripts/parity-check.mjs <path-to-rust-binary>
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = path.join(ROOT, 'dist', 'flashtrace.mjs');
const rustBinary = process.argv[2] && path.resolve(process.argv[2]);
if (!rustBinary) {
  console.error('usage: node .github/scripts/parity-check.mjs <path-to-rust-binary>');
  process.exit(2);
}

const EXAMPLES = [
  ['basic', [[], ['-v'], ['--json']]],
  ['shortforms', [[], ['-v'], ['--json']]],
  ['revisions-and-forwarding', [[], ['-v'], ['--json']]],
  ['polyglot-web', [[], ['-v'], ['--json'], ['--tags', 'web,data']]],
  ['hyperglot', [[], ['-v'], ['--json']]],
  ['multiplicity', [[], ['-v'], ['--json']]],
  ['diagnostics', [[], ['-v'], ['--json']]],
];

// CLI-surface cases run in an empty directory: help, version, every usage
// error, tag and format spellings, a nonexistent path, a single-file input
const SURFACE = [
  ['--help'],
  ['-h'],
  ['--version'],
  ['--nope'],
  ['--frobnicate=x'],
  ['-t=a,b'],
  ['--format'],
  ['--format=bogus'],
  ['--json', '-f', 'text'],
  ['-v', '--json'],
  ['--tags', 'a', '--tags', 'b'],
  ['--tags='],
  ['--verbose=1'],
  ['does-not-exist-anywhere'],
];

// the JavaScript CLI reports the package version, the Rust CLI the crate
// version; both are provenance, not behavior, so both spellings collapse
const normalize = (text) =>
  text
    .replace(/^(  "flashtrace": ")[^"]*"/m, '$1<version>"')
    .replace(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\r?\n$/, '<version>\n');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return {
    stdout: normalize(result.stdout ?? ''),
    stderr: normalize(result.stderr ?? ''),
    status: result.status,
  };
}

let failures = 0;
function compare(label, args, cwd) {
  const fromJavaScript = run(process.execPath, [SCRIPT, ...args], cwd);
  const fromRust = run(rustBinary, args, cwd);
  const mismatches = [];
  if (fromJavaScript.status !== fromRust.status)
    mismatches.push(`exit: js=${fromJavaScript.status} rust=${fromRust.status}`);
  if (fromJavaScript.stdout !== fromRust.stdout) mismatches.push('stdout differs');
  if (fromJavaScript.stderr !== fromRust.stderr) mismatches.push('stderr differs');
  if (mismatches.length === 0) {
    console.log(`ok: ${label}`);
    return;
  }
  failures++;
  console.error(`PARITY FAILURE: ${label}: ${mismatches.join(', ')}`);
  for (const [channel, js, rust] of [
    ['stdout', fromJavaScript.stdout, fromRust.stdout],
    ['stderr', fromJavaScript.stderr, fromRust.stderr],
  ]) {
    if (js === rust) continue;
    const jsLines = js.split('\n');
    const rustLines = rust.split('\n');
    for (let i = 0; i < Math.max(jsLines.length, rustLines.length); i++) {
      if (jsLines[i] !== rustLines[i]) {
        console.error(`  ${channel} line ${i + 1}:`);
        console.error(`    js:   ${JSON.stringify(jsLines[i])}`);
        console.error(`    rust: ${JSON.stringify(rustLines[i])}`);
        break;
      }
    }
  }
}

for (const [example, variants] of EXAMPLES) {
  for (const args of variants) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'flashtrace-parity-'));
    try {
      cpSync(path.join(ROOT, 'examples', example), dir, { recursive: true });
      compare(`${example} ${args.join(' ') || '(default)'}`, args, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

for (const args of SURFACE) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'flashtrace-parity-'));
  try {
    compare(`surface: ${args.join(' ')}`, args, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error(`${failures} parity failure(s)`);
  process.exit(1);
}
console.log('all outputs identical');
