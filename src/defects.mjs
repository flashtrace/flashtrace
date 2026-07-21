/*
 * Every defect an item can carry, in one place.
 *
 * A defect is { kind, ref, message }, plus existingRevisions when the
 * revision-mismatch hint applies (see withRevisions in analyze.mjs), plus
 * file/line/character - all three or none - when the defect has a source
 * location of its own, distinct from the item's: the invalid entry or the
 * forwarding declaration it is about. A defect without the location group is
 * anchored at the item's own location.
 *
 * There is exactly one kind per condition, and every kind is raised from
 * exactly one place. `kind` is therefore a complete discriminator: a consumer
 * of the JSON report can tell every defect apart without ever reading
 * `message`. The message is offered as the wording the plain-text report uses,
 * not as data to parse - it may be reworded without a kind changing.
 *
 * Adding a condition means adding a kind here, never reusing a neighbouring
 * one. schemas/report/v0.json lists the same kinds and test/defects.test.mjs
 * holds the two lists together.
 */

// every defect kind, in the order the schema lists them
export const DEFECT_KINDS = Object.freeze([
  'invalid-reference',
  'uncovered-need',
  'uncovered-forward',
  'orphaned-cover',
  'unwanted-cover',
  'unwanted-item',
  'duplicate-id',
  'duplicate-forwarding',
  'cyclic-forwarding',
]);

// a Needs/Covers entry that is not a valid reference; the entry is ignored,
// so it is also carried nowhere else - ref is the offending text as written
export const invalidReference = (value, source, { file, line, character }) => ({
  kind: 'invalid-reference',
  ref: value,
  file,
  line,
  character,
  message: `invalid: "${value}" in ${source} is not a valid ID and is ignored`,
});

// a declared need that no defined item matches
export const uncoveredNeed = (need) => ({
  kind: 'uncovered-need',
  ref: need,
  message: `uncovered: needs ${need}, which does not exist`,
});

// a forwarding whose target does not exist, so the redirected obligation
// cannot be met
export const uncoveredForward = (target) => ({
  kind: 'uncovered-forward',
  ref: target,
  message: `uncovered: forwards to ${target}, which does not exist`,
});

// a covers entry pointing at an item that does not exist
export const orphanedCover = (coverId) => ({
  kind: 'orphaned-cover',
  ref: coverId,
  message: `orphaned: covers ${coverId}, which does not exist`,
});

// a covers entry pointing at an existing item that does not need this one
export const unwantedCover = (coverId, itemId) => ({
  kind: 'unwanted-cover',
  ref: coverId,
  message: `unwanted: covers ${coverId}, but ${coverId} does not need ${itemId}`,
});

// a code item that no item needs, so nothing it implements is traced to it
export const unwantedItem = (itemId) => ({
  kind: 'unwanted-item',
  ref: itemId,
  message: `unwanted: no item needs ${itemId}`,
});

// the same full ID defined more than once
export const duplicateId = (id, count) => ({
  kind: 'duplicate-id',
  ref: id,
  message: `duplicate: ID ${id} is defined ${count} times`,
});

// more than one forwarding declared for the same source; only the first is
// effective
export const duplicateForwarding = (from, count) => ({
  kind: 'duplicate-forwarding',
  ref: from,
  message: `duplicate: forwarding for ${from} is declared ${count} times`,
});

// a forwarding sitting on a cycle; it is voided, so the source falls back to
// its own needs
export const cyclicForwarding = (target, chain, { file, line, character }) => ({
  kind: 'cyclic-forwarding',
  ref: target,
  file,
  line,
  character,
  message: `cyclic: forwards to ${target}, closing the cycle ${chain}, so the forwarding has no effect`,
});
