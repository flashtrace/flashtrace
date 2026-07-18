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
 *   - The need target of either form may be short (`utest`, `utest:name`,
 *     `utest#2`): its omitted [group/]name and revision are taken from the
 *     item the need attaches to.
 *   - `[<id> --> <id>]` inside a comment forwards the first item's coverage
 *     obligation to the second (spaces optional).
 */

import path from 'node:path';

import { FORWARD_SRC, ID_SRC, REF_SRC, canonicalId, makeForward, makeId, newItem, resolveRef } from './ids.mjs';
import { cLike, grammarFor } from './languages.mjs';

// Alternation: a need tag with an optional explicit source (groups 1-4 source,
// 5-7 target), or a plain item tag (groups 8-11). The target is a REF_SRC
// reference (type, optional [group/]name, optional revision) completed against
// the anchor item; the source and item tags stay full, concrete IDs (ID_SRC).
const TAG_RE = new RegExp(
  String.raw`\[(?:\s*${ID_SRC}\s*)?>>\s*${REF_SRC}\s*\]|\[\s*${ID_SRC}\s*\]`,
  'g',
);
const FORWARD_RE = new RegExp(FORWARD_SRC, 'g');

// URL-shaped text: a scheme followed by ://, extending until a character that
// ends a URL in practice (whitespace, quotes/backtick, brackets, angle
// brackets - so a tag or an HTML tag right next to a URL stays outside).
// The scheme repetition is bounded so a long run of scheme-valid characters
// with no :// cannot force super-linear backtracking; 63 clears every real
// scheme (RFC 3986 and reverse-DNS custom schemes stay well under it).
const URL_RE = /[A-Za-z][A-Za-z0-9+.-]{0,63}:\/\/[^\s"'`<>[\]]*/g;

// spans [start, end) of URL-shaped text in a line, in order. Comment *openers*
// inside a span are ignored (see markerIndex), so the `//`, `#`, `--` or `/*`
// of e.g. `https://example.com/a--b#anchor` cannot open a phantom comment.
// Block *closers* are still honoured inside URLs: skipping a closer could leave
// a block comment open far past its real end, which is worse than the phantom
// it would prevent.
function urlSpans(line) {
  if (!line.includes('://')) return [];
  return [...line.matchAll(URL_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

// first index of `marker` at or after pos that lies outside every URL span,
// or -1. Spans are in ascending order and the index only moves forward, so a
// single pass over the spans suffices.
function markerIndex(line, marker, pos, spans) {
  let idx = line.indexOf(marker, pos);
  for (const span of spans) {
    if (idx === -1 || idx < span.start) break;
    if (idx < span.end) idx = line.indexOf(marker, span.end);
  }
  return idx;
}

// leaf grammar (line markers + block pairs) active at the current position: the
// region's grammar when inside one, otherwise the file's default.
function activeLeaf(grammar, state) {
  if (state.region) return state.region.grammar;
  return grammar.regions ? grammar.default : grammar;
}

// first match of a global regex at or after pos, or null
function matchAt(re, line, pos) {
  re.lastIndex = pos;
  return re.exec(line);
}

// region boundary events (enter/exit) for a composite grammar at or after pos
function* regionEvents(line, pos, grammar, state) {
  if (!grammar.regions) return;
  if (state.region) {
    const m = matchAt(state.region.exit, line, pos);
    if (m) yield { idx: m.index, kind: 'exit', len: m[0].length };
    return;
  }
  for (const region of grammar.regions) {
    const m = matchAt(region.enter, line, pos);
    if (m) {
      // region.grammar may be a resolver picking the leaf from the opening tag
      const leaf = typeof region.grammar === 'function' ? region.grammar(m[0]) : region.grammar;
      yield { idx: m.index, kind: 'enter', len: m[0].length, region: { exit: region.exit, grammar: leaf } };
    }
  }
}

// earliest scanning event in the line at or after pos, or null: a comment
// opener from the active leaf grammar, or - for composite grammars - a region
// boundary.
function nextEvent(line, pos, grammar, state, spans) {
  const leaf = activeLeaf(grammar, state);
  let best = null;
  // earliest match wins; on a tie the longest opener wins, so a block opener
  // that shares a prefix with a line marker (Lua `--[[` vs `--`) is not masked.
  const consider = (idx, event) => {
    if (idx === -1) return;
    if (best === null || idx < best.idx || (idx === best.idx && event.len > best.len)) {
      best = { ...event, idx };
    }
  };
  for (const marker of leaf.line) {
    consider(markerIndex(line, marker, pos, spans), { kind: 'line', len: marker.length });
  }
  for (const [open, close, nestable] of leaf.block) {
    consider(markerIndex(line, open, pos, spans), {
      kind: 'block', len: open.length, open, close, nestable: Boolean(nestable),
    });
  }
  for (const event of regionEvents(line, pos, grammar, state)) consider(event.idx, event);
  return best;
}

// consume text while a block comment is open, honoring nested openers when the
// grammar marks the pair nestable (Rust, Swift, Kotlin, Scala, ...). Scanning
// stops at `limit` (used to cap a block at a region exit); mutates block.depth
// and returns the comment content range [pos, end) and where scanning resumes.
function readBlockRest(line, pos, block, limit = line.length) {
  const { open, close, nestable } = block;
  const within = (idx) => (idx !== -1 && idx < limit ? idx : -1);
  let i = pos;
  while (i < limit) {
    const closeIdx = within(line.indexOf(close, i));
    const openIdx = within(nestable ? line.indexOf(open, i) : -1);
    if (closeIdx === -1 && openIdx === -1) break;
    if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
      block.depth++;
      i = openIdx + open.length;
      continue;
    }
    block.depth--;
    i = closeIdx + close.length;
    if (block.depth === 0) return { end: closeIdx, pos: i, closed: true };
  }
  return { end: limit, pos: limit, closed: false };
}

// the region's exit match at or after pos on this line, or null
function regionExitAt(line, pos, region) {
  const m = matchAt(region.exit, line, pos);
  return m ? { idx: m.index, len: m[0].length } : null;
}

// advance over an open block comment, capped at the region exit if one is ahead;
// returns the comment content end and resume pos, updating state.block/region.
function consumeBlock(line, pos, state, exit) {
  const rest = readBlockRest(line, pos, state.block, exit ? exit.idx : line.length);
  if (rest.closed) {
    state.block = null;
    return { end: rest.end, pos: rest.pos };
  }
  if (exit) {
    // exit reached before the block closed: end block and region together
    state.block = null;
    state.region = null;
    return { end: rest.end, pos: exit.idx + exit.len };
  }
  return { end: rest.end, pos: rest.pos };
}

// consume a line comment from pos: to the region exit if one is ahead (the
// region then ends), otherwise to end of line. `done` means stop scanning.
// Returns the comment content end and resume pos.
function consumeLine(line, pos, state, exit) {
  if (exit) {
    state.region = null;
    return { end: exit.idx, pos: exit.idx + exit.len, done: false };
  }
  return { end: line.length, pos: line.length, done: true };
}

// comment text of one line, position-preserving: the returned string has the
// same length as `line`, carrying each comment character at its original column
// and a space at every code character and comment marker. A tag or forwarding
// matched in it therefore occupies the same columns it does in the source, so
// its 1-based column is `match.index + 1`.
//
// state.block carries an open block comment (its open/close tokens and nesting
// depth) across lines; state.region carries the active composite region across
// lines. A region *enter* is only recognized outside comments (so
// `<!-- <script> -->` never opens a script region), but a region *exit* is a
// hard boundary that ends the region even mid-comment, the way a browser
// terminates a raw-text element at the first `</script>`.
function commentText(line, state, grammar) {
  const spans = urlSpans(line);
  const buffer = new Array(line.length).fill(' ');
  const keep = (from, to) => {
    for (let k = from; k < to; k++) buffer[k] = line[k];
  };
  let pos = 0;
  while (pos < line.length) {
    const exit = state.region ? regionExitAt(line, pos, state.region) : null;

    if (state.block) {
      const consumed = consumeBlock(line, pos, state, exit);
      keep(pos, consumed.end);
      pos = consumed.pos;
      continue;
    }

    const event = nextEvent(line, pos, grammar, state, spans);
    if (!event) break;
    pos = event.idx + event.len;
    if (event.kind === 'line') {
      const consumed = consumeLine(line, pos, state, exit);
      keep(pos, consumed.end);
      pos = consumed.pos;
      if (consumed.done) break;
    } else if (event.kind === 'block') {
      state.block = { open: event.open, close: event.close, nestable: event.nestable, depth: 1 };
    } else if (event.kind === 'enter') {
      state.region = event.region;
    } else {
      // 'exit' - reached only outside a block comment (the block branch above
      // continues), so there is no open block to clear here.
      state.region = null;
    }
  }
  return buffer.join('');
}

// Attach one need tag to its anchor item. The explicit form [<source-id> >> ...]
// anchors at the item tag named by its source ID, the implicit form [>>...] at
// the nearest preceding item tag; a missing anchor is reported. The target
// reference (groups 5-7: type, optional [group/]name, optional revision) is
// completed against the anchor item - see REF_SRC.
function attachNeed(m, file, line, character, state, problems) {
  const source = m[1] ? makeId(m[1], m[2], m[3], m[4]) : null;
  const anchor = source ? state.byId.get(canonicalId(source)) : state.lastItem;
  if (!anchor) {
    // the target as written, for the problem message
    const written = m[5] + (m[6] ? `:${m[6]}` : '') + (m[7] ? `#${m[7]}` : '');
    problems.push({
      file,
      line,
      character,
      message: source
        ? `need tag [${source} >> ${written}] has no preceding item tag [${source}] in this file`
        : `need tag [>>${written}] has no preceding item tag in this file`,
    });
    return;
  }
  anchor.needs.push(resolveRef(m[5], m[6], m[7], anchor.id));
}

function collectTags(comment, file, line, state, items, problems) {
  for (const m of comment.matchAll(TAG_RE)) {
    // comment is position-preserving, so the tag's `[` sits at its source column
    const character = m.index + 1;
    if (m[8]) {
      // [<id>] item tag
      const item = newItem(makeId(m[8], m[9], m[10], m[11]), 'code', file, line, character);
      state.lastItem = item;
      state.byId.set(canonicalId(item.id), item);
      items.push(item);
    } else {
      attachNeed(m, file, line, character, state, problems);
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
  // lastItem: nearest preceding item tag in this file; byId: preceding item
  // tags by canonical ID (so an anchor may spell a SemVer-equal revision);
  // block: open block-comment descriptor ({ open, close, nestable,
  // depth }) or null; region: active composite region (script/style) or null.
  const state = { lastItem: null, byId: new Map(), block: null, region: null };

  for (let i = 0; i < lines.length; i++) {
    const comment = commentText(lines[i], state, grammar);
    for (const m of comment.matchAll(FORWARD_RE)) {
      forwards.push(makeForward(m, 1, file, i + 1, m.index + 1));
    }
    collectTags(comment, file, i + 1, state, items, problems);
  }
  return items;
}
