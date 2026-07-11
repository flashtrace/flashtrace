import path from 'node:path';
import process from 'node:process';

import { idMatches, isWildcardRev, keyOf, revOf } from './ids.mjs';

function makeStyler() {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (code) => (s) => (on ? `\u001b[${code}m${s}\u001b[0m` : s);
  return {
    red: wrap('31'),
    green: wrap('32'),
    yellow: wrap('33'),
    cyan: wrap('36'),
    dim: wrap('2'),
    bold: wrap('1'),
  };
}

// marker + label for the three states the summary distinguishes
function statusOf(it, c) {
  if (it.defects.length > 0) return { mark: c.red('✘'), tag: c.red('[defective]') };
  if (!it.deepCovered) return { mark: c.yellow('~'), tag: c.yellow('[shallow-covered]') };
  return { mark: c.green('✔'), tag: c.green('[deep-covered]') };
}

// need-resolution indexes mirroring analyze's matchesOf, but local to the
// verbose renderer so the default path pays nothing for them
function buildResolver(items) {
  const byId = new Map();
  for (const it of items) (byId.get(it.id) ?? byId.set(it.id, []).get(it.id)).push(it);
  const idsByKey = new Map();
  for (const id of byId.keys())
    (idsByKey.get(keyOf(id)) ?? idsByKey.set(keyOf(id), []).get(keyOf(id))).push(id);
  const matchesOf = (ref) => (idsByKey.get(keyOf(ref)) ?? []).filter((id) => idMatches(ref, id));
  return { byId, matchesOf };
}

function buildWantedBy(items, byId, matchesOf) {
  const wantedBy = new Map(); // item -> items whose needs it satisfies
  for (const it of items)
    for (const n of it.needs)
      for (const id of matchesOf(n))
        for (const m of byId.get(id))
          (wantedBy.get(m) ?? wantedBy.set(m, new Set()).get(m)).add(it);
  return wantedBy;
}

function byFileLine(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}

function forwardEdge(it, byId, c, dimLoc) {
  const target = byId.get(it.forwardsTo)?.[0];
  if (!target) return `    ${c.cyan('→')} ${it.forwardsTo}  ${c.red('✘ missing')}`;
  return `    ${c.cyan('→')} ${it.forwardsTo}  ${c.green('✔')} ${dimLoc(target.file, target.line)}`;
}

// one line per need: satisfied with the covering item's location, or missing;
// a wildcard reference shows each resolved revision
function needEdges(it, byId, matchesOf, c, dimLoc) {
  const lines = [];
  for (const n of it.needs) {
    const ids = matchesOf(n);
    if (ids.length === 0) {
      lines.push(`    ${c.dim('needs')} ${n}  ${c.red('✘ missing')}`);
      continue;
    }
    const wild = isWildcardRev(revOf(n));
    for (const id of ids) {
      const m = byId.get(id)[0];
      const arrow = c.dim(`(→ ${id})`);
      const ref = wild ? `${n} ${arrow}` : n;
      lines.push(`    ${c.dim('needs')} ${ref}  ${c.green('✔')} ${dimLoc(m.file, m.line)}`);
    }
  }
  return lines;
}

// role-appropriate edges: a markdown item its needs, a code item who wants it,
// a forwarding source its target (its own needs are excused)
function edgeLines(it, byId, matchesOf, wantedBy, c, dimLoc) {
  const lines = [];
  if (it.forwardsTo !== null) lines.push(forwardEdge(it, byId, c, dimLoc));
  else if (it.origin === 'markdown') lines.push(...needEdges(it, byId, matchesOf, c, dimLoc));
  if (it.origin === 'code') {
    for (const w of wantedBy.get(it) ?? [])
      lines.push(`    ${c.dim('wanted by')} ${w.id}  ${dimLoc(w.file, w.line)}`);
  }
  return lines;
}

// full item list for --verbose: every item with status and trace edges,
// grouped by file, then line
function renderVerbose(items, out, c, dimLoc) {
  const { byId, matchesOf } = buildResolver(items);
  const wantedBy = buildWantedBy(items, byId, matchesOf);
  const sorted = [...items].sort(byFileLine);
  let prevFile = null;
  for (const it of sorted) {
    if (prevFile !== null && it.file !== prevFile) out.push('');
    prevFile = it.file;
    const { mark, tag } = statusOf(it, c);
    const title = it.title ? ' ' + c.dim(`"${it.title}"`) : '';
    out.push(
      `${mark} ${c.bold(it.id)}${title}  ${dimLoc(it.file, it.line)}  ${tag}`,
      ...edgeLines(it, byId, matchesOf, wantedBy, c, dimLoc),
    );
    for (const d of it.defects) out.push(`    ${c.red('•')} ${d}`);
  }
  if (sorted.length) out.push('');
}

// the default report: one block per defective item only
function renderDefective(defective, out, c, dimLoc) {
  for (const it of defective) {
    const title = it.title ? ' ' + c.dim(`"${it.title}"`) : '';
    out.push(
      `${statusOf(it, c).mark} ${c.bold(it.id)}${title}  ${dimLoc(it.file, it.line)}`,
    );
    for (const d of it.defects) out.push(`    ${c.red('•')} ${d}`);
    out.push('');
  }
}

function renderSummary(items, defective, problems, out, c) {
  const okCount = items.length - defective.length;
  const notDeep = items.filter((it) => it.defects.length === 0 && !it.deepCovered).length;
  const md = items.filter((i) => i.origin === 'markdown').length;
  const originBreakdown = c.dim(`(${md} from markdown, ${items.length - md} from code)`);

  out.push(
    c.bold('Summary'),
    `  items       ${items.length}  ${originBreakdown}`,
    `  ok          ${c.green(String(okCount))}`,
    `  defective   ${defective.length ? c.red(String(defective.length)) : '0'}`,
  );
  if (notDeep) out.push('  ' + c.dim(`of the ok items, ${notDeep} are only shallow-covered (an item further down the tracing chain is defective)`));
  if (problems.length) out.push(`  problems    ${c.yellow(String(problems.length))}`);
  out.push('');
}

export function report(items, problems, cwd, opts = {}) {
  const { verbose = false } = opts;
  const c = makeStyler();
  const rel = (f) => path.relative(cwd, f) || f;
  const dimLoc = (file, line) => c.dim(`${rel(file)}:${line}`);
  const defective = items.filter((it) => it.defects.length > 0);
  const out = [];

  if (verbose) renderVerbose(items, out, c, dimLoc);
  else renderDefective(defective, out, c, dimLoc);

  for (const p of problems) {
    out.push(`${c.yellow('⚠')} ${p.message}  ${dimLoc(p.file, p.line)}`);
  }
  if (problems.length) out.push('');

  renderSummary(items, defective, problems, out, c);

  const clean = defective.length === 0 && problems.length === 0;
  out.push(clean ? c.green(c.bold('ok')) : c.red(c.bold('not ok')));
  console.log(out.join('\n'));
  return clean;
}
