import { keyOf } from './ids.mjs';

export function analyze(items) {
  const byId = new Map();
  const revsByKey = new Map();
  for (const it of items) {
    (byId.get(it.id) ?? byId.set(it.id, []).get(it.id)).push(it);
    (revsByKey.get(it.key) ?? revsByKey.set(it.key, new Set()).get(it.key)).add(it.revision);
  }
  const neededIds = new Set(items.flatMap((it) => it.needs));

  for (const [id, group] of byId) {
    if (group.length > 1)
      for (const it of group) it.defects.push(`duplicate: ID ${id} is defined ${group.length} times`);
  }

  const revHint = (id) => {
    const revs = revsByKey.get(keyOf(id));
    return revs ? ` (revision mismatch: existing revision(s) of ${keyOf(id)}: ${[...revs].sort((a, b) => a - b).join(', ')})` : '';
  };

  for (const it of items) {
    for (const n of it.needs) {
      if (!byId.has(n)) it.defects.push(`uncovered: needs ${n}, which does not exist${revHint(n)}`);
    }
    for (const c of it.covers) {
      const targets = byId.get(c);
      if (!targets) {
        it.defects.push(`orphaned: covers ${c}, which does not exist${revHint(c)}`);
      } else if (!targets.some((t) => t.needs.includes(it.id))) {
        it.defects.push(`unwanted: covers ${c}, but ${c} does not need ${it.id}`);
      }
    }
    if (it.origin === 'code' && !neededIds.has(it.id)) {
      it.defects.push(`unwanted: no item needs ${it.id}`);
    }
  }

  // deep coverage: all needs exist and are themselves deep-covered (cycle-safe)
  const memo = new Map();
  const deep = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, true); // cycle guard
    const group = byId.get(id);
    if (!group) {
      memo.set(id, false);
      return false;
    }
    let ok = true;
    for (const it of group) for (const n of it.needs) if (!deep(n)) ok = false;
    memo.set(id, ok);
    return ok;
  };
  for (const it of items) it.deepCovered = deep(it.id);
}
