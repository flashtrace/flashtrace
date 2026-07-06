/*
 * Code parser - comment-aware tag scanner (.ts, .js, .mjs, .sql, .vue):
 *   - `[<id>]` inside a comment defines a coverage item with that ID.
 *   - `[>><id>]` inside a comment attaches a need to the nearest preceding
 *     item tag in the same file (error if there is none).
 *   - `[<id> --> <id>]` inside a comment forwards the first item's coverage
 *     obligation to the second (spaces optional).
 */

import path from 'node:path';

import { FORWARD_SRC, ID_SRC, mkForward, mkId, newItem } from './ids.mjs';

const TAG_RE = new RegExp(String.raw`\[(>>)?\s*${ID_SRC}\s*\]`, 'g');
const FORWARD_RE = new RegExp(FORWARD_SRC, 'g');
const BLOCK_CLOSERS = { c: '*/', html: '-->' };

// earliest comment opener in s at or after pos, or null
function findCommentStart(s, pos, lineMarkers, htmlBlocks) {
  const candidates = lineMarkers.map((m) => ({ idx: s.indexOf(m, pos), kind: 'line', len: m.length }));
  candidates.push({ idx: s.indexOf('/*', pos), kind: 'c', len: 2 });
  if (htmlBlocks) candidates.push({ idx: s.indexOf('<!--', pos), kind: 'html', len: 4 });
  let best = null;
  for (const cand of candidates) {
    if (cand.idx !== -1 && (best === null || cand.idx < best.idx)) best = cand;
  }
  return best;
}

// consume the open block comment; returns its text and where scanning resumes
function readBlockRest(s, pos, closer) {
  const end = s.indexOf(closer, pos);
  if (end === -1) return { text: s.slice(pos) + ' ', pos: s.length, closed: false };
  return { text: s.slice(pos, end) + ' ', pos: end + closer.length, closed: true };
}

// comment text of one line; state.block carries an open block comment across lines
function commentText(s, state, lineMarkers, htmlBlocks) {
  let comment = '';
  let pos = 0;
  while (pos < s.length) {
    if (state.block) {
      const rest = readBlockRest(s, pos, BLOCK_CLOSERS[state.block]);
      comment += rest.text;
      pos = rest.pos;
      if (rest.closed) state.block = null;
    } else {
      const start = findCommentStart(s, pos, lineMarkers, htmlBlocks);
      if (!start) break;
      pos = start.idx + start.len;
      if (start.kind === 'line') {
        comment += s.slice(pos) + ' ';
        pos = s.length;
      } else {
        state.block = start.kind;
      }
    }
  }
  return comment;
}

function collectTags(comment, file, line, state, items, problems) {
  for (const m of comment.matchAll(TAG_RE)) {
    const id = mkId(m[2], m[3], m[4], m[5]);
    if (!m[1]) {
      state.last = newItem(id, 'code', file, line);
      items.push(state.last);
    } else if (state.last) {
      // [>>...] need tag
      state.last.needs.push(id);
    } else {
      problems.push({
        file,
        line,
        message: `need tag [>>${id}] has no preceding item tag in this file`,
      });
    }
  }
}

export function parseCode(file, text, problems, forwards = []) {
  const ext = path.extname(file).toLowerCase();
  const lines = text.split(/\r?\n/);
  const items = [];
  const lineMarkers = ext === '.sql' ? ['--'] : ['//'];
  const htmlBlocks = ext === '.vue';
  // last: nearest preceding item tag in this file; block: open 'c' (/* */) | 'html' (<!-- -->)
  const state = { last: null, block: null };

  for (let i = 0; i < lines.length; i++) {
    const comment = commentText(lines[i], state, lineMarkers, htmlBlocks);
    for (const m of comment.matchAll(FORWARD_RE)) {
      forwards.push(mkForward(m, 1, file, i + 1));
    }
    collectTags(comment, file, i + 1, state, items, problems);
  }
  return items;
}
