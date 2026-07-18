/*
 * Item IDs:  <type>:[<group>/[<group>/...]]<name>#<revision>
 *   e.g.  req:auth/login#1   req:auth/session/login#1   impl:whatever-other-name#2
 *
 * A revision is one to three dot-separated non-negative integers (semver-style):
 * X, X.Y or X.Y.Z. No pre-release/build appendices; at most three layers. The
 * layers are part of the identity - matching stays exact, so 2.4 never equals
 * 2.4.0 (see revMatches).
 */

const SEGMENT_SRC = '[A-Za-z][A-Za-z0-9_.-]*';
// concrete revision: X, X.Y or X.Y.Z (one to three numeric layers)
const REV_SRC = String.raw`\d+(?:\.\d+){0,2}`;
// wildcard revision: zero or more leading numeric layers followed by wildcard
// layers named x, y, z in order, at most three layers total (2.x, 2.3.x,
// 2.x.y, ...). Longest alternatives first so a wildcard is preferred over the
// concrete numeric prefix it starts with.
const WILDCARD_SRC = String.raw`(?:\d+\.\d+\.x|\d+\.x\.y|x\.y\.z|\d+\.x|x\.y|x)`;
// a revision *reference* (used only in Needs): concrete or wildcard
const REV_REF_SRC = `(?:${WILDCARD_SRC}|${REV_SRC})`;
export const ID_SRC =
  String.raw`([A-Za-z]+):(?:((?:${SEGMENT_SRC}\/)*${SEGMENT_SRC})\/)?(${SEGMENT_SRC})#(${REV_SRC})`;
export const ID_RE = new RegExp(`^${ID_SRC}$`);

// Same four captures as ID_SRC, but the revision may be a wildcard. Used for
// need references (Markdown Needs and the target of a code need tag) so an
// item can demand "any downstream revision" without loosening exact matching
// elsewhere. Definitions, Covers and forwarding stay concrete (ID_SRC).
export const NEED_ID_SRC =
  String.raw`([A-Za-z]+):(?:((?:${SEGMENT_SRC}\/)*${SEGMENT_SRC})\/)?(${SEGMENT_SRC})#(${REV_REF_SRC})`;
export const NEED_ID_RE = new RegExp(`^${NEED_ID_SRC}$`);

// Short-form need reference: a bare type and revision reference (impl#1,
// utest#2.x) with no [group/]name of its own - resolveShortNeed completes it
// with the path of the item specifying the need. Accepted only where needs
// are written (Markdown Needs entries and the target of a code need tag).
export const SHORT_NEED_SRC = String.raw`([A-Za-z]+)#(${REV_REF_SRC})`;
export const SHORT_NEED_RE = new RegExp(`^${SHORT_NEED_SRC}$`);

// Forwarding tag: [<source-id> --> <target-id>], spaces optional.
// Contains two ID_SRC captures (4 groups each); makeForward turns a match into
// a forwarding record given the index of the first captured group.
export const FORWARD_SRC = String.raw`\[\s*${ID_SRC}\s*-->\s*${ID_SRC}\s*\]`;

export const makeId = (type, group, name, rev) =>
  `${type}:${group ? group + '/' : ''}${name}#${rev}`;

export const makeForward = (m, base, file, line) => ({
  from: makeId(m[base], m[base + 1], m[base + 2], m[base + 3]),
  to: makeId(m[base + 4], m[base + 5], m[base + 6], m[base + 7]),
  file,
  line,
});
export const keyOf = (id) => id.slice(0, id.lastIndexOf('#'));
export const revOf = (id) => id.slice(id.lastIndexOf('#') + 1);
// the [group/[group/]]name part of an ID, between the type and the revision
const pathOf = (id) => id.slice(id.indexOf(':') + 1, id.lastIndexOf('#'));

// Full ID of a short-form need: the given type and revision reference with
// exactly the [group/]name of ownerId, the item specifying the need.
export const resolveShortNeed = (type, ownerId, rev) => `${type}:${pathOf(ownerId)}#${rev}`;

// Order two concrete revisions: compare layer by layer numerically, and when
// one is a prefix of the other the shorter sorts first (so 2.4 precedes 2.4.0).
export function compareRev(a, b) {
  const partsA = a.split('.');
  const partsB = b.split('.');
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    if (i >= partsA.length) return -1;
    if (i >= partsB.length) return 1;
    if (partsA[i] !== partsB[i]) return Number(partsA[i]) - Number(partsB[i]);
  }
  return 0;
}

const WILDCARD_LAYERS = new Set(['x', 'y', 'z']);
// does a revision carry a wildcard layer (and is thus a range, not a concrete
// revision)? Concrete revisions are digits and dots only.
export const isWildcardRev = (rev) => /[xyz]/.test(rev);

// Does a (possibly wildcard) revision pattern match a concrete revision? The
// layer count must be equal - 2.x matches 2.7 but never 2.7.0 - each wildcard
// layer matches any number, and each numeric layer must be equal.
export function revMatches(pattern, concrete) {
  const patternParts = pattern.split('.');
  const concreteParts = concrete.split('.');
  if (patternParts.length !== concreteParts.length) return false;
  for (let i = 0; i < patternParts.length; i++) {
    if (WILDCARD_LAYERS.has(patternParts[i])) continue;
    if (patternParts[i] !== concreteParts[i]) return false;
  }
  return true;
}

// Does a (possibly wildcard) need ID match a concrete item ID? Everything up to
// the revision must be identical; the revisions are compared with revMatches.
export const idMatches = (need, id) =>
  keyOf(need) === keyOf(id) && revMatches(revOf(need), revOf(id));

export function parseIdEntry(raw) {
  const cleaned = raw.replaceAll('`', '').trim();
  const m = cleaned.match(ID_RE);
  return m ? makeId(m[1], m[2], m[3], m[4]) : null;
}

// A need reference, which - unlike parseIdEntry - also accepts a wildcard
// revision (2.x, 2.3.x, 2.x.y) and the short form <type>#<rev> (impl#1),
// resolved with the [group/]name of ownerId, the item specifying the need.
export function parseNeedEntry(raw, ownerId) {
  const cleaned = raw.replaceAll('`', '').trim();
  const m = cleaned.match(NEED_ID_RE);
  if (m) return makeId(m[1], m[2], m[3], m[4]);
  const short = cleaned.match(SHORT_NEED_RE);
  return short ? resolveShortNeed(short[1], ownerId, short[2]) : null;
}

export function newItem(id, origin, file, line) {
  return {
    id,
    key: keyOf(id),
    revision: revOf(id),
    origin, // 'markdown' | 'code'
    file,
    line,
    title: null,
    description: [],
    needs: [],
    covers: [],
    tags: [],
    defects: [],
    forwardsTo: null, // effective forwarding target, set by analyze
  };
}
