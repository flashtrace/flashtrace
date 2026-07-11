/*
 * Self-contained HTML report: inline CSS and vanilla JS only, no external
 * requests. The report model and meta information are embedded as JSON; the
 * inline script renders the header and the active tab from that data, so the
 * markup goes through a single escaping path in the client renderer.
 */

export function renderHtml(model, meta) {
  // a "<" in the data (e.g. an item title containing "</script>") could
  // terminate the JSON script block early, so every "<" is emitted as its
  // JSON unicode escape, which decodes back to "<" when the block is
  // JSON.parsed. "<" only occurs inside JSON string values, so the blanket
  // replacement is safe.
  const data = JSON.stringify({ model, meta }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>flashtrace report</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #6a737d;
  --border: #d8dde3;
  --surface: #f6f8fa;
  --ok: #1a7f37;
  --warn: #9a6700;
  --bad: #cf222e;
  --accent: #0969da;
  --ok-bg: #dafbe1;
  --bad-bg: #ffebe9;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #8b949e;
    --border: #30363d;
    --surface: #161b22;
    --ok: #3fb950;
    --warn: #d29922;
    --bad: #f85149;
    --accent: #58a6ff;
    --ok-bg: #12261e;
    --bad-bg: #2d1215;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
  max-width: 60rem;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
code, .id, .loc, .edge, .defect, .problem, .fingerprint {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
header h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
header h1 .repo { color: var(--muted); font-weight: normal; }
.verdict {
  display: inline-block;
  margin: 0.25rem 0 0.75rem;
  padding: 0.15rem 0.75rem;
  border-radius: 999px;
  font-weight: 700;
}
.verdict.ok { color: var(--ok); background: var(--ok-bg); }
.verdict.bad { color: var(--bad); background: var(--bad-bg); }
.counts { margin: 0 0 0.75rem; }
.counts .num { font-weight: 700; }
.note { color: var(--muted); font-size: 0.875rem; margin: 0.25rem 0; }
.metaline { color: var(--muted); font-size: 0.875rem; margin: 0.15rem 0; }
.metaline .id { font-size: 0.8125rem; }
.tabs {
  display: flex;
  gap: 0.25rem;
  margin: 1.5rem 0 1rem;
  border-bottom: 1px solid var(--border);
}
.tabs button {
  appearance: none;
  border: none;
  background: none;
  color: var(--muted);
  font: inherit;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tabs button:hover { color: var(--fg); }
.tabs button.active {
  color: var(--fg);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
h2.file {
  margin: 1.5rem 0 0.5rem;
  font-size: 1rem;
  color: var(--muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.2rem;
}
.item { margin: 0.5rem 0 0.75rem; }
.item .head { font-size: 0.9375rem; }
.item .head .id { font-weight: 700; }
.item .title { color: var(--muted); }
.statustag { font-size: 0.8125rem; }
.mark.ok, .statustag.ok { color: var(--ok); }
.mark.warn, .statustag.warn { color: var(--warn); }
.mark.bad, .statustag.bad { color: var(--bad); }
.arrow { color: var(--accent); }
.rel { color: var(--muted); }
.loc { color: var(--muted); font-size: 0.8125rem; }
.edge, .defect { margin-left: 2rem; font-size: 0.875rem; }
.defect { color: var(--bad); }
.problem {
  margin: 0.5rem 0;
  font-size: 0.875rem;
  color: var(--warn);
}
.empty { color: var(--muted); }
</style>
</head>
<body>
<header id="header"></header>
<nav class="tabs" id="tabs">
<button data-tab="problems">Show problems</button>
<button data-tab="all">Show all (verbose)</button>
</nav>
<main id="content"></main>
<script type="application/json" id="data">${data}</script>
<script>
'use strict';
(() => {
  const { model, meta } = JSON.parse(document.getElementById('data').textContent);

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const CLASS = { 'deep-covered': 'ok', 'shallow-covered': 'warn', 'defective': 'bad' };
  const GLYPH = { 'deep-covered': '\\u2714', 'shallow-covered': '~', 'defective': '\\u2718' };
  const mark = (status) => '<span class="mark ' + CLASS[status] + '">' + GLYPH[status] + '</span>';
  const loc = (t) => '<span class="loc">' + esc(t.file) + ':' + t.line + '</span>';
  const idSpan = (id) => '<span class="id">' + esc(id) + '</span>';
  const MISSING = '<span class="mark bad">\\u2718 missing</span>';
  const at = (t) => mark(t.status) + ' ' + loc(t);

  function edgeHtml(e) {
    switch (e.kind) {
      case 'forwards':
        return '<div class="edge"><span class="arrow">\\u2192</span> ' + idSpan(e.ref) +
          '  ' + (e.target ? at(e.target) : MISSING) + '</div>';
      case 'needs': {
        const ref = idSpan(e.ref) +
          (e.resolvedId ? ' <span class="rel">(\\u2192 ' + esc(e.resolvedId) + ')</span>' : '');
        return '<div class="edge"><span class="rel">needs</span> ' + ref +
          '  ' + (e.target ? at(e.target) : MISSING) + '</div>';
      }
      case 'covers':
        return '<div class="edge"><span class="rel">covers</span> ' + idSpan(e.ref) +
          '  ' + (e.target ? '<span class="mark ok">\\u2714</span> ' + loc(e.target) : MISSING) + '</div>';
      case 'wantedBy':
        return '<div class="edge"><span class="rel">wanted by</span> ' + idSpan(e.ref) +
          '  ' + loc(e.target) + '</div>';
    }
    return '';
  }

  function itemHtml(it, withEdges) {
    const title = it.title ? ' <span class="title">"' + esc(it.title) + '"</span>' : '';
    const tag = withEdges
      ? '  <span class="statustag ' + CLASS[it.status] + '">[' + it.status + ']</span>'
      : '';
    let html = '<div class="item"><div class="head">' + mark(it.status) + ' ' +
      idSpan(it.id) + title + '  ' + loc(it) + tag + '</div>';
    if (withEdges) for (const e of it.edges) html += edgeHtml(e);
    for (const d of it.defects) html += '<div class="defect">\\u2022 ' + esc(d) + '</div>';
    return html + '</div>';
  }

  const problemHtml = (p) =>
    '<div class="problem">\\u26a0 ' + esc(p.message) + '  ' + loc(p) + '</div>';

  // the default report's content: defective items and parse problems only
  function renderProblems() {
    const parts = model.items.filter((it) => it.status === 'defective')
      .map((it) => itemHtml(it, false));
    parts.push(...model.problems.map(problemHtml));
    return parts.length ? parts.join('') : '<p class="empty">No defects or problems.</p>';
  }

  // the verbose report's content: every item with its trace edges, grouped by
  // file, followed by the parse problems
  function renderAll() {
    const parts = [];
    let file = null;
    for (const it of model.items) {
      if (it.file !== file) {
        parts.push('<h2 class="file">' + esc(it.file) + '</h2>');
        file = it.file;
      }
      parts.push(itemHtml(it, true));
    }
    parts.push(...model.problems.map(problemHtml));
    return parts.length ? parts.join('') : '<p class="empty">No items found.</p>';
  }

  // the repository state line: a release tag or the latest commit, with a
  // fingerprint of any uncommitted changes; omitted outside a git repository
  function repoLine(rs) {
    if (rs.kind === 'no-git') {
      return '<p class="metaline">git not found \\u2014 repository state unavailable</p>';
    }
    let line = rs.kind === 'release'
      ? esc(rs.tag)
      : esc(rs.subject) + ' <span class="loc">(' + esc(rs.shortSha) + ')</span>';
    if (rs.dirty) line += '<span class="loc">, uncommitted +' + esc(rs.fingerprint) + '</span>';
    return '<p class="metaline">repository: ' + line + '</p>';
  }

  function renderHeader() {
    const s = model.summary;
    const rs = meta.repoState;
    const repo = rs && rs.repo ? ' <span class="repo">\\u00b7 ' + esc(rs.repo) + '</span>' : '';
    const parts = ['<h1>flashtrace report' + repo + '</h1>'];
    parts.push('<div class="verdict ' + (s.clean ? 'ok">ok' : 'bad">not ok') + '</div>');
    parts.push('<p class="counts"><span class="num">' + s.items + '</span> items ' +
      '<span class="loc">(' + s.fromMarkdown + ' from markdown, ' + s.fromCode + ' from code)</span>' +
      ' \\u00b7 <span class="num mark ok">' + s.ok + '</span> ok' +
      ' \\u00b7 <span class="num' + (s.defective ? ' mark bad' : '') + '">' + s.defective + '</span> defective' +
      (s.problems ? ' \\u00b7 <span class="num mark warn">' + s.problems + '</span> problems' : '') +
      '</p>');
    if (s.shallowOnly) {
      parts.push('<p class="note">of the ok items, ' + s.shallowOnly +
        ' are only shallow-covered (an item further down the tracing chain is defective)</p>');
    }
    parts.push('<p class="metaline">scanned: ' + meta.scannedPaths.map(esc).join(', ') + '</p>');
    if (meta.tags) parts.push('<p class="metaline">tags filter: ' + meta.tags.map(esc).join(', ') + '</p>');
    if (rs && rs.kind !== 'none') parts.push(repoLine(rs));
    parts.push('<p class="metaline">flashtrace v' + esc(meta.version) + '</p>');
    document.getElementById('header').innerHTML = parts.join('');
  }

  const tabs = { problems: renderProblems, all: renderAll };
  const buttons = document.querySelectorAll('#tabs button');
  function show(name) {
    for (const b of buttons) b.classList.toggle('active', b.dataset.tab === name);
    document.getElementById('content').innerHTML = tabs[name]();
  }
  for (const b of buttons) b.addEventListener('click', () => show(b.dataset.tab));

  renderHeader();
  show('problems');
})();
</script>
</body>
</html>
`;
}
