import process from 'node:process';

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

// marker + label for the three states the model distinguishes
function markOf(status, c) {
  if (status === 'defective') return c.red('✘');
  if (status === 'shallow-covered') return c.yellow('~');
  return c.green('✔');
}

function tagOf(status, c) {
  if (status === 'defective') return c.red('[defective]');
  if (status === 'shallow-covered') return c.yellow('[shallow-covered]');
  return c.green('[deep-covered]');
}

function edgeLine(e, c, dimLoc) {
  const missing = c.red('✘ missing');
  const at = (t) => `${markOf(t.status, c)} ${dimLoc(t)}`;
  switch (e.kind) {
    case 'forwards':
      return `    ${c.cyan('→')} ${e.ref}  ${e.target ? at(e.target) : missing}`;
    case 'needs': {
      const arrow = e.resolvedId ? ' ' + c.dim(`(→ ${e.resolvedId})`) : '';
      return `    ${c.dim('needs')} ${e.ref}${arrow}  ${e.target ? at(e.target) : missing}`;
    }
    // an existing covers target shows bare existence, not its status: covers
    // is not part of this item's own coverage chain
    case 'covers': {
      const exists = e.target ? `${c.green('✔')} ${dimLoc(e.target)}` : missing;
      return `    ${c.dim('covers')} ${e.ref}  ${exists}`;
    }
    case 'wantedBy':
      return `    ${c.dim('wanted by')} ${e.ref}  ${dimLoc(e.target)}`;
  }
}

// full item list for --verbose: every item with status and trace edges,
// grouped by file, then line
function renderVerbose(items, out, c, dimLoc) {
  let prevFile = null;
  for (const it of items) {
    if (prevFile !== null && it.file !== prevFile) out.push('');
    prevFile = it.file;
    const title = it.title ? ' ' + c.dim(`"${it.title}"`) : '';
    out.push(
      `${markOf(it.status, c)} ${c.bold(it.id)}${title}  ${dimLoc(it)}  ${tagOf(it.status, c)}`,
      ...it.edges.map((e) => edgeLine(e, c, dimLoc)),
    );
    for (const d of it.defects) out.push(`    ${c.red('•')} ${d}`);
  }
  if (items.length) out.push('');
}

// the default report: one block per defective item only
function renderDefective(items, out, c, dimLoc) {
  for (const it of items) {
    if (it.status !== 'defective') continue;
    const title = it.title ? ' ' + c.dim(`"${it.title}"`) : '';
    out.push(`${markOf(it.status, c)} ${c.bold(it.id)}${title}  ${dimLoc(it)}`);
    for (const d of it.defects) out.push(`    ${c.red('•')} ${d}`);
    out.push('');
  }
}

function renderSummary(s, out, c) {
  const originBreakdown = c.dim(`(${s.fromMarkdown} from markdown, ${s.fromCode} from code)`);
  out.push(
    c.bold('Summary'),
    `  items       ${s.items}  ${originBreakdown}`,
    `  ok          ${c.green(String(s.ok))}`,
    `  defective   ${s.defective ? c.red(String(s.defective)) : '0'}`,
  );
  if (s.shallowOnly) out.push('  ' + c.dim(`of the ok items, ${s.shallowOnly} are only shallow-covered (an item further down the tracing chain is defective)`));
  if (s.problems) out.push(`  problems    ${c.yellow(String(s.problems))}`);
  out.push('');
}

export function report(model, opts = {}) {
  const { verbose = false } = opts;
  const c = makeStyler();
  const dimLoc = (t) => c.dim(`${t.file}:${t.line}`);
  const out = [];

  if (verbose) renderVerbose(model.items, out, c, dimLoc);
  else renderDefective(model.items, out, c, dimLoc);

  for (const p of model.problems) {
    out.push(`${c.yellow('⚠')} ${p.message}  ${dimLoc(p)}`);
  }
  if (model.problems.length) out.push('');

  renderSummary(model.summary, out, c);
  console.log(out.join('\n'));
}

// the final verdict line; printed separately so a "report written to" note
// can sit between the report body and the verdict
export function printVerdict(clean) {
  const c = makeStyler();
  console.log(clean ? c.green(c.bold('ok')) : c.red(c.bold('not ok')));
}
