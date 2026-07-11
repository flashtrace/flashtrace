/*
 * The report model: pure, JSON-serializable data derived from the analyzed
 * items, shared by every renderer so their edges and statuses cannot drift.
 * File paths are relativized to the given cwd.
 */

import path from 'node:path';

import { buildResolver } from './analyze.mjs';
import { isWildcardRev, revOf } from './ids.mjs';

// the three states the summary distinguishes
function statusOf(it) {
  if (it.defects.length > 0) return 'defective';
  if (!it.deepCovered) return 'shallow-covered';
  return 'deep-covered';
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

// a need or forwarding edge carries this item's coverage obligation, so its
// target carries the target's own status - not bare existence - making a
// shallow-covered item's broken chain diagnosable in place
function targetOf(it, rel) {
  return { file: rel(it.file), line: it.line, status: statusOf(it) };
}

// one edge per resolved need: the covering item's own status and location, or
// target: null for a missing one; a wildcard reference yields one edge per
// resolved revision, carrying it as resolvedId
function needEdges(it, byId, matchesOf, rel) {
  const edges = [];
  for (const n of it.needs) {
    const ids = matchesOf(n);
    if (ids.length === 0) {
      edges.push({ kind: 'needs', ref: n, target: null });
      continue;
    }
    const wild = isWildcardRev(revOf(n));
    for (const id of ids) {
      const edge = { kind: 'needs', ref: n, target: targetOf(byId.get(id)[0], rel) };
      if (wild) edge.resolvedId = id;
      edges.push(edge);
    }
  }
  return edges;
}

// role-appropriate edges: a markdown item its needs, a forwarding source its
// target (its own needs are excused, its covers are not), every item its
// covers and who wants it - so a code item's own needs stay visible on their
// targets, whatever origin those have. Covers references are concrete IDs;
// the relation's validation (orphaned, unwanted) is carried by the defect
// list, the edge shows existence.
function edgesOf(it, byId, matchesOf, wantedBy, rel) {
  const edges = [];
  if (it.forwardsTo !== null) {
    const target = byId.get(it.forwardsTo)?.[0];
    edges.push({ kind: 'forwards', ref: it.forwardsTo, target: target ? targetOf(target, rel) : null });
  } else if (it.origin === 'markdown') {
    edges.push(...needEdges(it, byId, matchesOf, rel));
  }
  for (const cv of it.covers) {
    const target = byId.get(cv)?.[0];
    edges.push({ kind: 'covers', ref: cv, target: target ? targetOf(target, rel) : null });
  }
  for (const w of wantedBy.get(it) ?? [])
    edges.push({ kind: 'wantedBy', ref: w.id, target: { file: rel(w.file), line: w.line } });
  return edges;
}

export function buildReportModel(items, problems, cwd) {
  const { byId, matchesOf } = buildResolver(items);
  const wantedBy = buildWantedBy(items, byId, matchesOf);
  const rel = (f) => path.relative(cwd, f) || f;

  const modelItems = [...items].sort(byFileLine).map((it) => ({
    id: it.id,
    title: it.title,
    file: rel(it.file),
    line: it.line,
    origin: it.origin,
    tags: it.tags,
    status: statusOf(it),
    defects: it.defects,
    edges: edgesOf(it, byId, matchesOf, wantedBy, rel),
  }));

  const defective = items.filter((it) => it.defects.length > 0).length;
  const shallowOnly = items.filter((it) => it.defects.length === 0 && !it.deepCovered).length;
  const fromMarkdown = items.filter((it) => it.origin === 'markdown').length;

  return {
    items: modelItems,
    problems: problems.map((p) => ({ file: rel(p.file), line: p.line, message: p.message })),
    summary: {
      items: items.length,
      fromMarkdown,
      fromCode: items.length - fromMarkdown,
      ok: items.length - defective,
      defective,
      shallowOnly,
      problems: problems.length,
      clean: defective === 0 && problems.length === 0,
    },
  };
}
