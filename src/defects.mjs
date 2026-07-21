/*
 * Every defect an item can carry, in one place.
 *
 * A defect is { kind, ref, message }, plus existingRevisions when the
 * revision-mismatch hint applies (see withRevisions in analyze.mjs).
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
  'uncovered-need',
  'uncovered-forward',
  'orphaned-cover',
  'unwanted-cover',
  'unwanted-item',
  'duplicate-id',
  'duplicate-forwarding',
]);

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
