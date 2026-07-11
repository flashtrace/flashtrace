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

// full item list for --verbose: every item with status and role-appropriate
// edges - a markdown item its needs, a code item who wants it, a forwarding
// source its target (its own needs are excused). Grouped by file, then line.
// The need-resolution indexes mirror analyze's matchesOf but stay local so the
// default path pays nothing for them.
function renderVerbose(items, out, c, dimLoc) {
  const byId = new Map();
  for (const it of items) (byId.get(it.id) ?? byId.set(it.id, []).get(it.id)).push(it);
  const idsByKey = new Map();
  for (const id of byId.keys())
    (idsByKey.get(keyOf(id)) ?? idsByKey.set(keyOf(id), []).get(keyOf(id))).push(id);
  const matchesOf = (ref) => (idsByKey.get(keyOf(ref)) ?? []).filter((id) => idMatches(ref, id));

  const wantedBy = new Map(); // item -> items whose needs it satisfies
  for (const it of items)
    for (const n of it.needs)
      for (const id of matchesOf(n))
        for (const m of byId.get(id))
          (wantedBy.get(m) ?? wantedBy.set(m, new Set()).get(m)).add(it);

  const sorted = [...items].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );

  let prevFile = null;
  for (const it of sorted) {
    if (prevFile !== null && it.file !== prevFile) out.push('');
    prevFile = it.file;
    const { mark, tag } = statusOf(it, c);
    const title = it.title ? ' ' + c.dim(`"${it.title}"`) : '';
    out.push(`${mark} ${c.bold(it.id)}${title}  ${dimLoc(it.file, it.line)}  ${tag}`);
    if (it.forwardsTo !== null) {
      const target = byId.get(it.forwardsTo)?.[0];
      out.push(
        target
          ? `    ${c.cyan('→')} ${it.forwardsTo}  ${c.green('✔')} ${dimLoc(target.file, target.line)}`
          : `    ${c.cyan('→')} ${it.forwardsTo}  ${c.red('✘ missing')}`,
      );
    } else if (it.origin === 'markdown') {
      for (const n of it.needs) {
        const ids = matchesOf(n);
        if (ids.length === 0) {
          out.push(`    ${c.dim('needs')} ${n}  ${c.red('✘ missing')}`);
          continue;
        }
        const resolved = (id) => (isWildcardRev(revOf(n)) ? ` ${c.dim(`(→ ${id})`)}` : '');
        for (const id of ids) {
          const m = byId.get(id)[0];
          out.push(
            `    ${c.dim('needs')} ${n}${resolved(id)}  ${c.green('✔')} ${dimLoc(m.file, m.line)}`,
          );
        }
      }
    }
    if (it.origin === 'code') {
      for (const w of wantedBy.get(it) ?? [])
        out.push(`    ${c.dim('wanted by')} ${w.id}  ${dimLoc(w.file, w.line)}`);
    }
    for (const d of it.defects) out.push(`    ${c.red('•')} ${d}`);
  }
  if (sorted.length) out.push('');
}

export function report(items, problems, cwd, opts = {}) {
  const { verbose = false } = opts;
  const c = makeStyler();
  const rel = (f) => path.relative(cwd, f) || f;
  const dimLoc = (file, line) => c.dim(`${rel(file)}:${line}`);
  const defective = items.filter((it) => it.defects.length > 0);
  const out = [];

  if (verbose) {
    renderVerbose(items, out, c, dimLoc);
  } else {
    for (const it of defective) {
      const title = it.title ? ' ' + c.dim(`"${it.title}"`) : '';
      out.push(
        `${statusOf(it, c).mark} ${c.bold(it.id)}${title}  ${dimLoc(it.file, it.line)}`,
      );
      for (const d of it.defects) out.push(`    ${c.red('•')} ${d}`);
      out.push('');
    }
  }
  for (const p of problems) {
    out.push(`${c.yellow('⚠')} ${p.message}  ${dimLoc(p.file, p.line)}`);
  }
  if (problems.length) out.push('');

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

  const clean = defective.length === 0 && problems.length === 0;
  out.push(clean ? c.green(c.bold('ok')) : c.red(c.bold('not ok')));
  console.log(out.join('\n'));
  return clean;
}
