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
import { cLike, grammarFor } from './languages.mjs';

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
  // earliest match wins; on a tie the longest opener wins, so a block opener
  // that shares a prefix with a line marker (Lua `--[[` vs `--`) is not masked.
  const consider = (idx, ev) => {
    if (idx === -1) return;
    if (best === null || idx < best.idx || (idx === best.idx && ev.len > best.len)) {
      best = { ...ev, idx };
    }
  };
  for (const marker of leaf.line) {
    consider(s.indexOf(marker, pos), { kind: 'line', len: marker.length });
  }
  for (const [open, close, nestable] of leaf.block) {
    consider(s.indexOf(open, pos), {
      kind: 'block', len: open.length, open, close, nestable: Boolean(nestable),
    });
  }
  for (const ev of regionEvents(s, pos, grammar, state)) consider(ev.idx, ev);
  return best;
}

// consume text while a block comment is open, honoring nested openers when the
// grammar marks the pair nestable (Rust, Swift, Kotlin, Scala, ...). Scanning
// stops at `limit` (used to cap a block at a region exit); mutates block.depth
// and returns the comment text and where scanning resumes.
function readBlockRest(s, pos, block, limit = s.length) {
  const { open, close, nestable } = block;
  const within = (idx) => (idx !== -1 && idx < limit ? idx : -1);
  let i = pos;
  while (i < limit) {
    const closeIdx = within(s.indexOf(close, i));
    const openIdx = within(nestable ? s.indexOf(open, i) : -1);
    if (closeIdx === -1 && openIdx === -1) break;
    if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
      block.depth++;
      i = openIdx + open.length;
      continue;
    }
    block.depth--;
    i = closeIdx + close.length;
    if (block.depth === 0) return { text: s.slice(pos, closeIdx) + ' ', pos: i, closed: true };
  }
  return { text: s.slice(pos, limit) + ' ', pos: limit, closed: false };
}

// the region's exit match at or after pos on this line, or null
function regionExitAt(s, pos, region) {
  const m = matchAt(region.exit, s, pos);
  return m ? { idx: m.index, len: m[0].length } : null;
}

// advance over an open block comment, capped at the region exit if one is ahead;
// returns { text, pos } and updates state.block / state.region.
function consumeBlock(s, pos, state, exit) {
  const rest = readBlockRest(s, pos, state.block, exit ? exit.idx : s.length);
  if (rest.closed) {
    state.block = null;
    return { text: rest.text, pos: rest.pos };
  }
  if (exit) {
    // exit reached before the block closed: end block and region together
    state.block = null;
    state.region = null;
    return { text: rest.text, pos: exit.idx + exit.len };
  }
  return { text: rest.text, pos: rest.pos };
}

// consume a line comment from pos: to the region exit if one is ahead (the
// region then ends), otherwise to end of line. `done` means stop scanning.
function consumeLine(s, pos, state, exit) {
  if (exit) {
    state.region = null;
    return { text: s.slice(pos, exit.idx) + ' ', pos: exit.idx + exit.len, done: false };
  }
  return { text: s.slice(pos) + ' ', pos: s.length, done: true };
}

// comment text of one line. state.block carries an open block comment (its
// open/close tokens and nesting depth) across lines; state.region carries the
// active composite region across lines. A region *enter* is only recognized
// outside comments (so `<!-- <script> -->` never opens a script region), but a
// region *exit* is a hard boundary that ends the region even mid-comment, the
// way a browser terminates a raw-text element at the first `</script>`.
function commentText(s, state, grammar) {
  let comment = '';
  let pos = 0;
  while (pos < s.length) {
    const exit = state.region ? regionExitAt(s, pos, state.region) : null;

    if (state.block) {
      const r = consumeBlock(s, pos, state, exit);
      comment += r.text;
      pos = r.pos;
      continue;
    }

    const ev = nextEvent(s, pos, grammar, state);
    if (!ev) break;
    pos = ev.idx + ev.len;
    if (ev.kind === 'line') {
      const r = consumeLine(s, pos, state, exit);
      comment += r.text;
      pos = r.pos;
      if (r.done) break;
    } else if (ev.kind === 'block') {
      state.block = { open: ev.open, close: ev.close, nestable: ev.nestable, depth: 1 };
    } else if (ev.kind === 'enter') {
      state.region = ev.region;
    } else {
      // 'exit' - reached only outside a block comment (the block branch above
      // continues), so there is no open block to clear here.
      state.region = null;
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

export function parseCode(file, text, problems, forwards = []) {
  const ext = path.extname(file).toLowerCase();
  // Unknown extensions never reach here via the CLI (collectFiles filters on
  // CODE_EXT); direct callers and future extensions fall back to C-like.
  const grammar = grammarFor(ext) ?? cLike;
  const lines = text.split(/\r?\n/);
  const items = [];
  // last: nearest preceding item tag in this file; byId: preceding item tags
  // by ID; block: open block-comment descriptor ({ open, close, nestable,
  // depth }) or null; region: active composite region (script/style) or null.
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
