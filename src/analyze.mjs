import { compareRev, idMatches, isWildcardRev, keyOf, revOf } from './ids.mjs';

// a forwarded item (source of an [A --> B] tag) has its own needs excused; its
// coverage obligation is redirected to the target, checked here instead.
// matchesOf(ref) returns the defined items satisfying a (possibly wildcard)
// need; isNeeded(id) tells whether any need - exact or wildcard - wants that id
function checkItemReferences(it, byId, matchesOf, isNeeded, revHint, fwdTarget) {
  const fwd = fwdTarget.get(it.id);
  if (fwd !== undefined) {
    if (!byId.has(fwd))
      it.defects.push(`uncovered: forwards to ${fwd}, which does not exist${revHint(fwd)}`);
  } else {
    for (const n of it.needs) {
      if (matchesOf(n).length === 0)
        it.defects.push(`uncovered: needs ${n}, which does not exist${revHint(n)}`);
    }
  }
  for (const c of it.covers) {
    const targets = byId.get(c);
    if (!targets) {
      it.defects.push(`orphaned: covers ${c}, which does not exist${revHint(c)}`);
    } else if (!targets.some((t) => t.needs.some((n) => idMatches(n, it.id)))) {
      it.defects.push(`unwanted: covers ${c}, but ${c} does not need ${it.id}`);
    }
  }
  if (it.origin === 'code' && !isNeeded(it.id)) {
    it.defects.push(`unwanted: no item needs ${it.id}`);
  }
}

// forwarding chains must be acyclic (self-forwarding included); every
// forwarding on a cycle is reported as a problem and has no effect
function dropCyclicForwards(fwdTarget, declBySource, problems) {
  const done = new Set(); // ids verified to not sit on a cycle
  for (const start of fwdTarget.keys()) {
    if (done.has(start)) continue;
    const seen = new Map(); // id -> position in the walked path
    const path = [];
    let cur = start;
    while (fwdTarget.has(cur) && !done.has(cur) && !seen.has(cur)) {
      seen.set(cur, path.length);
      path.push(cur);
      cur = fwdTarget.get(cur);
    }
    if (seen.has(cur)) {
      const cycle = path.slice(seen.get(cur));
      const chain = [...cycle, cur].join(' --> ');
      for (const id of cycle) {
        const f = declBySource.get(id);
        problems.push({ file: f.file, line: f.line, message: `cyclic forwarding: ${chain}` });
        fwdTarget.delete(id);
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
  const fwdTarget = new Map();
  const declBySource = new Map(); // effective (first) declaration per source
  const fwdBySource = new Map();
  for (const f of forwards) {
    (fwdBySource.get(f.from) ?? fwdBySource.set(f.from, []).get(f.from)).push(f);
  }
  for (const [from, group] of fwdBySource) {
    const sources = byId.get(from);
    if (!sources) {
      for (const f of group)
        problems.push({
          file: f.file,
          line: f.line,
          message: `forwarding from ${from}, which does not exist${revHint(from)}`,
        });
      continue;
    }
    if (group.length > 1)
      for (const it of sources)
        it.defects.push(`duplicate: forwarding for ${from} is declared ${group.length} times`);
    fwdTarget.set(from, group[0].to);
    declBySource.set(from, group[0]);
  }
  dropCyclicForwards(fwdTarget, declBySource, problems);
  for (const to of fwdTarget.values()) neededIds.add(to); // a forwarding target is wanted coverage
  return fwdTarget;
}

// deep coverage: all needs exist and are themselves deep-covered (cycle-safe);
// a forwarded ID follows its target instead of its own needs. A need may be a
// wildcard: it is deep-covered when at least one matching item is deep-covered.
function markDeepCoverage(items, byId, matchesOf, fwdTarget) {
  const memo = new Map();
  const deep = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, true); // cycle guard
    const group = byId.get(id);
    if (!group) {
      memo.set(id, false);
      return false;
    }
    const fwd = fwdTarget.get(id);
    let ok = true;
    if (fwd !== undefined) {
      ok = deep(fwd);
    } else {
      for (const it of group) for (const n of it.needs) if (!needDeep(n)) ok = false;
    }
    memo.set(id, ok);
    return ok;
  };
  const needDeep = (n) => {
    const matches = matchesOf(n);
    return matches.length > 0 && matches.some((id) => deep(id));
  };
  for (const it of items) it.deepCovered = deep(it.id);
}

export function analyze(items, forwards = [], problems = []) {
  const byId = new Map();
  const revsByKey = new Map();
  const idsByKey = new Map(); // defined IDs grouped by key, for wildcard lookup
  for (const it of items) {
    (byId.get(it.id) ?? byId.set(it.id, []).get(it.id)).push(it);
    (revsByKey.get(it.key) ?? revsByKey.set(it.key, new Set()).get(it.key)).add(it.revision);
  }
  for (const id of byId.keys())
    (idsByKey.get(keyOf(id)) ?? idsByKey.set(keyOf(id), []).get(keyOf(id))).push(id);

  // defined items satisfying a (possibly wildcard) need reference; for a
  // concrete reference this is just the exact ID if it exists
  const matchesOf = (ref) => (idsByKey.get(keyOf(ref)) ?? []).filter((id) => idMatches(ref, id));

  // is a code item wanted? split needs into an exact set (fast path) and the
  // wildcard patterns; forwarding targets are added to the exact set below
  const exactNeeds = new Set();
  const wildcardNeeds = [];
  for (const it of items)
    for (const n of it.needs) {
      if (isWildcardRev(revOf(n))) wildcardNeeds.push(n);
      else exactNeeds.add(n);
    }
  const isNeeded = (id) => exactNeeds.has(id) || wildcardNeeds.some((w) => idMatches(w, id));

  for (const [id, group] of byId) {
    if (group.length > 1)
      for (const it of group) it.defects.push(`duplicate: ID ${id} is defined ${group.length} times`);
  }

  const revHint = (id) => {
    const revs = revsByKey.get(keyOf(id));
    return revs ? ` (revision mismatch: existing revision(s) of ${keyOf(id)}: ${[...revs].sort(compareRev).join(', ')})` : '';
  };

  const fwdTarget = buildForwardMap(forwards, byId, exactNeeds, revHint, problems);

  for (const it of items) checkItemReferences(it, byId, matchesOf, isNeeded, revHint, fwdTarget);

  markDeepCoverage(items, byId, matchesOf, fwdTarget);
}
