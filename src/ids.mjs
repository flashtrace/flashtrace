/*
 * Item IDs:  <type>:[<group>/[<group>/...]]<name>#<revision>
 *   e.g.  req:auth/login#1   req:auth/session/login#1   impl:whatever-other-name#2
 *
 * A revision is one to three dot-separated non-negative integers (semver-style):
 * X, X.Y or X.Y.Z. No pre-release/build appendices; at most three layers.
 * Omitted layers are zero, as SemVer defines: 2.4 and 2.4.0 name the same
 * revision (see canonicalRev / revMatches).
 */

const SEGMENT_SRC = '[A-Za-z][A-Za-z0-9_.-]*';
// concrete revision: X, X.Y or X.Y.Z (one to three numeric layers)
const REV_SRC = String.raw`\d+(?:\.\d+){0,2}`;
// wildcard revision: zero to two leading numeric layers followed by a single
// trailing wildcard layer, written x or its alias * (x, 2.x, 2.3.x; *, 2.*,
// 2.3.*). The wildcard layer stands for that layer and every deeper one, so
// 2.x matches 2, 2.4 and 2.4.1 alike, and a bare x matches every revision.
const WILDCARD_SRC = String.raw`(?:\d+\.){0,2}[x*]`;
// a revision *reference* (used only in Needs): concrete or wildcard; the
// wildcard alternative comes first so 2.x is not read as the concrete 2
const REV_REF_SRC = `(?:${WILDCARD_SRC}|${REV_SRC})`;
export const ID_SRC =
  String.raw`([A-Za-z]+):(?:((?:${SEGMENT_SRC}\/)*${SEGMENT_SRC})\/)?(${SEGMENT_SRC})#(${REV_SRC})`;
export const ID_RE = new RegExp(`^${ID_SRC}$`);

// A need/cover reference completes into a full ID against the item that states
// it. Beyond a full ID it may drop the [group/]name, the revision, or both, and
// each dropped part is taken from that stating item (resolveRef):
//   impl:auth/login#2  full ID - nothing to complete
//   impl:auth/login    name given, revision from the stating item
//   impl#2             revision given, [group/]name from the stating item
//   impl               type only, [group/]name and revision both taken
// The revision may be a wildcard here (REV_REF_SRC), as needs may demand a
// range. Captures: type, optional [group/]name, optional revision. Definitions,
// forwarding and the source anchor of a code need tag stay full IDs (ID_SRC).
const PATH_SRC = String.raw`(?:${SEGMENT_SRC}\/)*${SEGMENT_SRC}`;
export const REF_SRC = `([A-Za-z]+)(?::(${PATH_SRC}))?(?:#(${REV_REF_SRC}))?`;
export const REF_RE = new RegExp(`^${REF_SRC}$`);

// Like REF_SRC but a given revision must be concrete - Covers never take a
// wildcard. An omitted name or revision still completes from the stating item
// (whose revision is always concrete).
export const COVER_REF_RE = new RegExp(`^([A-Za-z]+)(?::(${PATH_SRC}))?(?:#(${REV_SRC}))?$`);

// Forwarding tag: [<source-id> --> <target-id>], spaces optional.
// Contains two ID_SRC captures (4 groups each); makeForward turns a match into
// a forwarding record given the index of the first captured group.
export const FORWARD_SRC = String.raw`\[\s*${ID_SRC}\s*-->\s*${ID_SRC}\s*\]`;

export const makeId = (type, group, name, rev) =>
  `${type}:${group ? group + '/' : ''}${name}#${rev}`;

export const makeForward = (m, base, file, line, character) => ({
  from: makeId(m[base], m[base + 1], m[base + 2], m[base + 3]),
  to: makeId(m[base + 4], m[base + 5], m[base + 6], m[base + 7]),
  file,
  line,
  character,
});
export const keyOf = (id) => id.slice(0, id.lastIndexOf('#'));
export const revOf = (id) => id.slice(id.lastIndexOf('#') + 1);
// the [group/[group/]]name part of an ID, between the type and the revision
const pathOf = (id) => id.slice(id.indexOf(':') + 1, id.lastIndexOf('#'));

// Complete a reference (type, and an optionally omitted [group/]name and
// revision) into a full ID against ownerId, the item that states it: a missing
// name or revision is taken from ownerId. Its revision is always concrete, so a
// completed revision is concrete too.
export const resolveRef = (type, path, rev, ownerId) =>
  `${type}:${path ?? pathOf(ownerId)}#${rev ?? revOf(ownerId)}`;

// Canonical form of a concrete revision: exactly three layers, leading zeros
// dropped - the SemVer identity under which 2.4, 2.4.0 and 2.04 are all
// 2.4.0. Not defined for wildcard revisions (a wildcard layer is no number).
export function canonicalRev(rev) {
  const layers = rev.split('.').map((layer) => String(Number(layer)));
  while (layers.length < 3) layers.push('0');
  return layers.join('.');
}

// Canonical form of a concrete ID: its revision in canonical form. Exact-ID
// bookkeeping (definitions, needs, covers, forwarding) keys on this form so
// SemVer-equal revisions meet; the raw ID as written is kept for display.
export const canonicalId = (id) => `${keyOf(id)}#${canonicalRev(revOf(id))}`;

// Order two concrete revisions: compare their canonical three-layer forms
// numerically, layer by layer; SemVer-equal revisions compare equal.
export function compareRev(a, b) {
  const layersA = canonicalRev(a).split('.');
  const layersB = canonicalRev(b).split('.');
  for (let i = 0; i < 3; i++) {
    if (layersA[i] !== layersB[i]) return Number(layersA[i]) - Number(layersB[i]);
  }
  return 0;
}

const isWildcardLayer = (layer) => layer === 'x' || layer === '*';
// does a revision carry a wildcard layer (and is thus a range, not a concrete
// revision)? Concrete revisions are digits and dots only.
export const isWildcardRev = (rev) => /[x*]/.test(rev);

// Does a (possibly wildcard) revision pattern match a concrete revision? Both
// sides are taken to their three-layer form: omitted concrete layers are zero
// (3.7 matches 3.7.0), and a pattern's trailing wildcard layer extends over
// the remaining layers (2.x matches 2, 2.4 and 2.4.1; x and * match every
// revision). Each wildcard layer matches any number; numeric layers must be
// numerically equal.
export function revMatches(pattern, concrete) {
  const patternLayers = pattern.split('.');
  while (patternLayers.length < 3) patternLayers.push(isWildcardLayer(patternLayers.at(-1)) ? 'x' : '0');
  const concreteLayers = canonicalRev(concrete).split('.');
  for (let i = 0; i < 3; i++) {
    if (isWildcardLayer(patternLayers[i])) continue;
    if (Number(patternLayers[i]) !== Number(concreteLayers[i])) return false;
  }
  return true;
}

// Does a (possibly wildcard) need ID match a concrete item ID? Everything up to
// the revision must be identical; the revisions are compared with revMatches.
export const idMatches = (need, id) =>
  keyOf(need) === keyOf(id) && revMatches(revOf(need), revOf(id));

// A need reference (Markdown Needs, the target of a code need tag): a full ID,
// a wildcard revision (2.x), or a short form completed from ownerId, the item
// stating it - see REF_SRC. Returns the full ID, or null when the text is not a
// valid reference.
export function parseNeedEntry(raw, ownerId) {
  const cleaned = raw.replaceAll('`', '').trim();
  const m = cleaned.match(REF_RE);
  return m ? resolveRef(m[1], m[2], m[3], ownerId) : null;
}

// A cover reference: like a need, but a given revision must be concrete (Covers
// never take a wildcard). An omitted name or revision still completes from
// ownerId just the same.
export function parseCoverEntry(raw, ownerId) {
  const cleaned = raw.replaceAll('`', '').trim();
  const m = cleaned.match(COVER_REF_RE);
  return m ? resolveRef(m[1], m[2], m[3], ownerId) : null;
}

export function newItem(id, origin, file, line, character) {
  return {
    id,
    key: keyOf(id),
    revision: revOf(id),
    canonicalId: canonicalId(id), // the SemVer-equal identity every exact-ID lookup keys on
    origin, // 'spec' | 'code'
    file,
    line,
    character, // 1-based column of the first character of the defining construct
    title: null,
    description: [],
    needs: [],
    covers: [],
    tags: [],
    defects: [],
    forwardsTo: null, // effective forwarding target, set by analyze
  };
}
