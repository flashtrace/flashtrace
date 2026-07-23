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

import { buildResolver, isClean, statusOf, summarize } from './analyze.mjs';
import { canonicalId, compareRev, revOf } from './ids.mjs';

// 0 marks the format unstable; it becomes 1 with flashtrace 1.0.0
const SCHEMA_VERSION = 0;

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

// item -> the items whose effective forwarding targets it. Built from the
// items' own forwardsTo rather than from the forwards array, so it is the
// exact inverse of that field by construction and the two cannot disagree.
// A forwardsTo naming an item that does not exist contributes nothing.
function buildForwardedFrom(items, byId) {
  const forwardedFrom = new Map();
  for (const item of items) {
    if (item.forwardsTo === null) continue;
    for (const target of byId.get(canonicalId(item.forwardsTo)) ?? [])
      (forwardedFrom.get(target) ?? forwardedFrom.set(target, []).get(target)).push(item);
  }
  return forwardedFrom;
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
  // the schema requires the `flashtrace` field, and JSON.stringify would
  // silently drop it when undefined - refuse to build a non-conforming document
  if (typeof version !== 'string')
    throw new TypeError('opts.version is required: it becomes the document\'s "flashtrace" field');
  const relative = (file) => (path.relative(cwd, file) || file).replaceAll('\\', '/');
  const location = (x) => ({ file: relative(x.file), line: x.line, character: x.character });
  const byLocation = (a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.character - b.character;
  };

  const { byId, matchesOf, wantedBy } = buildResolver(items);
  const forwardedFrom = buildForwardedFrom(items, byId);

  // a need's resolution: the matching items' IDs as written, ascending by
  // revision. matchesOf filters, so it already hands back an array of its own
  // to sort; each canonical match maps back to the defined spellings behind it.
  const resolvedTo = (ref) => [
    ...new Set(
      matchesOf(ref)
        .sort((a, b) => compareRev(revOf(a), revOf(b)))
        .flatMap((id) => byId.get(id).map((item) => item.id)),
    ),
  ];

  // both inverse edges serialize as located item references, sorted alike
  const itemRefs = (related) =>
    [...related].map((other) => ({ id: other.id, ...location(other) })).sort(byLocation);

  const itemDocument = (item) => {
    const coverStatus = coverStatusOf(item);
    return {
      id: item.id,
      title: item.title,
      origin: item.origin,
      tags: item.tags,
      ...location(item),
      status: statusOf(item),
      defective: item.defects.length > 0,
      deepCovered: item.deepCovered,
      needs: item.needs.map((ref) => ({ ref, resolvedTo: resolvedTo(ref) })),
      covers: item.covers.map((ref) => ({ ref, status: coverStatus(ref) })),
      forwardsTo: item.forwardsTo,
      forwardedFrom: itemRefs(forwardedFrom.get(item) ?? []),
      defects: item.defects.map(defectDocument),
      wantedBy: itemRefs(wantedBy.get(item) ?? []),
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
