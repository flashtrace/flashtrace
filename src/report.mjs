import path from 'node:path';
import process from 'node:process';

import { buildResolver, isClean, summarize } from './analyze.mjs';
import { isWildcardRev, revOf } from './ids.mjs';

function makeStyler() {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (code) => (text) => (on ? `\u001b[${code}m${text}\u001b[0m` : text);
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
function statusOf(item, style) {
  if (item.defects.length > 0) return { mark: style.red('✘'), tag: style.red('[defective]') };
  if (!item.deepCovered) return { mark: style.yellow('~'), tag: style.yellow('[shallow-covered]') };
  return { mark: style.green('✔'), tag: style.green('[deep-covered]') };
}

function byFileLine(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}

// a need or forwarding edge carries this item's coverage obligation, so it
// shows the target's own status mark - not a bare ✔ - making a shallow-covered
// item's broken chain diagnosable in place
function forwardEdge(item, byId, style, dimLocation) {
  const target = byId.get(item.forwardsTo)?.[0];
  if (!target) return `    ${style.cyan('→')} ${item.forwardsTo}  ${style.red('✘ missing')}`;
  return `    ${style.cyan('→')} ${item.forwardsTo}  ${statusOf(target, style).mark} ${dimLocation(target.file, target.line)}`;
}

// one line per need: the covering item's own status mark and location, or
// missing; a wildcard reference shows each resolved revision
function needEdges(item, byId, matchesOf, style, dimLocation) {
  const lines = [];
  for (const need of item.needs) {
    const ids = matchesOf(need);
    if (ids.length === 0) {
      lines.push(`    ${style.dim('needs')} ${need}  ${style.red('✘ missing')}`);
      continue;
    }
    const wildcard = isWildcardRev(revOf(need));
    for (const id of ids) {
      const covering = byId.get(id)[0];
      const arrow = style.dim(`(→ ${id})`);
      const ref = wildcard ? `${need} ${arrow}` : need;
      lines.push(`    ${style.dim('needs')} ${ref}  ${statusOf(covering, style).mark} ${dimLocation(covering.file, covering.line)}`);
    }
  }
  return lines;
}

// covers references are concrete IDs; the relation's validation (orphaned,
// unwanted) is carried by the defect bullets, the edge shows existence
function coverEdges(item, byId, style, dimLocation) {
  const lines = [];
  for (const coverId of item.covers) {
    const target = byId.get(coverId)?.[0];
    if (!target) lines.push(`    ${style.dim('covers')} ${coverId}  ${style.red('✘ missing')}`);
    else lines.push(`    ${style.dim('covers')} ${coverId}  ${style.green('✔')} ${dimLocation(target.file, target.line)}`);
  }
  return lines;
}

// role-appropriate edges: a spec item its needs, a forwarding source its
// target (its own needs are excused, its covers are not), every item its
// covers and who wants it - so a code item's own needs stay visible on their
// targets, whatever origin those have
function edgeLines(item, byId, matchesOf, wantedBy, style, dimLocation) {
  const lines = [];
  if (item.forwardsTo !== null) lines.push(forwardEdge(item, byId, style, dimLocation));
  else if (item.origin === 'spec') lines.push(...needEdges(item, byId, matchesOf, style, dimLocation));
  lines.push(...coverEdges(item, byId, style, dimLocation));
  for (const wanting of wantedBy.get(item) ?? [])
    lines.push(`    ${style.dim('wanted by')} ${wanting.id}  ${dimLocation(wanting.file, wanting.line)}`);
  return lines;
}

// full item list for --verbose: every item with status and trace edges,
// grouped by file, then line
function renderVerbose(items, out, style, dimLocation) {
  const { byId, matchesOf, wantedBy } = buildResolver(items);
  const sorted = [...items].sort(byFileLine);
  let prevFile = null;
  for (const item of sorted) {
    if (prevFile !== null && item.file !== prevFile) out.push('');
    prevFile = item.file;
    const { mark, tag } = statusOf(item, style);
    const title = item.title ? ' ' + style.dim(`"${item.title}"`) : '';
    out.push(
      `${mark} ${style.bold(item.id)}${title}  ${dimLocation(item.file, item.line)}  ${tag}`,
      ...edgeLines(item, byId, matchesOf, wantedBy, style, dimLocation),
    );
    for (const defect of item.defects) out.push(`    ${style.red('•')} ${defect.message}`);
  }
  if (sorted.length) out.push('');
}

// the default report: one block per defective item only
function renderDefective(defective, out, style, dimLocation) {
  for (const item of defective) {
    const title = item.title ? ' ' + style.dim(`"${item.title}"`) : '';
    out.push(
      `${statusOf(item, style).mark} ${style.bold(item.id)}${title}  ${dimLocation(item.file, item.line)}`,
    );
    for (const defect of item.defects) out.push(`    ${style.red('•')} ${defect.message}`);
    out.push('');
  }
}

function renderSummary(summary, out, style) {
  const originBreakdown = style.dim(`(${summary.specItems} from specs, ${summary.codeItems} from code)`);

  out.push(
    style.bold('Summary'),
    `  items       ${summary.items}  ${originBreakdown}`,
    `  ok          ${style.green(String(summary.okItems))}`,
    `  defective   ${summary.defectiveItems ? style.red(String(summary.defectiveItems)) : '0'}`,
  );
  if (summary.shallowCoveredItems) out.push('  ' + style.dim(`of the ok items, ${summary.shallowCoveredItems} are only shallow-covered (an item further down the tracing chain is defective)`));
  if (summary.problems) out.push(`  problems    ${style.yellow(String(summary.problems))}`);
  out.push('');
}

export function report(items, problems, cwd, opts = {}) {
  const { verbose = false } = opts;
  const style = makeStyler();
  const relativePath = (file) => path.relative(cwd, file) || file;
  const dimLocation = (file, line) => style.dim(`${relativePath(file)}:${line}`);
  const summary = summarize(items, problems);
  const out = [];

  if (verbose) renderVerbose(items, out, style, dimLocation);
  else renderDefective(items.filter((item) => item.defects.length > 0), out, style, dimLocation);

  for (const problem of problems) {
    out.push(`${style.yellow('⚠')} ${problem.message}  ${dimLocation(problem.file, problem.line)}`);
  }
  if (problems.length) out.push('');

  renderSummary(summary, out, style);

  const clean = isClean(summary);
  out.push(clean ? style.green(style.bold('ok')) : style.red(style.bold('not ok')));
  console.log(out.join('\n'));
  return clean;
}
