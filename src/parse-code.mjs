/*
 * Code parser - comment-aware tag scanner (.ts, .js, .mjs, .sql, .vue):
 *   - `[<id>]` inside a comment defines a coverage item with that ID.
 *   - `[>><id>]` inside a comment attaches a need to the nearest preceding
 *     item tag in the same file (error if there is none).
 */

import path from 'node:path';

import { ID_SRC, mkId, newItem } from './ids.mjs';

const TAG_RE = new RegExp(String.raw`\[(>>)?\s*${ID_SRC}\s*\]`, 'g');

export function parseCode(file, text, problems) {
  const ext = path.extname(file).toLowerCase();
  const lines = text.split(/\r?\n/);
  const items = [];
  let last = null; // nearest preceding item tag in this file
  let block = null; // 'c' (/* */) | 'html' (<!-- -->)
  const lineMarkers = ext === '.sql' ? ['--'] : ['//'];
  const htmlBlocks = ext === '.vue';

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    let comment = '';
    let pos = 0;
    while (pos < s.length) {
      if (block === 'c' || block === 'html') {
        const closer = block === 'c' ? '*/' : '-->';
        const end = s.indexOf(closer, pos);
        if (end === -1) {
          comment += s.slice(pos) + ' ';
          pos = s.length;
        } else {
          comment += s.slice(pos, end) + ' ';
          pos = end + closer.length;
          block = null;
        }
      } else {
        let best = -1;
        let kind = null;
        let len = 0;
        for (const m of lineMarkers) {
          const idx = s.indexOf(m, pos);
          if (idx !== -1 && (best === -1 || idx < best)) {
            best = idx;
            kind = 'line';
            len = m.length;
          }
        }
        const cb = s.indexOf('/*', pos);
        if (cb !== -1 && (best === -1 || cb < best)) {
          best = cb;
          kind = 'c';
          len = 2;
        }
        if (htmlBlocks) {
          const hb = s.indexOf('<!--', pos);
          if (hb !== -1 && (best === -1 || hb < best)) {
            best = hb;
            kind = 'html';
            len = 4;
          }
        }
        if (best === -1) break;
        pos = best + len;
        if (kind === 'line') {
          comment += s.slice(pos) + ' ';
          pos = s.length;
        } else {
          block = kind;
        }
      }
    }

    for (const m of comment.matchAll(TAG_RE)) {
      const id = mkId(m[2], m[3], m[4], m[5]);
      if (m[1]) {
        // [>>...] need tag
        if (!last)
          problems.push({
            file,
            line: i + 1,
            message: `need tag [>>${id}] has no preceding item tag in this file`,
          });
        else last.needs.push(id);
      } else {
        last = newItem(id, 'code', file, i + 1);
        items.push(last);
      }
    }
  }
  return items;
}
