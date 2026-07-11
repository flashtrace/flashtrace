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

// leaf grammar (line markers + block pairs) active at the current position: the
// region's grammar when inside one, otherwise the file's default.
function activeLeaf(grammar, state) {
  if (state.region) return state.region.grammar;
  return grammar.regions ? grammar.default : grammar;
}

// first match of a global regex at or after pos, or null
function matchAt(re, s, pos) {
  re.lastIndex = pos;
  return re.exec(s);
}

// region boundary events (enter/exit) for a composite grammar at or after pos
function* regionEvents(s, pos, grammar, state) {
  if (!grammar.regions) return;
  if (state.region) {
    const m = matchAt(state.region.exit, s, pos);
    if (m) yield { idx: m.index, kind: 'exit', len: m[0].length };
    return;
  }
  for (const r of grammar.regions) {
    const m = matchAt(r.enter, s, pos);
    if (m) yield { idx: m.index, kind: 'enter', len: m[0].length, region: r };
  }
}

// earliest scanning event in s at or after pos, or null: a comment opener from
// the active leaf grammar, or - for composite grammars - a region boundary.
function nextEvent(s, pos, grammar, state) {
  const leaf = activeLeaf(grammar, state);
  let best = null;
  const consider = (idx, ev) => {
    if (idx !== -1 && (best === null || idx < best.idx)) best = { ...ev, idx };
  };
  for (const marker of leaf.line) {
    consider(s.indexOf(marker, pos), { kind: 'line', len: marker.length });
  }
  for (const [open, close] of leaf.block) {
    consider(s.indexOf(open, pos), { kind: 'block', len: open.length, closer: close });
  }
  for (const ev of regionEvents(s, pos, grammar, state)) consider(ev.idx, ev);
  return best;
}

// consume the open block comment; returns its text and where scanning resumes
function readBlockRest(s, pos, closer) {
  const end = s.indexOf(closer, pos);
  if (end === -1) return { text: s.slice(pos) + ' ', pos: s.length, closed: false };
  return { text: s.slice(pos, end) + ' ', pos: end + closer.length, closed: true };
}

// comment text of one line. state.block carries an open block comment (its
// closer string) across lines; state.region carries the active composite region
// across lines. Region boundaries are only recognized outside comments, so an
// HTML comment such as `<!-- <script> -->` never opens a script region.
function commentText(s, state, grammar) {
  let comment = '';
  let pos = 0;
  while (pos < s.length) {
    if (state.block) {
      const rest = readBlockRest(s, pos, state.block);
      comment += rest.text;
      pos = rest.pos;
      if (rest.closed) state.block = null;
      continue;
    }
    const ev = nextEvent(s, pos, grammar, state);
    if (!ev) break;
    pos = ev.idx + ev.len;
    if (ev.kind === 'line') {
      comment += s.slice(pos) + ' ';
      break;
    } else if (ev.kind === 'block') {
      state.block = ev.closer;
    } else if (ev.kind === 'enter') {
      state.region = ev.region;
    } else {
      // 'exit': a block comment cannot straddle a region boundary
      state.region = null;
      state.block = null;
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
  // by ID; block: open block-comment closer string (e.g. '*/', '-->') or null;
  // region: active composite region (script/style) or null.
  const state = { last: null, byId: new Map(), block: null, region: null };

  for (let i = 0; i < lines.length; i++) {
    const comment = commentText(lines[i], state, grammar);
    for (const m of comment.matchAll(FORWARD_RE)) {
      forwards.push(mkForward(m, 1, file, i + 1));
    }
    collectTags(comment, file, i + 1, state, items, problems);
  }
  return items;
}
