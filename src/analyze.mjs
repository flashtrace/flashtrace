import { compareRev, idMatches, isWildcardRev, keyOf, revOf } from './ids.mjs';

// a forwarded item (source of an [A --> B] tag) has its own needs excused; its
// coverage obligation is redirected to the target, checked here instead.
// matchesOf(ref) returns the defined items satisfying a (possibly wildcard)
// need; isNeeded(id) tells whether any need - exact or wildcard - wants that id
function checkItemReferences(item, byId, matchesOf, isNeeded, revHint, forwardTargets) {
  const forwardTarget = forwardTargets.get(item.id);
  if (forwardTarget !== undefined) {
    if (!byId.has(forwardTarget))
      item.defects.push(`uncovered: forwards to ${forwardTarget}, which does not exist${revHint(forwardTarget)}`);
  } else {
    for (const need of item.needs) {
      if (matchesOf(need).length === 0)
        item.defects.push(`uncovered: needs ${need}, which does not exist${revHint(need)}`);
    }
  }
  for (const coverId of item.covers) {
    const targets = byId.get(coverId);
    if (!targets) {
      item.defects.push(`orphaned: covers ${coverId}, which does not exist${revHint(coverId)}`);
    } else if (!targets.some((target) => target.needs.some((need) => idMatches(need, item.id)))) {
      item.defects.push(`unwanted: covers ${coverId}, but ${coverId} does not need ${item.id}`);
    }
  }
  if (item.origin === 'code' && !isNeeded(item.id)) {
    item.defects.push(`unwanted: no item needs ${item.id}`);
  }
}

// forwarding chains must be acyclic (self-forwarding included); every
// forwarding on a cycle is reported as a problem and has no effect
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
      current = forwardTargets.get(current);
    }
    if (seen.has(current)) {
      const cycle = path.slice(seen.get(current));
      const chain = [...cycle, current].join(' --> ');
      for (const id of cycle) {
        const declaration = declarationBySource.get(id);
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
// declarations, and marks each surviving target as wanted coverage.
function buildForwardMap(forwards, byId, neededIds, revHint, problems) {
  const forwardTargets = new Map();
  const declarationBySource = new Map(); // effective (first) declaration per source
  const forwardsBySource = new Map();
  for (const forward of forwards) {
    (forwardsBySource.get(forward.from) ?? forwardsBySource.set(forward.from, []).get(forward.from)).push(forward);
  }
  for (const [from, group] of forwardsBySource) {
    const sources = byId.get(from);
    if (!sources) {
      for (const forward of group)
        problems.push({
          file: forward.file,
          line: forward.line,
          character: forward.character,
          message: `forwarding from ${from}, which does not exist${revHint(from)}`,
        });
      continue;
    }
    if (group.length > 1)
      for (const item of sources)
        item.defects.push(`duplicate: forwarding for ${from} is declared ${group.length} times`);
    forwardTargets.set(from, group[0].to);
    declarationBySource.set(from, group[0]);
  }
  dropCyclicForwards(forwardTargets, declarationBySource, problems);
  for (const to of forwardTargets.values()) neededIds.add(to); // a forwarding target is wanted coverage
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
      ok = deep(forwardTarget);
    } else {
      for (const item of group) for (const need of item.needs) if (!needDeep(need)) ok = false;
    }
    memo.set(id, ok);
    return ok;
  };
  const needDeep = (need) => matchesOf(need).some((id) => deep(id));
  for (const item of items) item.deepCovered = deep(item.id);
}

// defined IDs grouped by their key (everything but the revision), so a wildcard
// need can be resolved against the revisions sharing its key
function groupIdsByKey(byId) {
  const idsByKey = new Map();
  for (const id of byId.keys())
    (idsByKey.get(keyOf(id)) ?? idsByKey.set(keyOf(id), []).get(keyOf(id))).push(id);
  return idsByKey;
}

// items grouped by ID plus need resolution over them: matchesOf(ref) returns
// the defined IDs satisfying a (possibly wildcard) reference. Shared with the
// verbose report so rendered edges cannot drift from what analyze checked.
export function buildResolver(items) {
  const byId = new Map();
  for (const item of items) (byId.get(item.id) ?? byId.set(item.id, []).get(item.id)).push(item);
  const idsByKey = groupIdsByKey(byId);
  const matchesOf = (ref) => (idsByKey.get(keyOf(ref)) ?? []).filter((id) => idMatches(ref, id));
  return { byId, matchesOf };
}

// split all need references into exact IDs (fast membership) and wildcard
// patterns (matched individually)
function splitNeeds(items) {
  const exact = new Set();
  const wildcard = [];
  for (const item of items)
    for (const need of item.needs) {
      if (isWildcardRev(revOf(need))) wildcard.push(need);
      else exact.add(need);
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
  const isNeeded = (id) => exactNeeds.has(id) || wildcardNeeds.some((wildcard) => idMatches(wildcard, id));

  for (const [id, group] of byId) {
    if (group.length > 1)
      for (const item of group) item.defects.push(`duplicate: ID ${id} is defined ${group.length} times`);
  }

  const revHint = (id) => {
    const revs = revsByKey.get(keyOf(id));
    return revs ? ` (revision mismatch: existing revision(s) of ${keyOf(id)}: ${[...revs].sort(compareRev).join(', ')})` : '';
  };

  const forwardTargets = buildForwardMap(forwards, byId, exactNeeds, revHint, problems);

  for (const item of items) {
    item.forwardsTo = forwardTargets.get(item.id) ?? null; // effective forwarding target, for renderers
    checkItemReferences(item, byId, matchesOf, isNeeded, revHint, forwardTargets);
  }

  markDeepCoverage(items, byId, matchesOf, forwardTargets);
}
