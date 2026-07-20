/*
 * JSON report (--format json): the run as a single JSON document on stdout,
 * in place of the plain-text report. It carries every item with its declared
 * references, their resolution, its defects and the items that want it, plus
 * every forwarding declaration, all problems and the summary.
 *
 * The document is deterministic: items, forwards and problems are sorted by
 * file, then line, then character; object keys serialize in a fixed order; the
 * output is two-space indented and ends with a single newline. See
 * schemas/report/v0.json for the contract and docs/json-report.md for how the
 * format is invoked and what it guarantees beyond the schema.
 */

import path from 'node:path';

import { buildResolver, isClean, summarize } from './analyze.mjs';
import { compareRev, revOf } from './ids.mjs';

// 0 marks the format unstable; it becomes 1 with flashtrace 1.0.0
const SCHEMA_VERSION = 0;

// item status, matching the three states the summary and verbose report show
function statusOf(item) {
  if (item.defects.length > 0) return 'defective';
  return item.deepCovered ? 'deep-covered' : 'shallow-covered';
}

// covers ref -> its status, read off the defects analyze raised rather than
// re-deciding the coverage rules here: it emits orphaned-cover / unwanted-cover
// for exactly the refs that are not valid, so anything unmentioned is valid.
function coverStatusOf(item) {
  const status = new Map();
  for (const defect of item.defects) {
    if (defect.kind === 'orphaned-cover') status.set(defect.ref, 'orphaned');
    else if (defect.kind === 'unwanted-cover') status.set(defect.ref, 'unwanted');
  }
  return (ref) => status.get(ref) ?? 'valid';
}

// defect record in documented key order: existingRevisions, when present, sits
// before the message
function defectDocument(defect) {
  const out = { kind: defect.kind, ref: defect.ref };
  if (defect.existingRevisions) out.existingRevisions = defect.existingRevisions;
  out.message = defect.message;
  return out;
}

export function buildReportDocument(items, forwards, problems, cwd, opts = {}) {
  const { version } = opts;
  const relative = (file) => (path.relative(cwd, file) || file).replaceAll('\\', '/');
  const location = (x) => ({ file: relative(x.file), line: x.line, character: x.character });
  const byLocation = (a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.character - b.character;
  };

  const { matchesOf, wantedBy } = buildResolver(items);

  // a need's resolution: the defined IDs matching it, ascending by revision
  const resolvedTo = (ref) =>
    matchesOf(ref)
      .slice()
      .sort((a, b) => compareRev(revOf(a), revOf(b)));

  const wantedByDocument = (item) =>
    [...(wantedBy.get(item) ?? [])]
      .map((wanter) => ({ id: wanter.id, ...location(wanter) }))
      .sort(byLocation);

  const itemDocument = (item) => {
    const coverStatus = coverStatusOf(item);
    return {
      id: item.id,
      title: item.title,
      origin: item.origin,
      tags: item.tags,
      ...location(item),
      status: statusOf(item),
      needs: item.needs.map((ref) => ({ ref, resolvedTo: resolvedTo(ref) })),
      covers: item.covers.map((ref) => ({ ref, status: coverStatus(ref) })),
      forwardsTo: item.forwardsTo,
      defects: item.defects.map(defectDocument),
      wantedBy: wantedByDocument(item),
    };
  };

  const forwardDocument = (forward) => {
    const document = { from: forward.from, to: forward.to, ...location(forward), effective: forward.effective };
    if (!forward.effective) document.voidedBy = forward.voidedBy;
    return document;
  };

  const itemDocuments = items.map(itemDocument).sort(byLocation);
  const problemDocuments = problems
    .map((problem) => ({ ...location(problem), message: problem.message }))
    .sort(byLocation);

  // summarize returns the counts already in the document's key order
  const summary = summarize(items, problems);

  return {
    schemaVersion: SCHEMA_VERSION,
    flashtrace: version,
    ok: isClean(summary),
    items: itemDocuments,
    forwards: forwards.map(forwardDocument).sort(byLocation),
    problems: problemDocuments,
    summary,
  };
}

// Build the JSON document, print it, and return the run verdict (true iff no
// item is defective and no problem occurred - the same verdict, and exit code,
// as the plain-text report).
export function reportJson(items, forwards, problems, cwd, opts = {}) {
  const document = buildReportDocument(items, forwards, problems, cwd, opts);
  console.log(JSON.stringify(document, null, 2));
  return document.ok;
}
