import {
  duplicateForwarding,
  duplicateId,
  orphanedCover,
  uncoveredForward,
  uncoveredNeed,
  unwantedCover,
  unwantedItem,
} from './defects.mjs';
import { canonicalId, compareRev, idMatches, isWildcardRev, keyOf, revOf } from './ids.mjs';

// a forwarded item (source of an [A --> B] tag) has its own needs excused; its
// coverage obligation is redirected to the target, checked here instead.
// matchesOf(ref) returns the defined items satisfying a (possibly wildcard)
// need; isNeeded(id) tells whether any need - exact or wildcard - wants that id.
// withRevisions adds the revision-mismatch hint to a defect where it applies.
function checkItemReferences(item, byId, matchesOf, isNeeded, withRevisions, forwardTargets) {
  const forwardTarget = forwardTargets.get(canonicalId(item.id));
  if (forwardTarget !== undefined) {
    if (!byId.has(canonicalId(forwardTarget)))
      item.defects.push(withRevisions(uncoveredForward(forwardTarget)));
  } else {
    for (const need of item.needs) {
      if (matchesOf(need).length === 0)
        item.defects.push(withRevisions(uncoveredNeed(need)));
    }
  }
  for (const coverId of item.covers) {
    const targets = byId.get(canonicalId(coverId));
    if (!targets) {
      item.defects.push(withRevisions(orphanedCover(coverId)));
    } else if (!targets.some((target) => target.needs.some((need) => idMatches(need, item.id)))) {
      item.defects.push(unwantedCover(coverId, item.id));
    }
  }
  if (item.origin === 'code' && !isNeeded(item.id)) {
    item.defects.push(unwantedItem(item.id));
  }
}

// forwarding chains must be acyclic (self-forwarding included); every
// forwarding on a cycle is reported as a problem, voided, and has no effect
function dropCyclicForwards(forwardTargets, declarationBySource, problems) {
  const done = new Set(); // ids verified to not sit on a cycle
  for (const start of forwardTargets.keys()) {
    if (done.has(start)) continue;
    const seen = new Map(); // id -> position in the walked path
    const path = [];
    let current = start;
    while (forwardTargets.has(current) && !done.has(current) && !seen.has(current)) {
      seen.set(current, path.length);
      path.push(current);
      current = canonicalId(forwardTargets.get(current));
    }
    if (seen.has(current)) {
      const cycle = path.slice(seen.get(current));
      // the walk runs on canonical IDs; show each source as its declaration wrote it
      const chain = [...cycle, current].map((id) => declarationBySource.get(id).from).join(' --> ');
      for (const id of cycle) {
        const declaration = declarationBySource.get(id);
        declaration.effective = false;
        declaration.voidedBy = 'cycle';
        problems.push({
          file: declaration.file,
          line: declaration.line,
          character: declaration.character,
          message: `cyclic forwarding: ${chain}`,
        });
        forwardTargets.delete(id);
      }
    }
    for (const id of path) done.add(id);
  }
}

// forwarding [A --> B]: A's coverage obligation is redirected to B - A's own
// needs are excused; A is covered iff B exists, deep-covered iff B is. Builds
// the source -> target map, reporting missing sources and duplicate/cyclic
// declarations, and marks each surviving target as wanted coverage. Every
// forward is annotated with `effective` and, when voided, `voidedBy` (the
// item forwardsTo fields mirror exactly the effective declarations).
function buildForwardMap(forwards, byId, neededIds, revHint, problems) {
  const forwardTargets = new Map();
  const declarationBySource = new Map(); // effective (first) declaration per source
  const forwardsBySource = new Map(); // keyed canonically so SemVer-equal sources meet
  for (const forward of forwards) {
    const from = canonicalId(forward.from);
    (forwardsBySource.get(from) ?? forwardsBySource.set(from, []).get(from)).push(forward);
  }
  for (const [from, group] of forwardsBySource) {
    const sources = byId.get(from);
    if (!sources) {
      for (const forward of group) {
        forward.effective = false;
        forward.voidedBy = 'missing-source';
        problems.push({
          file: forward.file,
          line: forward.line,
          character: forward.character,
          message: `forwarding from ${forward.from}, which does not exist${revHint(forward.from)}`,
        });
      }
      continue;
    }
    // only the first declaration takes effect; later ones for the same source
    // are voided as duplicates (and flagged as a defect on the source item)
    if (group.length > 1)
      for (const item of sources) item.defects.push(duplicateForwarding(group[0].from, group.length));
    group[0].effective = true;
    for (let i = 1; i < group.length; i++) {
      group[i].effective = false;
      group[i].voidedBy = 'duplicate';
    }
    forwardTargets.set(from, group[0].to);
    declarationBySource.set(from, group[0]);
  }
  dropCyclicForwards(forwardTargets, declarationBySource, problems);
  for (const to of forwardTargets.values()) neededIds.add(canonicalId(to)); // a forwarding target is wanted coverage
  return forwardTargets;
}

// deep coverage: all needs exist and are themselves deep-covered (cycle-safe);
// a forwarded ID follows its target instead of its own needs. A need may be a
// wildcard: it is deep-covered when at least one matching item is deep-covered.
function markDeepCoverage(items, byId, matchesOf, forwardTargets) {
  const memo = new Map();
  const deep = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, true); // cycle guard
    const group = byId.get(id);
    if (!group) {
      memo.set(id, false);
      return false;
    }
    const forwardTarget = forwardTargets.get(id);
    let ok = true;
    if (forwardTarget !== undefined) {
      ok = deep(canonicalId(forwardTarget));
    } else {
      for (const item of group) for (const need of item.needs) if (!needDeep(need)) ok = false;
    }
    memo.set(id, ok);
    return ok;
  };
  const needDeep = (need) => matchesOf(need).some((id) => deep(id));
  for (const item of items) item.deepCovered = deep(canonicalId(item.id));
}

// defined IDs grouped by their key (everything but the revision), so a wildcard
// need can be resolved against the revisions sharing its key
function groupIdsByKey(byId) {
  const idsByKey = new Map();
  for (const id of byId.keys())
    (idsByKey.get(keyOf(id)) ?? idsByKey.set(keyOf(id), []).get(keyOf(id))).push(id);
  return idsByKey;
}

// item -> the items whose needs resolve to it, wildcard needs included: the
// inverse of need resolution. Note this counts declared needs only - an item
// wanted solely as a forwarding target has no entry here (see isNeeded, which
// does count forwarding demand).
function buildWantedBy(items, byId, matchesOf) {
  const wantedBy = new Map();
  for (const item of items)
    for (const need of item.needs)
      for (const id of matchesOf(need))
        for (const provider of byId.get(id))
          (wantedBy.get(provider) ?? wantedBy.set(provider, new Set()).get(provider)).add(item);
  return wantedBy;
}

// items grouped by canonical ID plus need resolution over them: matchesOf(ref)
// returns the defined canonical IDs satisfying a (possibly wildcard)
// reference, wantedBy the inverse edge. Shared with both reports so what they
// render cannot drift from what analyze checked.
export function buildResolver(items) {
  const byId = new Map(); // canonical ID -> items (each keeps its raw item.id for display)
  for (const item of items) {
    const id = canonicalId(item.id);
    (byId.get(id) ?? byId.set(id, []).get(id)).push(item);
  }
  const idsByKey = groupIdsByKey(byId);
  const matchesOf = (ref) => (idsByKey.get(keyOf(ref)) ?? []).filter((id) => idMatches(ref, id));
  return { byId, matchesOf, wantedBy: buildWantedBy(items, byId, matchesOf) };
}

// the single status label both reports render, decided here alone so they
// cannot disagree on it. "defective" wins over the coverage axis and so hides
// whether the item is deep-covered; the JSON document carries `defective` and
// `deepCovered` beside the label for the two independently.
export function statusOf(item) {
  if (item.defects.length > 0) return 'defective';
  return item.deepCovered ? 'deep-covered' : 'shallow-covered';
}

// the counts both reports show, in the key order the JSON document uses.
// Derived here alone so the two reports cannot disagree on them.
export function summarize(items, problems) {
  const specItems = items.filter((item) => item.origin === 'spec').length;
  const defectiveItems = items.filter((item) => item.defects.length > 0).length;
  const shallowCoveredItems = items.filter(
    (item) => item.defects.length === 0 && !item.deepCovered,
  ).length;
  return {
    items: items.length,
    specItems,
    codeItems: items.length - specItems,
    okItems: items.length - defectiveItems,
    defectiveItems,
    shallowCoveredItems,
    problems: problems.length,
  };
}

// the run verdict both reports end on, and the exit code behind it
export const isClean = (summary) => summary.defectiveItems === 0 && summary.problems === 0;

// split all need references into exact IDs (fast membership) and wildcard
// patterns (matched individually)
function splitNeeds(items) {
  const exact = new Set();
  const wildcard = [];
  for (const item of items)
    for (const need of item.needs) {
      if (isWildcardRev(revOf(need))) wildcard.push(need);
      else exact.add(canonicalId(need));
    }
  return { exact, wildcard };
}

export function analyze(items, forwards = [], problems = []) {
  const { byId, matchesOf } = buildResolver(items);
  const revsByKey = new Map();
  for (const item of items)
    (revsByKey.get(item.key) ?? revsByKey.set(item.key, new Set()).get(item.key)).add(item.revision);

  // is a code item wanted? an exact need matches by ID, a wildcard by pattern;
  // forwarding targets are added to the exact set below
  const { exact: exactNeeds, wildcard: wildcardNeeds } = splitNeeds(items);
  const isNeeded = (id) => exactNeeds.has(canonicalId(id)) || wildcardNeeds.some((wildcard) => idMatches(wildcard, id));

  for (const [id, group] of byId) {
    if (group.length > 1) {
      // written identically -> show that spelling; SemVer-equal spellings -> the canonical ID
      const shown = group.every((item) => item.id === group[0].id) ? group[0].id : id;
      for (const item of group) item.defects.push(duplicateId(shown, group.length));
    }
  }

  // sibling revisions of a key, ascending - the revision-mismatch hint's data
  const existingRevisionsOf = (id) => {
    const revs = revsByKey.get(keyOf(id));
    return revs ? [...revs].sort(compareRev) : null;
  };
  // string hint for a problem message (missing forwarding source)
  const revHint = (id) => {
    const revs = existingRevisionsOf(id);
    return revs ? ` (revision mismatch: existing revision(s) of ${keyOf(id)}: ${revs.join(', ')})` : '';
  };
  // a defect about a missing ID gains existingRevisions, and the same hint in
  // its message, exactly when a sibling revision of its ref's key exists
  const withRevisions = (defect) => {
    const existingRevisions = existingRevisionsOf(defect.ref);
    if (!existingRevisions) return defect;
    return {
      kind: defect.kind,
      ref: defect.ref,
      existingRevisions,
      message: `${defect.message} (revision mismatch: existing revision(s) of ${keyOf(defect.ref)}: ${existingRevisions.join(', ')})`,
    };
  };

  const forwardTargets = buildForwardMap(forwards, byId, exactNeeds, revHint, problems);

  for (const item of items) {
    item.forwardsTo = forwardTargets.get(canonicalId(item.id)) ?? null; // effective forwarding target, for renderers
    checkItemReferences(item, byId, matchesOf, isNeeded, withRevisions, forwardTargets);
  }

  markDeepCoverage(items, byId, matchesOf, forwardTargets);
}
