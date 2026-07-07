/*
 * Item IDs:  <type>:[<group>/[<group>/...]]<name>#<revision>
 *   e.g.  req:auth/login#1   req:auth/session/login#1   impl:whatever-other-name#2
 *
 * A revision is one to three dot-separated non-negative integers (semver-style):
 * X, X.Y or X.Y.Z. No pre-release/build appendices; at most three layers. The
 * layers are part of the identity - matching stays exact, so 2.4 never equals
 * 2.4.0 (see revMatches).
 */

const SEG_SRC = '[A-Za-z][A-Za-z0-9_.-]*';
// concrete revision: X, X.Y or X.Y.Z (one to three numeric layers)
const REV_SRC = String.raw`\d+(?:\.\d+){0,2}`;
export const ID_SRC =
  String.raw`([A-Za-z]+):(?:((?:${SEG_SRC}\/)*${SEG_SRC})\/)?(${SEG_SRC})#(${REV_SRC})`;
export const ID_RE = new RegExp(`^${ID_SRC}$`);

// Forwarding tag: [<source-id> --> <target-id>], spaces optional.
// Contains two ID_SRC captures (4 groups each); mkForward turns a match into
// a forwarding record given the index of the first captured group.
export const FORWARD_SRC = String.raw`\[\s*${ID_SRC}\s*-->\s*${ID_SRC}\s*\]`;

export const mkId = (type, group, name, rev) =>
  `${type}:${group ? group + '/' : ''}${name}#${rev}`;

export const mkForward = (m, base, file, line) => ({
  from: mkId(m[base], m[base + 1], m[base + 2], m[base + 3]),
  to: mkId(m[base + 4], m[base + 5], m[base + 6], m[base + 7]),
  file,
  line,
});
export const keyOf = (id) => id.slice(0, id.lastIndexOf('#'));
export const revOf = (id) => id.slice(id.lastIndexOf('#') + 1);

// Order two concrete revisions: compare layer by layer numerically, and when
// one is a prefix of the other the shorter sorts first (so 2.4 precedes 2.4.0).
export function compareRev(a, b) {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (i >= pa.length) return -1;
    if (i >= pb.length) return 1;
    if (pa[i] !== pb[i]) return Number(pa[i]) - Number(pb[i]);
  }
  return 0;
}

export function parseIdEntry(raw) {
  const cleaned = raw.replaceAll('`', '').trim();
  const m = cleaned.match(ID_RE);
  return m ? mkId(m[1], m[2], m[3], m[4]) : null;
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
  };
}
