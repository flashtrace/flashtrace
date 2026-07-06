/*
 * Item IDs:  <type>:[<group>/[<group>/...]]<name>#<revision>
 *   e.g.  req:auth/login#1   req:auth/session/login#1   impl:whatever-other-name#2
 */

const SEG_SRC = '[A-Za-z][A-Za-z0-9_.-]*';
export const ID_SRC =
  String.raw`([A-Za-z]+):(?:((?:${SEG_SRC}\/)*${SEG_SRC})\/)?(${SEG_SRC})#(\d+)`;
export const ID_RE = new RegExp(`^${ID_SRC}$`);

export const mkId = (type, group, name, rev) =>
  `${type}:${group ? group + '/' : ''}${name}#${rev}`;
export const keyOf = (id) => id.slice(0, id.lastIndexOf('#'));
export const revOf = (id) => Number(id.slice(id.lastIndexOf('#') + 1));

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
