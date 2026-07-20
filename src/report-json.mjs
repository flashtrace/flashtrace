/*
 * JSON report (--json): the run as a single JSON document on stdout, in place
 * of the plain-text report. It carries every item with its declared
 * references, their resolution, its defects and the items that want it, plus
 * every forwarding declaration, all problems and the summary.
 *
 * The document is deterministic: items, forwards and problems are sorted by
 * file, then line, then character; object keys serialize in a fixed order; the
 * output is two-space indented and ends with a single newline. See
 * docs/json-report.md for the contract and schemas/report/v1.json for the
 * machine-readable schema.
 */

import path from 'node:path';

import { buildResolver } from './analyze.mjs';
import { compareRev, idMatches, revOf } from './ids.mjs';

const SCHEMA_VERSION = 1;

// item status, matching the three states the summary and verbose report show
function statusOf(item) {
  if (item.defects.length > 0) return 'defective';
  return item.deepCovered ? 'deep-covered' : 'shallow-covered';
}

// a covers relation classified per the coverage rules: valid when the target
// exists and needs this item, orphaned when it does not exist, unwanted otherwise
function coverStatus(item, coverId, byId) {
  const targets = byId.get(coverId);
  if (!targets) return 'orphaned';
  return targets.some((target) => target.needs.some((need) => idMatches(need, item.id)))
    ? 'valid'
    : 'unwanted';
}

// item -> the items whose needs resolve to it (wildcard needs included), the
// data behind an item's wantedBy. Mirrors the verbose report's edge so the two
// cannot drift.
function buildWantedBy(items, byId, matchesOf) {
  const wantedBy = new Map();
  for (const item of items)
    for (const need of item.needs)
      for (const id of matchesOf(need))
        for (const provider of byId.get(id))
          (wantedBy.get(provider) ?? wantedBy.set(provider, new Set()).get(provider)).add(item);
  return wantedBy;
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

  const { byId, matchesOf } = buildResolver(items);
  const wantedBy = buildWantedBy(items, byId, matchesOf);

  // a need's resolution: the defined IDs matching it, ascending by revision
  const resolvedTo = (ref) =>
    matchesOf(ref)
      .slice()
      .sort((a, b) => compareRev(revOf(a), revOf(b)));

  const wantedByDocument = (item) =>
    [...(wantedBy.get(item) ?? [])]
      .map((wanter) => ({ id: wanter.id, ...location(wanter) }))
      .sort(byLocation);

  const itemDocument = (item) => ({
    id: item.id,
    title: item.title,
    origin: item.origin,
    tags: item.tags,
    ...location(item),
    status: statusOf(item),
    needs: item.needs.map((ref) => ({ ref, resolvedTo: resolvedTo(ref) })),
    covers: item.covers.map((ref) => ({ ref, status: coverStatus(item, ref, byId) })),
    forwardsTo: item.forwardsTo,
    defects: item.defects.map(defectDocument),
    wantedBy: wantedByDocument(item),
  });

  const forwardDocument = (forward) => {
    const document = { from: forward.from, to: forward.to, ...location(forward), effective: forward.effective };
    if (!forward.effective) document.voidedBy = forward.voidedBy;
    return document;
  };

  const itemDocuments = items.map(itemDocument).sort(byLocation);
  const problemDocuments = problems
    .map((problem) => ({ ...location(problem), message: problem.message }))
    .sort(byLocation);

  const markdownItems = items.filter((item) => item.origin === 'markdown').length;
  const defectiveItems = items.filter((item) => item.defects.length > 0).length;
  const shallowCoveredItems = items.filter(
    (item) => item.defects.length === 0 && !item.deepCovered,
  ).length;
  const ok = defectiveItems === 0 && problems.length === 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    flashtrace: version,
    ok,
    items: itemDocuments,
    forwards: forwards.map(forwardDocument).sort(byLocation),
    problems: problemDocuments,
    summary: {
      items: items.length,
      markdownItems,
      codeItems: items.length - markdownItems,
      okItems: items.length - defectiveItems,
      defectiveItems,
      shallowCoveredItems,
      problems: problems.length,
    },
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
