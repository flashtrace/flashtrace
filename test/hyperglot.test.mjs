/*
 * Generator and guard for the examples/hyperglot fixture tree.
 *
 * The tree is derived from the grammar table in src/languages.mjs rather than
 * maintained by hand, so it cannot drift from it: extensions are grouped by
 * grammar *object identity* (never by similarity), every extension gets one
 * fixture file, and every fixture tags every comment form its grammar offers.
 * Teaching languages.mjs a new extension therefore fails this suite until the
 * fixture is regenerated; teaching it a whole new grammar fails with a request
 * for a rendering config, since no generator can invent one.
 *
 * Regenerate after changing the grammar table or a renderer below:
 *   FLASHTRACE_UPDATE_FIXTURES=1 pnpm test
 * then review the diff and refresh the end-to-end snapshots in a *separate*
 * run (see FLASHTRACE_UPDATE_SNAPSHOTS in e2e.test.mjs). The two cannot share
 * a run: the e2e suite copies examples/hyperglot while this file rewrites it.
 *
 * examples/hyperglot/README.md is hand-written prose and is left alone; every
 * other file under that directory is owned by buildTree().
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODE_EXT, grammarFor } from '../src/languages.mjs';

const ROOT = fileURLToPath(new URL('../examples/hyperglot', import.meta.url));
const UPDATE = process.env.FLASHTRACE_UPDATE_FIXTURES === '1';
const HAND_WRITTEN = new Set(['README.md']);

if (UPDATE && process.env.FLASHTRACE_UPDATE_SNAPSHOTS === '1') {
  throw new Error(
    'refusing to update fixtures and e2e snapshots in one run: the e2e suite ' +
      'copies examples/hyperglot while this file rewrites it. Run ' +
      'FLASHTRACE_UPDATE_FIXTURES=1 pnpm test first, then ' +
      'FLASHTRACE_UPDATE_SNAPSHOTS=1 pnpm test.',
  );
}

// ----------------------------------------------------------------- pieces ---

const tag = (id) => `[${id}]`;

// a block comment spanning several lines, so the scanner has to carry the open
// block across lines to reach the tag
const blockLines = (open, close, id, indent = '  ', header = null) =>
  [open, ...(header ? [`${indent}${header}`] : []), `${indent}${tag(id)}`, close].join('\n');

// A nesting block whose tag sits *after* the inner closer: only a scanner that
// counts depth is still inside the comment there. A non-nesting one ends the
// comment at that closer and reads the tag as code, defining no item - which is
// what makes these tags a real assertion rather than decoration.
const nestedLine = (open, close, id) =>
  `${open} outer ${open} inner ${close} ${tag(id)} still inside the outer block ${close}`;

// ---------------------------------------------------------------- grammars ---
// Keyed by a signature of the grammar's comment vocabulary. The signature only
// looks up the rendering config; the grouping itself is by object identity.

const CONFIG = {
  [JSON.stringify({ line: ['//'], block: [['/*', '*/']] })]: {
    dir: 'c-like', title: 'C-like', family: 'c-like',
    blurb: 'Line comments and block comments that do not nest.',
    forms: ['line', 'block'],
    render: (ext, id) => [
      `// hyperglot fixture: .${ext} is scanned with the C-like comment grammar.`,
      `// ${tag(id('line'))}`,
      '',
      blockLines('/*', ' */', id('block'), ' * '),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['//'], block: [['/*', '*/', true]] })]: {
    dir: 'c-like-nested', title: 'Nesting C-like', family: 'c-like',
    blurb: 'Line comments plus block comments that nest.',
    forms: ['line', 'block', 'nested'],
    render: (ext, id) => [
      `// hyperglot fixture: .${ext} nests its block comments.`,
      `// ${tag(id('line'))}`,
      '',
      blockLines('/*', ' */', id('block'), ' * '),
      '',
      nestedLine('/*', '*/', id('nested')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['//', '#'], block: [['/*', '*/']] })]: {
    dir: 'php', title: 'PHP', family: 'php',
    blurb: 'Two line-comment markers plus one block pair.',
    forms: ['line-slash', 'line-hash', 'block'],
    render: (ext, id) => [
      '<?php',
      `// hyperglot fixture: .${ext} accepts two line-comment markers.`,
      `// ${tag(id('line-slash'))}`,
      `# ${tag(id('line-hash'))}`,
      '',
      blockLines('/*', ' */', id('block'), ' * '),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['#'], block: [] })]: {
    dir: 'hash', title: 'Hash', family: 'hash',
    blurb: 'A single line-comment marker and no block comments.',
    forms: ['only'],
    render: (ext, id) => [
      `# hyperglot fixture: .${ext} has line comments only.`,
      `# ${tag(id('only'))}`,
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['#'], block: [['#=', '=#', true]] })]: {
    dir: 'julia', title: 'Julia', family: 'hash',
    blurb: 'Hash line comments plus block comments that nest.',
    forms: ['line', 'block', 'nested'],
    render: (ext, id) => [
      `# hyperglot fixture: .${ext} nests its block comments.`,
      `# ${tag(id('line'))}`,
      '',
      blockLines('#=', '=#', id('block')),
      '',
      nestedLine('#=', '=#', id('nested')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['#'], block: [['#[', ']#', true], ['##[', ']##', true]] })]: {
    dir: 'nim', title: 'Nim', family: 'hash',
    blurb: 'Hash line comments plus two nesting block pairs, one of them a doc block.',
    forms: ['line', 'block', 'nested', 'doc-block', 'doc-nested'],
    render: (ext, id) => [
      `# hyperglot fixture: .${ext} has a plain and a doc block pair, both nesting.`,
      `# ${tag(id('line'))}`,
      '',
      blockLines('#[', ']#', id('block')),
      '',
      nestedLine('#[', ']#', id('nested')),
      '',
      '# the longer doc opener wins the tie against both shorter openers',
      blockLines('##[', ']##', id('doc-block')),
      '',
      nestedLine('##[', ']##', id('doc-nested')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['#'], block: [['###', '###']] })]: {
    dir: 'coffee', title: 'CoffeeScript', family: 'hash',
    blurb: 'Hash line comments plus a block pair whose opener and closer are identical.',
    forms: ['line', 'block'],
    render: (ext, id) => [
      `# hyperglot fixture: .${ext} opens and closes blocks with the same marker.`,
      `# ${tag(id('line'))}`,
      '',
      blockLines('###', '###', id('block')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['#'], block: [['<#', '#>']] })]: {
    dir: 'powershell', title: 'PowerShell', family: 'hash',
    blurb: 'Hash line comments plus a block pair that does not nest.',
    forms: ['line', 'block'],
    render: (ext, id) => [
      `# hyperglot fixture: .${ext} has line comments and block comments.`,
      `# ${tag(id('line'))}`,
      '',
      blockLines('<#', '#>', id('block')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['#', '//'], block: [['/*', '*/']] })]: {
    dir: 'hcl', title: 'HCL', family: 'hcl',
    blurb: 'Two line-comment markers plus one block pair.',
    forms: ['line-hash', 'line-slash', 'block'],
    render: (ext, id) => [
      `# hyperglot fixture: .${ext} accepts two line-comment markers.`,
      `# ${tag(id('line-hash'))}`,
      `// ${tag(id('line-slash'))}`,
      '',
      blockLines('/*', ' */', id('block'), ' * '),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: [';'], block: [] })]: {
    dir: 'semicolon', title: 'Semicolon', family: 'lisp',
    blurb: 'A single line-comment marker and no block comments.',
    forms: ['only'],
    render: (ext, id) => [
      `; hyperglot fixture: .${ext} has line comments only.`,
      `; ${tag(id('only'))}`,
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: [';'], block: [['#|', '|#', true]] })]: {
    dir: 'scheme', title: 'Scheme', family: 'lisp',
    blurb: 'Semicolon line comments plus block comments that nest.',
    forms: ['line', 'block', 'nested'],
    render: (ext, id) => [
      `; hyperglot fixture: .${ext} nests its block comments.`,
      `; ${tag(id('line'))}`,
      '',
      blockLines('#|', '|#', id('block')),
      '',
      nestedLine('#|', '|#', id('nested')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['%'], block: [] })]: {
    dir: 'percent', title: 'Percent', family: 'percent',
    blurb: 'A single line-comment marker and no block comments.',
    forms: ['only'],
    render: (ext, id) => [
      `% hyperglot fixture: .${ext} has line comments only.`,
      `% ${tag(id('only'))}`,
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['--'], block: [] })]: {
    dir: 'dash-line', title: 'Dash', family: 'dash',
    blurb: 'A single line-comment marker and no block comments.',
    forms: ['only'],
    render: (ext, id) => [
      `-- hyperglot fixture: .${ext} has line comments only.`,
      `-- ${tag(id('only'))}`,
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: [], block: [['(*', '*)', true]] })]: {
    dir: 'ml', title: 'ML', family: 'ml',
    blurb: 'Block comments that nest, and no line comments at all.',
    forms: ['block', 'nested'],
    render: (ext, id) => [
      blockLines('(*', ' *)', id('block'), ' * ', `hyperglot fixture: .${ext} nests blocks and has no line comments.`),
      '',
      nestedLine('(*', '*)', id('nested')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['//'], block: [['(*', '*)', true]] })]: {
    dir: 'fsharp', title: 'F#', family: 'ml',
    blurb: 'Line comments plus block comments that nest.',
    forms: ['line', 'block', 'nested'],
    render: (ext, id) => [
      `// hyperglot fixture: .${ext} nests its block comments.`,
      `// ${tag(id('line'))}`,
      '',
      blockLines('(*', ' *)', id('block'), ' * '),
      '',
      nestedLine('(*', '*)', id('nested')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['//'], block: [['{', '}'], ['(*', '*)']] })]: {
    dir: 'pascal', title: 'Pascal', family: 'pascal',
    blurb: 'Line comments plus two block pairs, neither of which nests.',
    forms: ['line', 'brace-block', 'paren-block'],
    render: (ext, id) => [
      `// hyperglot fixture: .${ext} has two block pairs.`,
      `// ${tag(id('line'))}`,
      '',
      blockLines('{', '}', id('brace-block')),
      '',
      blockLines('(*', ' *)', id('paren-block'), ' * '),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['--'], block: [['/*', '*/']] })]: {
    dir: 'sql', title: 'SQL', family: 'dash',
    blurb: 'Dash line comments plus a block pair that does not nest.',
    forms: ['line', 'block'],
    render: (ext, id) => [
      `-- hyperglot fixture: .${ext} has line comments and block comments.`,
      `-- ${tag(id('line'))}`,
      '',
      blockLines('/*', ' */', id('block'), ' * '),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['--'], block: [['--[[', ']]']] })]: {
    dir: 'lua', title: 'Lua', family: 'dash',
    blurb: 'Dash line comments plus a long-bracket block pair sharing their prefix.',
    forms: ['line', 'block'],
    render: (ext, id) => [
      `-- hyperglot fixture: .${ext} opens blocks with a longer form of its line marker.`,
      `-- ${tag(id('line'))}`,
      '',
      blockLines('--[[', ']]', id('block')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: ['--'], block: [['{-', '-}', true]] })]: {
    dir: 'haskell', title: 'Haskell', family: 'dash',
    blurb: 'Dash line comments plus block comments that nest.',
    forms: ['line', 'block', 'nested'],
    render: (ext, id) => [
      `-- hyperglot fixture: .${ext} nests its block comments.`,
      `-- ${tag(id('line'))}`,
      '',
      blockLines('{-', '-}', id('block')),
      '',
      nestedLine('{-', '-}', id('nested')),
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: [], block: [['/*', '*/']] })]: {
    dir: 'css', title: 'CSS', family: 'css',
    blurb: 'One block pair and no line comments at all.',
    forms: ['only'],
    render: (ext, id) => [
      blockLines('/*', ' */', id('only'), ' * ', `hyperglot fixture: .${ext} has block comments and no line comments.`),
      '',
      '.hyperglot {',
      '  display: block;',
      '}',
      '',
    ].join('\n'),
  },
  [JSON.stringify({ line: [], block: [['<!--', '-->']] })]: {
    dir: 'xml', title: 'XML', family: 'xml',
    blurb: 'One block pair and no line comments at all.',
    forms: ['only'],
    render: (ext, id) => {
      const root = ext === 'svg'
        ? ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">', '</svg>']
        : ['<fixture>', '</fixture>'];
      return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        root[0],
        '  <!--',
        `    hyperglot fixture: .${ext} has block comments and no line comments.`,
        `    ${tag(id('only'))}`,
        '  -->',
        root[1],
        '',
      ].join('\n');
    },
  },
  composite: {
    dir: 'html', title: 'HTML', family: 'html',
    blurb: 'Markup comments by default, with script and style regions that switch grammar.',
    formsFor: (ext) => (SFC_EXT.has(ext) ? HTML_SFC_FORMS : HTML_DOCUMENT_FORMS),
    render: (ext, id) => renderHtml(ext, id),
  },
};

// `lang` on <script>/<style> is a single-file-component convention; in a plain
// document that attribute is HTML's own natural-language one, so the region
// variants are split by where each actually belongs. The grammar is shared
// across all four extensions, so every branch of the region resolver is still
// covered by the folder as a whole.
const SFC_EXT = new Set(['vue', 'svelte']);
const HTML_SFC_FORMS = [
  'markup', 'script-line', 'script-block',
  'script-coffee-line', 'script-coffee-block', 'style-block', 'style-scss-line',
];
const HTML_DOCUMENT_FORMS = ['markup', 'script-line', 'script-block', 'script-template', 'style-block'];

// the region-carrying pieces the HTML-family fixtures are assembled from
const markupPart = (id) => ['  <!--', `    ${tag(id('markup'))}`, '  -->'].join('\n');

const plainScript = (id) => [
  '<script>',
  `// ${tag(id('script-line'))}`,
  '/*',
  ` * ${tag(id('script-block'))}`,
  ' */',
  'export default {};',
  '</script>',
].join('\n');

const plainStyle = (id) => [
  '<style>',
  '/*',
  ` * ${tag(id('style-block'))}`,
  ' */',
  '.hyperglot { display: block; }',
  '</style>',
].join('\n');

const coffeeScript = (id) => [
  '<script lang="coffee">',
  `# ${tag(id('script-coffee-line'))}`,
  '###',
  `  ${tag(id('script-coffee-block'))}`,
  '###',
  '</script>',
].join('\n');

const scssStyle = (id) => [
  '<style lang="scss">',
  `// ${tag(id('style-scss-line'))}`,
  '.hyperglot { .nested { display: block; } }',
  '</style>',
].join('\n');

const templateScript = (id) => [
  '<script type="text/html">',
  `  <!-- ${tag(id('script-template'))} -->`,
  '  <li>inline template</li>',
  '</script>',
].join('\n');

// Deliberately tag-shaped text in a region that resolves to a comment-less
// grammar, so it must stay data. Nothing renders its absence - the item count
// is what proves it.
const jsonScript = [
  '<script type="application/json">',
  '{ "note": "no comment grammar applies here, so [impl:html/none#1] stays data" }',
  '</script>',
].join('\n');

const indentBlock = (text, pad) => text.split('\n').map((l) => (l ? `${pad}${l}` : l)).join('\n');

function renderHtml(ext, id) {
  const markup = markupPart(id);
  if (ext === 'vue') {
    return [
      '<template>', markup, '  <p>hyperglot fixture</p>', '</template>', '',
      plainScript(id), '', coffeeScript(id), '', plainStyle(id), '', scssStyle(id), '',
    ].join('\n');
  }
  if (ext === 'svelte') {
    return [
      plainScript(id), '', coffeeScript(id), '',
      markup, '  <p>hyperglot fixture</p>', '',
      plainStyle(id), '', scssStyle(id), '',
    ].join('\n');
  }
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '  <head>',
    `    <title>hyperglot fixture: .${ext}</title>`,
    indentBlock(plainStyle(id), '    '),
    '  </head>',
    '  <body>',
    indentBlock(markup, '  '),
    '    <p>hyperglot fixture</p>',
    indentBlock([plainScript(id), '', jsonScript, '', templateScript(id)].join('\n'), '    '),
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

// ------------------------------------------------------------------ specs ---

// Single-form grammars name their item after the extension itself, so the short
// need forms (`impl`, `impl#1.2`) can complete against the stating requirement.
const implId = (dir, ext, form, forms, rev = '1') =>
  forms.length === 1 ? `impl:${dir}/${ext}#${rev}` : `impl:${dir}/${ext}-${form}#${rev}`;

// Revision and reference-form variety, all inside the single-form hash group:
// every extension there has exactly one item, so the stating requirement can
// complete short and wildcard references against it without extra items.
const HASH_VARIANTS = {
  py: { rev: '1.2', need: 'impl#1.2' },
  rb: { rev: '1', need: 'impl#x' },
  sh: { rev: '1.2.3', need: 'impl#1.2.x' },
  bash: { rev: '2.5', need: 'impl#x.y' },
  zsh: { rev: '3.1.4', need: 'impl#x.y.z' },
  yaml: { rev: '1.7', need: 'impl#1.x' },
  yml: { rev: '1', need: 'impl' },
  toml: { rev: '1', need: 'impl:hash/toml' },
};

// An alias extension delegates its coverage obligation to the extension it
// aliases, once as a plain line and once backticked. Both keep their own needs,
// so the tags in their fixture file stay wanted.
const FORWARDS = {
  'html/htm': { to: 'req:html/html#1', backticked: false },
  'xml/svg': { to: 'req:xml/xml#1', backticked: true },
};

// Per-folder presentation, so the fixture exercises every heading and keyword
// shape the Markdown parser accepts instead of repeating one of them 22 times.
const STYLE = {
  'c-like': { title: 'atx', needs: 'dash' },
  'c-like-nested': { title: 'atx', needs: 'table' },
  php: { title: 'setext1', needs: 'inline' },
  hash: { title: 'setext2-folded', needs: 'plus' },
  julia: { title: 'atx', needs: 'star' },
  nim: { title: 'atx', needs: 'inline' },
  coffee: { title: 'setext1', needs: 'dash' },
  powershell: { title: 'atx', needs: 'table' },
  hcl: { title: 'atx', needs: 'star' },
  semicolon: { title: 'setext2', needs: 'plus' },
  scheme: { title: 'atx', needs: 'inline' },
  percent: { title: 'atx', needs: 'dash' },
  'dash-line': { title: 'setext1', needs: 'table' },
  ml: { title: 'atx', needs: 'inline' },
  fsharp: { title: 'atx', needs: 'star' },
  pascal: { title: 'atx', needs: 'plus' },
  sql: { title: 'atx', needs: 'inline' },
  lua: { title: 'setext2', needs: 'dash' },
  haskell: { title: 'atx', needs: 'inline' },
  css: { title: 'atx', needs: 'inline' },
  xml: { title: 'atx', needs: 'table' },
  html: { title: 'atx', needs: 'dash' },
};

const bullet = (marker, entries) => entries.map((e) => `${marker} ${e}`).join('\n');

// `tags` is a list because a table cell is one entry, not a comma-separated
// list: a Tags column contributes one tag per row, so the tags spread down the
// column instead of collapsing into a single "grammar, xml" tag.
function needsBlock(style, entries, tags) {
  if (style === 'inline') {
    return [`Needs: ${entries.join(', ')}`, '', `Tags: ${tags.join(', ')}`].join('\n');
  }
  if (style === 'table') {
    const width = Math.max('Needs'.length, ...entries.map((e) => e.length));
    const tagWidth = Math.max('Tags'.length, ...tags.map((t) => t.length));
    return [
      `| ${'Needs'.padEnd(width)} | ${'Tags'.padEnd(tagWidth)} |`,
      `| ${'-'.repeat(width)} | ${'-'.repeat(tagWidth)} |`,
      ...entries.map((e, i) => `| ${e.padEnd(width)} | ${(tags[i] ?? '').padEnd(tagWidth)} |`),
    ].join('\n');
  }
  const marker = { dash: '-', star: '*', plus: '+' }[style];
  return ['Needs:', bullet(marker, entries), '', `Tags: ${tags.join(', ')}`].join('\n');
}

function heading(style, text) {
  if (style === 'atx') return `# ${text}`;
  if (style === 'setext1') return [text, '='.repeat(text.length)].join('\n');
  if (style === 'setext2') return [text, '-'.repeat(text.length)].join('\n');
  // a paragraph of several lines folds into one setext title (CommonMark)
  const second = 'family in the grammar table';
  return [`${text}, the widest`, second, '-'.repeat(second.length)].join('\n');
}

// --------------------------------------------------------------- assembly ---

// Group extensions by grammar *object identity*: two extensions share a folder
// only when they resolve to the very same grammar, never by mere similarity.
function groupExtensions() {
  const byGrammar = new Map();
  for (const ext of [...CODE_EXT].sort((a, b) => (a < b ? -1 : 1))) {
    const grammar = grammarFor(ext);
    if (!byGrammar.has(grammar)) byGrammar.set(grammar, []);
    byGrammar.get(grammar).push(ext.slice(1));
  }
  return byGrammar;
}

const signatureOf = (g) => (g.regions ? 'composite' : JSON.stringify({ line: g.line, block: g.block }));

function configFor(grammar, exts) {
  const config = CONFIG[signatureOf(grammar)];
  if (!config) {
    throw new Error(
      `no hyperglot rendering config for the grammar of .${exts.join(', .')} ` +
        `(${signatureOf(grammar)}). Add one to CONFIG in test/hyperglot.test.mjs, ` +
        'covering every comment form the grammar offers.',
    );
  }
  return config;
}

// the comment forms a fixture tags; a grammar whose regions differ by extension
// (the HTML family) states them per extension instead of once for the folder
const formsOf = (group, ext) => (group.formsFor ? group.formsFor(ext) : group.forms);

function renderFolder(group, files) {
  const { dir, title, blurb, render, exts, family } = group;
  const style = STYLE[dir];
  const extReqs = [];
  const sections = [];

  for (const ext of exts) {
    const variant = dir === 'hash' ? HASH_VARIANTS[ext] : null;
    const forms = formsOf(group, ext);
    const id = (form) => implId(dir, ext, form, forms, variant?.rev ?? '1');
    files.set(`${dir}/${ext}.${ext}`, render(ext, id));

    const reqId = `req:${dir}/${ext}#1`;
    extReqs.push(reqId);
    const needs = variant ? [variant.need] : forms.map((f) => id(f));
    // a grammar with many comment forms lists them as bullets; an inline list
    // of eight IDs would run well past any sensible line length
    const needsText =
      needs.length > 3 ? ['Needs:', bullet('-', needs)].join('\n') : `Needs: ${needs.join(', ')}`;
    const section = [`## .${ext}`, '', `\`${reqId}\``, '', needsText];
    const forward = FORWARDS[`${dir}/${ext}`];
    if (forward) {
      const line = `[${reqId} --> ${forward.to}]`;
      section.push('', forward.backticked ? `\`${line}\`` : line);
    }
    sections.push(section.join('\n'));
  }

  const groupId = `req:${dir}/grammar#1`;
  const spec = [
    heading(style.title, `${title} comment grammar`),
    '',
    `\`${groupId}\``,
    '',
    blurb,
    '',
    `Covers: feat:support-grammar/${dir}#1`,
    '',
    needsBlock(style.needs, extReqs, ['grammar', family]),
    '',
    ...sections.flatMap((s) => [s, '']),
  ].join('\n');
  files.set(`${dir}/spec.md`, spec.replace(/\n{3,}/g, '\n\n'));
  return { dir, title, blurb, groupId, count: exts.length };
}

// The whole generated tree as relative path -> file content.
export function buildTree() {
  const groups = [];
  for (const [grammar, exts] of groupExtensions()) {
    groups.push({ ...configFor(grammar, exts), exts });
  }
  groups.sort((a, b) => (a.dir < b.dir ? -1 : 1));

  const files = new Map();
  const summaries = groups.map((group) => renderFolder(group, files));

  const sections = summaries.map(({ dir, title, blurb, groupId, count }) =>
    [
      `## ${title}`,
      '',
      `\`feat:support-grammar/${dir}#1\``,
      '',
      `${blurb} ${count} extension${count === 1 ? '' : 's'} resolve${count === 1 ? 's' : ''} to this grammar.`,
      '',
      `Needs: ${groupId}`,
    ].join('\n'),
  );
  files.set(
    'spec.md',
    [
      '# Hyperglot grammar support',
      '',
      'One feature item per comment grammar the tracer knows. Each is covered by the',
      'spec.md of the matching folder, which in turn needs one requirement per file',
      "extension, which needs the item tags that extension's fixture file defines -",
      'one tag per comment form the grammar offers.',
      '',
      ...sections.flatMap((s) => [s, '']),
    ].join('\n'),
  );
  return files;
}

// ------------------------------------------------------------------ on disk ---

// every generated file currently committed, relative path -> content
async function readTree() {
  const found = new Map();
  const walk = async (dir, prefix) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (!HAND_WRITTEN.has(rel)) found.set(rel, await fs.readFile(path.join(dir, entry.name), 'utf8'));
    }
  };
  await walk(ROOT, '');
  return found;
}

async function writeTree(expected, actual) {
  for (const [rel] of actual) {
    if (!expected.has(rel)) await fs.rm(path.join(ROOT, rel));
  }
  for (const [rel, content] of expected) {
    const file = path.join(ROOT, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
  }
}

const HINT = 'regenerate with FLASHTRACE_UPDATE_FIXTURES=1 pnpm test';
const byName = (a, b) => (a < b ? -1 : 1);

// In update mode the tree is rewritten before anything is asserted, so the
// checks below always describe what is actually on disk - a regenerating run
// still has to satisfy them.
const expected = buildTree();
if (UPDATE) await writeTree(expected, await readTree());
const actual = await readTree();

// the folder a committed fixture for `ext` sits in, or null when there is none
const folderFor = (ext) => {
  const rel = [...actual.keys()].find((r) => r.endsWith(`/${ext.slice(1)}${ext}`));
  return rel ? rel.slice(0, rel.indexOf('/')) : null;
};

test('every known code extension has a committed fixture', () => {
  const missing = [...CODE_EXT].filter((ext) => folderFor(ext) === null).sort(byName);
  assert.deepEqual(missing, [], `extensions with no fixture file: ${missing.join(', ')}; ${HINT}`);
});

test('extensions are grouped by shared grammar, not by similarity', () => {
  const folderOf = new Map(); // grammar object -> the folder it was first seen in
  for (const ext of [...CODE_EXT].sort(byName)) {
    const folder = folderFor(ext);
    if (folder === null) continue; // reported by the test above
    const grammar = grammarFor(ext);
    const seen = folderOf.get(grammar);
    if (seen === undefined) folderOf.set(grammar, folder);
    else assert.equal(folder, seen, `${ext} shares a grammar with the ${seen}/ fixtures but sits in ${folder}/`);
  }
  // distinct grammars never share a folder either, so a folder means one grammar
  const folders = [...folderOf.values()];
  assert.equal(new Set(folders).size, folders.length, 'two different grammars share a folder');
});

test('the committed fixture tree matches the grammar table', () => {
  assert.deepEqual(
    [...actual.keys()].sort(byName),
    [...expected.keys()].sort(byName),
    `the committed fixture files differ from the grammar table; ${HINT}`,
  );
  for (const [rel, content] of expected) {
    assert.equal(actual.get(rel), content, `examples/hyperglot/${rel} is out of date; ${HINT}`);
  }
});
