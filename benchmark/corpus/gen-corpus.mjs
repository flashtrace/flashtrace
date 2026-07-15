/*
 * Deterministic synthetic corpus generator for the runtime benchmark.
 *
 *   node benchmark/corpus/gen-corpus.mjs <target-dir> --files <n> [--seed <n>]
 *
 * Generates a polyglot source tree seeded with real flashtrace work:
 *   - per module: one markdown spec defining `req:` items whose Needs
 *     reference `impl:` and `utest:` IDs,
 *   - code files carrying `[impl:...]` tags plus `[>> ...]` need tags,
 *   - test files carrying `[utest:...]` tags,
 *   - a fixed number (25) of deliberately uncovered needs, so every corpus
 *     produces defects and a stable, small report regardless of size,
 *   - plenty of tag-free noise code with comment blocks and near-miss
 *     bracket text, so the scanner does real regex work, not just I/O.
 *
 * Output depends only on (--files, --seed): byte-for-byte reproducible.
 * The tree is NOT a git repository, so every runtime under test takes the
 * same pure-JS directory-walk path in collectFiles().
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const target = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : Number(args[i + 1]);
};
if (!target || Number.isNaN(opt('--files', 0))) {
  console.error('usage: gen-corpus.mjs <target-dir> --files <n> [--seed <n>]');
  process.exit(2);
}
const FILES = opt('--files', 1000);
const SEED = opt('--seed', 42);
const UNCOVERED = 25; // fixed defect count, independent of corpus size

// mulberry32 - tiny deterministic PRNG
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// language mix: [ext, line-comment marker or null, [blockOpen, blockClose] or null]
const LANGS = [
  ['.js', '//', ['/*', '*/']],
  ['.ts', '//', ['/*', '*/']],
  ['.mjs', '//', ['/*', '*/']],
  ['.c', '//', ['/*', '*/']],
  ['.h', '//', ['/*', '*/']],
  ['.cpp', '//', ['/*', '*/']],
  ['.java', '//', ['/*', '*/']],
  ['.go', '//', ['/*', '*/']],
  ['.rs', '//', ['/*', '*/']],
  ['.py', '#', null],
  ['.rb', '#', null],
  ['.sh', '#', null],
  ['.yaml', '#', null],
  ['.lua', '--', ['--[[', ']]']],
  ['.sql', '--', ['/*', '*/']],
  ['.hs', '--', ['{-', '-}']],
  ['.css', null, ['/*', '*/']],
  ['.html', null, ['<!--', '-->']],
  ['.ml', null, ['(*', '*)']],
];

const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut ' +
  'labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ' +
  'aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat ' +
  'nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit ' +
  'anim id est laborum').split(' ');
const sentence = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ');

// noise line shapes: realistic code, including near-miss bracket text that the
// tag regex must scan and reject
function codeLine(i) {
  const shapes = [
    () => `const value_${i} = compute(${int(0, 999)}, "${pick(WORDS)}");`,
    () => `if (state[${int(0, 9)}] > threshold) { emit("${pick(WORDS)}"); }`,
    () => `function helper_${i}(a, b) { return a * ${int(2, 97)} + b; }`,
    () => `let arr = [${int(0, 9)}, ${int(10, 99)}, ${int(100, 999)}]; // ${sentence(4)}`,
    () => `map.set("${pick(WORDS)}_${i}", [${pick(WORDS)}, ${pick(WORDS)}]);`,
    () => `return matrix[row][col] + offsets[${int(0, 7)}];`,
    () => `// [not-a-tag] ${sentence(3)} [also:not#valid syntax [nested`,
    () => `// TODO(${pick(WORDS)}): ${sentence(5)} [ref missing #${int(1, 9)}]`,
    () => `log.debug("op=${pick(WORDS)} [${int(0, 999)}ms]", ctx);`,
  ];
  return pick(shapes)();
}

function comment(marker, text) {
  return marker ? `${marker} ${text}` : null;
}

// ---- ID universe -----------------------------------------------------------

const nModules = Math.max(1, Math.round(FILES / 25)); // ~25 files per module
const mods = Array.from({ length: nModules }, (_, m) => `mod${m}`);
const reqsPerModule = 4;

// req:modX/featN#1 needs impl:modX/featN#1 and utest:modX/featN#1
const reqs = [];
for (const mod of mods)
  for (let f = 0; f < reqsPerModule; f++)
    reqs.push({ mod, name: `feat${f}`, rev: '1' });

// deterministic selection of needs that stay uncovered (no utest tag emitted)
const uncoveredSet = new Set();
while (uncoveredSet.size < Math.min(UNCOVERED, reqs.length)) {
  uncoveredSet.add(Math.floor(rnd() * reqs.length));
}

// ---- file emission ---------------------------------------------------------

rmSync(target, { recursive: true, force: true });
const files = []; // [relPath, content]

function specFile(mod, modIdx) {
  const lines = [`# Specification of ${mod}`, ''];
  for (let f = 0; f < reqsPerModule; f++) {
    const idx = modIdx * reqsPerModule + f;
    lines.push(`## Requirement ${mod}/feat${f}`, '');
    lines.push(`\`req:${mod}/feat${f}#1\``, '');
    lines.push(sentence(int(8, 16)), '');
    lines.push(`Needs: impl:${mod}/feat${f}#1, utest:${mod}/feat${f}#1`, '');
    if (f === 0) lines.push(`Tags: bench, ${mod}`, '');
    lines.push(sentence(int(20, 40)), '');
    void idx;
  }
  // prose noise with pipes and backticks the parser must consider
  lines.push('## Notes', '', `| topic | ${pick(WORDS)} |`, '| --- | --- |', `| ${sentence(2)} | ${sentence(3)} |`, '');
  return lines.join('\n') + '\n';
}

function implFile(mod, feat, ext, marker, block, fileIdx) {
  const lines = [];
  const tag = comment(marker, `[impl:${mod}/${feat}#1]`) ??
    `${block[0]} [impl:${mod}/${feat}#1] ${block[1]}`;
  const need = comment(marker, `[>> req:${mod}/${feat}#1]`) ??
    `${block[0]} [>> req:${mod}/${feat}#1] ${block[1]}`;
  lines.push(tag, need);
  const n = int(30, 120);
  for (let i = 0; i < n; i++) {
    lines.push(codeLine(fileIdx * 1000 + i));
    if (block && rnd() < 0.06) lines.push(`${block[0]} ${sentence(int(4, 12))} ${block[1]}`);
    if (marker && rnd() < 0.1) lines.push(`${marker} ${sentence(int(3, 8))}`);
  }
  return lines.join('\n') + '\n';
}

function testFile(mod, feat, ext, marker, block, fileIdx) {
  const lines = [];
  const tag = comment(marker, `[utest:${mod}/${feat}#1]`) ??
    `${block[0]} [utest:${mod}/${feat}#1] ${block[1]}`;
  const need = comment(marker, `[utest:${mod}/${feat}#1 >> impl:${mod}/${feat}#1]`) ??
    `${block[0]} [utest:${mod}/${feat}#1 >> impl:${mod}/${feat}#1] ${block[1]}`;
  lines.push(tag, need);
  const n = int(20, 80);
  for (let i = 0; i < n; i++) lines.push(codeLine(fileIdx * 1000 + i));
  return lines.join('\n') + '\n';
}

function noiseFile(ext, marker, block, fileIdx) {
  const lines = [];
  const n = int(20, 150);
  for (let i = 0; i < n; i++) {
    lines.push(codeLine(fileIdx * 1000 + i));
    if (marker && rnd() < 0.12) lines.push(`${marker} ${sentence(int(3, 10))}`);
    if (block && rnd() < 0.05) lines.push(`${block[0]} ${sentence(int(5, 15))} ${block[1]}`);
  }
  return lines.join('\n') + '\n';
}

let fileIdx = 0;
for (let m = 0; m < mods.length; m++) {
  const mod = mods[m];
  const dir = join(mod.slice(0, 4) === 'mod' && m % 7 === 0 ? 'core' : 'pkg', mod);
  files.push([join(dir, 'SPEC.md'), specFile(mod, m)]);
  for (let f = 0; f < reqsPerModule; f++) {
    const reqIdx = m * reqsPerModule + f;
    const [ext, marker, block] = pick(LANGS);
    files.push([join(dir, 'src', `feat${f}${ext}`), implFile(mod, `feat${f}`, ext, marker, block, fileIdx++)]);
    if (!uncoveredSet.has(reqIdx)) {
      const [text, tmark, tblock] = pick(LANGS);
      files.push([join(dir, 'test', `feat${f}.test${text}`), testFile(mod, `feat${f}`, text, tmark, tblock, fileIdx++)]);
    }
  }
}

// fill up with tag-free noise files spread over nested dirs
let noise = 0;
while (files.length < FILES) {
  const [ext, marker, block] = pick(LANGS);
  const mod = pick(mods);
  const sub = pick(['lib', 'util', 'internal', 'vendor', join('deep', 'nested', 'tree')]);
  files.push([join('pkg', mod, sub, `noise_${noise++}${ext}`), noiseFile(ext, marker, block, fileIdx++)]);
}

for (const [rel, content] of files) {
  const p = join(target, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

const bytes = files.reduce((a, [, c]) => a + c.length, 0);
console.log(
  `generated ${files.length} files (${(bytes / 1e6).toFixed(1)} MB), ` +
    `${mods.length} modules, ${reqs.length} reqs, ${uncoveredSet.size} uncovered, seed=${SEED} -> ${target}`,
);
