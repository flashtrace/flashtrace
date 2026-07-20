/*
 * Completeness guard for the examples/hyperglot fixture tree.
 *
 * The fixtures there are hand-written like every other example, but which
 * fixtures exist is not free: examples/hyperglot exists to show that flashtrace
 * scans every extension it claims to support, and that is only true while every
 * extension in src/languages.mjs actually has one. This suite ties the two
 * together, so a change teaching flashtrace a new extension cannot land without
 * the fixture that exercises it - CI runs `pnpm test` on every pull request to
 * main, so the tie holds there too.
 *
 * The conventions it checks, all of which the example's README spells out:
 *   - one fixture per extension, named after it (ts.ts covers .ts), so "the
 *     fixture for .ts" is something this suite can look up at all;
 *   - fixtures grouped in a folder per comment grammar, shared by exactly the
 *     extensions resolving to the same grammar object;
 *   - each fixture tagging every comment form its grammar offers, so a new
 *     fixture cannot cover an extension in name only.
 *
 * It deliberately says nothing about what a fixture contains beyond that: the
 * prose, the tag IDs and the spec wiring are the example's own business, and
 * the end-to-end snapshots already pin the result byte-for-byte.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODE_EXT, grammarFor } from '../src/languages.mjs';
import { parseCode } from '../src/parse-code.mjs';

const ROOT = fileURLToPath(new URL('../examples/hyperglot', import.meta.url));
const MARKDOWN = new Set(['.md', '.markdown']);
const byName = (a, b) => (a < b ? -1 : 1);

// Every code fixture under examples/hyperglot: its extension, the folder it
// sits in and its text. Markdown is skipped - the specs and the README are
// prose about the fixtures, not fixtures themselves.
async function collectFixtures() {
  const fixtures = [];
  const walk = async (dir, folder) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, entry.name);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (MARKDOWN.has(ext)) continue;
      fixtures.push({ ext, folder, name: entry.name, text: await fs.readFile(full, 'utf8') });
    }
  };
  await walk(ROOT, null);
  return fixtures.sort((a, b) => byName(a.name, b.name));
}

// How many tags a fixture must carry to exercise its grammar: one per line
// marker, one per block pair, and two more for every pair that nests - one tag
// inside the inner block and one after the inner closer, which is what makes
// nesting an assertion rather than decoration. A composite grammar has no such
// number: which regions a file carries follows the convention of the extension
// (a lang-attributed script belongs in a single-file component, not in a plain
// document), so those are only required to tag something.
const tagsRequiredBy = (grammar) =>
  grammar.regions
    ? 1
    : grammar.line.length + grammar.block.length + 2 * grammar.block.filter((pair) => pair[2]).length;

const fixtures = await collectFixtures();
const byExtension = new Map(fixtures.map((f) => [f.ext, f]));

test('every known code extension has a fixture', () => {
  const missing = [...CODE_EXT].filter((ext) => !byExtension.has(ext)).sort(byName);
  assert.deepEqual(
    missing,
    [],
    `extensions flashtrace scans with no fixture in examples/hyperglot: ${missing.join(', ')}. ` +
      'Add one file per extension, named after it, in the folder of its comment grammar, ' +
      'and wire it into that folder\'s spec.md.',
  );
});

test('every fixture covers a known code extension', () => {
  const stray = fixtures
    .filter((f) => !CODE_EXT.has(f.ext))
    .map((f) => `${f.folder}/${f.name}`)
    .sort(byName);
  assert.deepEqual(stray, [], `fixtures for extensions flashtrace does not scan: ${stray.join(', ')}`);
});

test('each extension has exactly one fixture, named after it', () => {
  const counts = new Map();
  for (const f of fixtures) counts.set(f.ext, (counts.get(f.ext) ?? 0) + 1);
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([ext]) => ext).sort(byName);
  assert.deepEqual(duplicated, [], `extensions with more than one fixture: ${duplicated.join(', ')}`);

  const misnamed = fixtures
    .filter((f) => f.name !== `${f.ext.slice(1)}${f.ext}`)
    .map((f) => `${f.folder}/${f.name} (expected ${f.ext.slice(1)}${f.ext})`)
    .sort(byName);
  assert.deepEqual(misnamed, [], `fixtures not named after their extension: ${misnamed.join(', ')}`);
});

test('extensions are grouped by shared grammar, not by similarity', () => {
  const folderOf = new Map(); // grammar object -> the folder it was first seen in
  for (const ext of [...CODE_EXT].sort(byName)) {
    const fixture = byExtension.get(ext);
    if (!fixture) continue; // reported by the first test
    const grammar = grammarFor(ext);
    const seen = folderOf.get(grammar);
    if (seen === undefined) folderOf.set(grammar, fixture.folder);
    else
      assert.equal(
        fixture.folder,
        seen,
        `${ext} resolves to the same grammar as the ${seen}/ fixtures but sits in ${fixture.folder}/`,
      );
  }
  // distinct grammars must not share a folder either, so a folder means one grammar
  const folders = [...folderOf.values()];
  const shared = folders.filter((f, i) => folders.indexOf(f) !== i).sort(byName);
  assert.deepEqual(shared, [], `folders holding more than one grammar: ${shared.join(', ')}`);
});

test('each fixture tags every comment form its grammar offers', () => {
  const short = [];
  for (const [ext, fixture] of byExtension) {
    if (!CODE_EXT.has(ext)) continue; // reported by the second test
    const required = tagsRequiredBy(grammarFor(ext));
    const found = parseCode(fixture.name, fixture.text, []).length;
    if (found < required) short.push(`${fixture.folder}/${fixture.name}: ${found} of ${required}`);
  }
  assert.deepEqual(
    short.sort(byName),
    [],
    'fixtures tagging fewer comment forms than their grammar offers ' +
      `(one tag per line marker, one per block pair, two per nesting pair): ${short.join('; ')}`,
  );
});
