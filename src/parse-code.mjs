/*
 * Code parser - comment-aware tag scanner. The comment vocabulary (line markers
 * and block-comment pairs) is chosen per file extension by src/languages.mjs, so
 * the same machinery serves every supported language:
 *   - `[<id>]` inside a comment defines a coverage item with that ID.
 *   - `[>><id>]` inside a comment attaches a need to the nearest preceding
 *     item tag in the same file (error if there is none).
 *   - `[<source-id> >> <id>]` attaches the need to the preceding item tag with
 *     exactly that source ID instead (error if there is none), so tags placed
 *     in between cannot steal the attachment (spaces around `>>` optional).
 *   - `[<id> --> <id>]` inside a comment forwards the first item's coverage
 *     obligation to the second (spaces optional).
 */

import path from 'node:path';

import { FORWARD_SRC, ID_SRC, NEED_ID_SRC, mkForward, mkId, newItem } from './ids.mjs';
import { grammarFor } from './languages.mjs';

// Alternation: need tag with optional explicit source (groups 1-4 source,
// 5-8 target), or plain item tag (groups 9-12). The need target uses
// NEED_ID_SRC so it may carry a wildcard revision; the source and item tags
// stay concrete (ID_SRC). NEED_ID_SRC captures the same four groups as ID_SRC,
// so the group numbering is unchanged.
const TAG_RE = new RegExp(
  String.raw`\[(?:\s*${ID_SRC}\s*)?>>\s*${NEED_ID_SRC}\s*\]|\[\s*${ID_SRC}\s*\]`,
  'g',
);
const FORWARD_RE = new RegExp(FORWARD_SRC, 'g');

// earliest comment opener in s at or after pos, or null
function findCommentStart(s, pos, grammar) {
  let best = null;
  const consider = (idx, ev) => {
    if (idx !== -1 && (best === null || idx < best.idx)) best = { ...ev, idx };
  };
  for (const marker of grammar.line) {
    consider(s.indexOf(marker, pos), { kind: 'line', len: marker.length });
  }
  for (const [open, close] of grammar.block) {
    consider(s.indexOf(open, pos), { kind: 'block', len: open.length, closer: close });
  }
  return best;
}

// consume the open block comment; returns its text and where scanning resumes
function readBlockRest(s, pos, closer) {
  const end = s.indexOf(closer, pos);
  if (end === -1) return { text: s.slice(pos) + ' ', pos: s.length, closed: false };
  return { text: s.slice(pos, end) + ' ', pos: end + closer.length, closed: true };
}

// comment text of one line; state.block carries an open block comment (its
// closer string) across lines
function commentText(s, state, grammar) {
  let comment = '';
  let pos = 0;
  while (pos < s.length) {
    if (state.block) {
      const rest = readBlockRest(s, pos, state.block);
      comment += rest.text;
      pos = rest.pos;
      if (rest.closed) state.block = null;
    } else {
      const start = findCommentStart(s, pos, grammar);
      if (!start) break;
      pos = start.idx + start.len;
      if (start.kind === 'line') {
        comment += s.slice(pos) + ' ';
        pos = s.length;
      } else {
        state.block = start.closer;
      }
    }
  }
  return comment;
}

function collectTags(comment, file, line, state, items, problems) {
  for (const m of comment.matchAll(TAG_RE)) {
    if (m[9]) {
      // [<id>] item tag
      const item = newItem(mkId(m[9], m[10], m[11], m[12]), 'code', file, line);
      state.last = item;
      state.byId.set(item.id, item);
      items.push(item);
      continue;
    }
    const id = mkId(m[5], m[6], m[7], m[8]);
    if (m[1]) {
      // [<source-id> >> ...] explicit need tag
      const source = mkId(m[1], m[2], m[3], m[4]);
      const anchor = state.byId.get(source);
      if (anchor) {
        anchor.needs.push(id);
      } else {
        problems.push({
          file,
          line,
          message: `need tag [${source} >> ${id}] has no preceding item tag [${source}] in this file`,
        });
      }
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

// Unknown extensions never reach parseCode via the CLI (collectFiles filters on
// CODE_EXT), but direct callers and future extensions fall back to C-like.
const FALLBACK = { line: ['//'], block: [['/*', '*/']] };

export function parseCode(file, text, problems, forwards = []) {
  const ext = path.extname(file).toLowerCase();
  const grammar = grammarFor(ext) ?? FALLBACK;
  const lines = text.split(/\r?\n/);
  const items = [];
  // last: nearest preceding item tag in this file; byId: preceding item tags
  // by ID; block: open block-comment closer string (e.g. '*/', '-->') or null.
  const state = { last: null, byId: new Map(), block: null };

  for (let i = 0; i < lines.length; i++) {
    const comment = commentText(lines[i], state, grammar);
    for (const m of comment.matchAll(FORWARD_RE)) {
      forwards.push(mkForward(m, 1, file, i + 1));
    }
    collectTags(comment, file, i + 1, state, items, problems);
  }
  return items;
}
