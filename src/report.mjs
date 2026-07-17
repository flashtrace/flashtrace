import path from 'node:path';
import process from 'node:process';

import { buildResolver } from './analyze.mjs';
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

function buildWantedBy(items, byId, matchesOf) {
  const wantedBy = new Map(); // item -> items whose needs it satisfies
  for (const item of items)
    for (const need of item.needs)
      for (const id of matchesOf(need))
        for (const provider of byId.get(id))
          (wantedBy.get(provider) ?? wantedBy.set(provider, new Set()).get(provider)).add(item);
  return wantedBy;
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

// role-appropriate edges: a markdown item its needs, a forwarding source its
// target (its own needs are excused, its covers are not), every item its
// covers and who wants it - so a code item's own needs stay visible on their
// targets, whatever origin those have
function edgeLines(item, byId, matchesOf, wantedBy, style, dimLocation) {
  const lines = [];
  if (item.forwardsTo !== null) lines.push(forwardEdge(item, byId, style, dimLocation));
  else if (item.origin === 'markdown') lines.push(...needEdges(item, byId, matchesOf, style, dimLocation));
  lines.push(...coverEdges(item, byId, style, dimLocation));
  for (const wanting of wantedBy.get(item) ?? [])
    lines.push(`    ${style.dim('wanted by')} ${wanting.id}  ${dimLocation(wanting.file, wanting.line)}`);
  return lines;
}

// full item list for --verbose: every item with status and trace edges,
// grouped by file, then line
function renderVerbose(items, out, style, dimLocation) {
  const { byId, matchesOf } = buildResolver(items);
  const wantedBy = buildWantedBy(items, byId, matchesOf);
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
    for (const defect of item.defects) out.push(`    ${style.red('•')} ${defect}`);
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
    for (const defect of item.defects) out.push(`    ${style.red('•')} ${defect}`);
    out.push('');
  }
}

function renderSummary(items, defective, errorCount, warningCount, out, style) {
  const okCount = items.length - defective.length;
  const shallowCount = items.filter((item) => item.defects.length === 0 && !item.deepCovered).length;
  const markdownCount = items.filter((item) => item.origin === 'markdown').length;
  const originBreakdown = style.dim(`(${markdownCount} from markdown, ${items.length - markdownCount} from code)`);

  out.push(
    style.bold('Summary'),
    `  items       ${items.length}  ${originBreakdown}`,
    `  ok          ${style.green(String(okCount))}`,
    `  defective   ${defective.length ? style.red(String(defective.length)) : '0'}`,
  );
  if (shallowCount) out.push('  ' + style.dim(`of the ok items, ${shallowCount} are only shallow-covered (an item further down the tracing chain is defective)`));
  if (errorCount) out.push(`  errors      ${style.red(String(errorCount))}`);
  if (warningCount) out.push(`  warnings    ${style.yellow(String(warningCount))}`);
  out.push('');
}

// an error problem means flashtrace could not correctly process the input and
// fails the run; a warning points out suspicious but handled usage. The error
// mark deliberately differs from the ✘ that marks defective items.
function problemMark(problem, style) {
  return problem.severity === 'warning' ? style.yellow('⚠') : style.red('‼');
}

export function report(items, problems, cwd, opts = {}) {
  const { verbose = false } = opts;
  const style = makeStyler();
  const relativePath = (file) => path.relative(cwd, file) || file;
  const dimLocation = (file, line) => style.dim(`${relativePath(file)}:${line}`);
  const defective = items.filter((item) => item.defects.length > 0);
  const warningCount = problems.filter((problem) => problem.severity === 'warning').length;
  const errorCount = problems.length - warningCount;
  const out = [];

  if (verbose) renderVerbose(items, out, style, dimLocation);
  else renderDefective(defective, out, style, dimLocation);

  for (const problem of problems) {
    out.push(`${problemMark(problem, style)} ${problem.message}  ${dimLocation(problem.file, problem.line)}`);
  }
  if (problems.length) out.push('');

  renderSummary(items, defective, errorCount, warningCount, out, style);

  const clean = defective.length === 0 && errorCount === 0;
  out.push(clean ? style.green(style.bold('ok')) : style.red(style.bold('not ok')));
  console.log(out.join('\n'));
  return clean;
}
