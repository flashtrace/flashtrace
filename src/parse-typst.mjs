/*
 * Typst parser (.typ):
 *   - An item is defined by a line containing only its ID in backticks:
 *     `req:auth/login#1` - a Typst raw span, so the ID renders verbatim and
 *     the `#` of the revision stays literal instead of opening code mode.
 *   - Title: the heading directly above the ID (only blank lines in between),
 *     written `= Title` with any number of `=`; a trailing `<label>` is Typst
 *     metadata, not title text.
 *   - Description: the lines following the ID (one blank line directly under
 *     the ID is allowed) up to the next blank line.
 *   - Keywords "Needs:", "Covers:", "Tags:" - as a plain line or a Typst term
 *     list item (`/ Needs: ...`); entries inline comma-separated, as a list on
 *     the following lines (`-` bullets or `+` enumeration; `*` spells strong
 *     emphasis in Typst, not a list), or as a `#table(...)` column whose
 *     header cell is the bare keyword name.
 *   - A Needs or Covers entry carrying a revision must be wrapped in
 *     backticks: bare, the `#` opens Typst code mode and the compiled
 *     document silently drops it. `#`-free short forms (impl, impl:name)
 *     render verbatim and may stay bare.
 *   - A line containing only a backticked forwarding tag
 *     `[<id> --> <id>]` forwards the first item's coverage obligation to the
 *     second. Only the backticked spelling counts: bare, the brackets are
 *     content-block delimiters and `--` ligates to an en dash, so the tag
 *     would not survive compilation and is reported instead.
 *   - Typst comments (`//` and the nestable block form) and fenced raw blocks
 *     (three or more backticks) contribute no markup and are blanked before
 *     parsing; a raw span (the item syntax itself) and the `//` of a
 *     `scheme://` URL stay live.
 *
 * Only the Typst spelling lives here; what a keyword's entries mean for an
 * item is format-neutral and lives in src/spec-items.mjs.
 */

import { FORWARD_SRC, ID_SRC, makeForward, makeId, newItem } from './ids.mjs';
import { KEYWORDS, applyKeyword, isKeyword, keywordEntries } from './spec-items.mjs';

const DEFINITION_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
// A Typst heading: a `=` run, whitespace, then text. Any depth - Typst does
// not cap heading levels - and indentation is allowed, as Typst ignores
// leading whitespace before markup elements.
const HEADING_RE = /^\s*=+\s+(\S(?:.*\S)?)\s*$/;
// A trailing <label> attaches a Typst label to its heading; it is metadata.
// The whitespace before it is left to the caller's trim - a `\s*` here would
// backtrack super-linearly on long whitespace runs.
const LABEL_RE = /<[A-Za-z_][A-Za-z0-9_.:-]*>$/;
// The vocabulary is owned by src/spec-items.mjs and interpolated here as an
// alternation; keywords stay bare words (spec-items.mjs guards that), so they
// need no regex escaping. The optional `/ ` prefix is a Typst term list item -
// the idiomatic spelling of a labeled field.
const KEYWORD_RE = new RegExp(String.raw`^(?:\/\s+)?(${KEYWORDS.join('|')}):\s*((?:\S.*)?)$`);
// Typst list markers: `-` (bullet list) and `+` (enumeration)
const BULLET_RE = /^\s*[-+]\s+(\S(?:.*\S)?)\s*$/;
// captures start at group 1: the backticks are literal, not captured
const FORWARD_LINE_RE = new RegExp(String.raw`^\s*\`${FORWARD_SRC}\`\s*$`);
const BARE_FORWARD_LINE_RE = new RegExp(String.raw`^\s*${FORWARD_SRC}\s*$`);
const TABLE_LINE_RE = /^\s*#table\(/;
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*/y;
const DIGITS_RE = /\d+/y;

// 1-based column of the first non-blank character of a line - the construct a
// location points at (the backtick of an ID line or a forwarding line).
// Never called on a blank line.
const firstNonBlankColumn = (line) => line.search(/\S/) + 1;

/*
 * Typst reads `//` line comments and nestable block comments even in markup
 * mode, and a fenced raw block of three or more backticks displays its content
 * verbatim. Neither contributes markup, so both are blanked to spaces before
 * line parsing - length and newlines stay, keeping every line and column
 * intact, and a fully commented line becomes blank exactly as it renders.
 * Two exemptions keep rendered text alive: a single-backtick raw span is
 * verbatim markup (the item syntax itself), so its content never opens a
 * comment; and the `//` of a URL (`scheme://`) is link text, as Typst
 * auto-links it - mirroring the URL exemption of the code-side scanner.
 */
const blankAt = (out, index) => {
  if (out[index] !== '\n' && out[index] !== '\r') out[index] = ' ';
};

const blankRange = (out, from, to) => {
  for (let k = from; k < to; k++) blankAt(out, k);
};

const backtickRunLength = (text, index) => {
  let run = 0;
  while (text[index + run] === '`') run++;
  return run;
};

// inside a nestable block comment: nested openers and closers adjust the
// depth, everything else is display-free and blanked
function stepBlockComment(text, masking, i) {
  if (text[i] === '/' && text[i + 1] === '*') masking.blockCommentDepth++;
  else if (text[i] === '*' && text[i + 1] === '/') masking.blockCommentDepth--;
  else {
    blankAt(masking.out, i);
    return i + 1;
  }
  blankAt(masking.out, i);
  blankAt(masking.out, i + 1);
  return i + 2;
}

// inside a fenced raw block everything is display material; a backtick run at
// least as long as the opening fence closes the block
function stepRawBlock(text, masking, i) {
  const run = backtickRunLength(text, i);
  if (run === 0) {
    blankAt(masking.out, i);
    return i + 1;
  }
  blankRange(masking.out, i, i + run);
  if (run >= masking.rawFence) masking.rawFence = 0;
  return i + run;
}

// A backtick outside a raw block: one closes an open raw span or opens a new
// one, a run of three or more opens a fenced raw block. A `` pair is an empty
// raw span and toggles nothing.
function stepBacktickRun(text, masking, i) {
  if (masking.inRawSpan) {
    masking.inRawSpan = false;
    return i + 1;
  }
  const run = backtickRunLength(text, i);
  if (run >= 3) {
    blankRange(masking.out, i, i + run);
    masking.rawFence = run;
  } else if (run === 1) {
    masking.inRawSpan = true;
  }
  return i + run;
}

// `//` opens a line comment - unless it spells the `//` of a `scheme://` URL,
// which is link text - and `/*` opens a nestable block comment
function stepSlash(text, masking, i) {
  if (text[i + 1] === '/') {
    // `scheme://` is a link, not a comment
    if (text[i - 1] === ':' && /[A-Za-z0-9]/.test(text[i - 2] ?? '')) return i + 2;
    let j = i;
    while (j < text.length && text[j] !== '\n' && text[j] !== '\r') {
      blankAt(masking.out, j);
      j++;
    }
    return j;
  }
  if (text[i + 1] === '*') {
    masking.blockCommentDepth = 1;
    blankAt(masking.out, i);
    blankAt(masking.out, i + 1);
    return i + 2;
  }
  return i + 1;
}

// one dispatch step of the masking scan; returns the index after the handled
// construct
function maskStep(text, masking, i) {
  const character = text[i];
  if (character === '\n') {
    masking.inRawSpan = false;
    return i + 1;
  }
  if (masking.blockCommentDepth > 0) return stepBlockComment(text, masking, i);
  if (masking.rawFence > 0) return stepRawBlock(text, masking, i);
  if (character === '`') return stepBacktickRun(text, masking, i);
  if (character === '/' && !masking.inRawSpan) return stepSlash(text, masking, i);
  return i + 1;
}

function maskCommentsAndRawBlocks(text) {
  const masking = {
    out: text.split(''),
    blockCommentDepth: 0,
    rawFence: 0, // length of the backtick run that opened a raw block
    inRawSpan: false, // inside a single-backtick raw span, one line only
  };
  let i = 0;
  while (i < text.length) i = maskStep(text, masking, i);
  return masking.out.join('');
}

// a line that is only a forwarding tag: backticked it pushes a forward; bare
// it would not survive Typst compilation (`--` ligates to an en dash, the
// brackets are content-block delimiters) and is reported instead
function takeForward(line, file, lineIndex, problems, forwards) {
  const forward = line.match(FORWARD_LINE_RE);
  if (forward) {
    forwards.push(makeForward(forward, 1, file, lineIndex + 1, firstNonBlankColumn(line)));
    return true;
  }
  const bare = line.match(BARE_FORWARD_LINE_RE);
  if (bare) {
    const from = makeId(bare[1], bare[2], bare[3], bare[4]);
    const to = makeId(bare[5], bare[6], bare[7], bare[8]);
    problems.push({
      file,
      line: lineIndex + 1,
      character: firstNonBlankColumn(line),
      message: `bare forwarding tag [${from} --> ${to}]; a '#' outside backticks opens Typst code mode - wrap the tag in backticks`,
    });
    return true;
  }
  return false;
}

// A Needs or Covers entry whose spelling carries a `#` must be backticked:
// bare, the `#` opens Typst code mode and the compiled document silently
// drops it, so source and rendered output would disagree. `#`-free short
// forms render verbatim and stay accepted bare; Tags are free-form text, not
// IDs. The surviving entries share src/spec-items.mjs with every other format.
function applyTypstKeyword(item, keyword, entries, file, problems, source) {
  const accepted = [];
  for (const entry of entries) {
    const bareRevision =
      keyword !== 'Tags' &&
      entry.value.includes('#') &&
      !(entry.value.length > 2 && entry.value.startsWith('`') && entry.value.endsWith('`'));
    if (bareRevision) {
      problems.push({
        file,
        line: entry.line,
        character: entry.character,
        message: `bare ID "${entry.value}" in ${source}; a '#' outside backticks opens Typst code mode - wrap the ID in backticks`,
      });
      continue;
    }
    accepted.push(entry);
  }
  applyKeyword(item, keyword, accepted, file, problems, source);
}

function titleAbove(lines, inTable, definitionIndex) {
  for (let k = definitionIndex - 1; k >= 0; k--) {
    const line = lines[k];
    if (line.trim() === '') continue; // blank lines between heading and ID are fine
    const heading = inTable[k] ? null : line.match(HEADING_RE);
    if (!heading) return null; // any other text directly above -> no title
    const title = heading[1].replace(LABEL_RE, '').trim();
    return title === '' ? null : title;
  }
  return null;
}

// An item's body ends at an ID definition or a heading. A line inside a
// `#table(...)` call is table material - a heading-shaped line in a
// multi-line cell bounds nothing.
const isBoundary = (lines, inTable, j) =>
  !inTable[j] && (DEFINITION_RE.test(lines[j]) || HEADING_RE.test(lines[j]));

// skip a double-quoted string literal; returns the index past the closing quote
function skipString(text, open) {
  let i = open + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

// Skip a balanced ()- or []-group starting at `open`, through nested groups,
// string literals and raw spans; returns the index past the closing delimiter
// (or the text length when unterminated).
function skipBalanced(text, open) {
  let depth = 0;
  let inRawSpan = false;
  let i = open;
  while (i < text.length) {
    const character = text[i];
    if (character === '`') {
      inRawSpan = !inRawSpan;
      i++;
      continue;
    }
    if (inRawSpan) {
      i++;
      continue;
    }
    if (character === '"') {
      i = skipString(text, i);
      continue;
    }
    if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

// a content block `[...]`: the cell syntax of a Typst table
function readContentBlock(text, open) {
  const after = skipBalanced(text, open);
  return { contentStart: open + 1, contentEnd: after - 1, after };
}

// advance to the current argument's end: past the next top-level comma, or to
// the closing paren of the call (not consumed)
function skipToArgumentEnd(text, from) {
  let i = from;
  let inRawSpan = false;
  while (i < text.length) {
    const character = text[i];
    if (character === '`') {
      inRawSpan = !inRawSpan;
      i++;
      continue;
    }
    if (inRawSpan) {
      i++;
      continue;
    }
    if (character === ',') return i + 1;
    if (character === ')') return i;
    if (character === '"') {
      i = skipString(text, i);
      continue;
    }
    if (character === '(' || character === '[') {
      i = skipBalanced(text, i);
      continue;
    }
    i++;
  }
  return i;
}

// entries of a parenthesized track list, e.g. `(auto, 1fr, auto)` -> 3
function countTrackList(text, open) {
  const after = skipBalanced(text, open);
  let count = 0;
  let sawEntry = false;
  let i = open + 1;
  while (i < after - 1) {
    const character = text[i];
    if (character === ',') {
      if (sawEntry) count++;
      sawEntry = false;
      i++;
      continue;
    }
    if (character === '(' || character === '[') {
      i = skipBalanced(text, i);
      sawEntry = true;
      continue;
    }
    if (character === '"') {
      i = skipString(text, i);
      sawEntry = true;
      continue;
    }
    if (/\S/.test(character)) sawEntry = true;
    i++;
  }
  if (sawEntry) count++;
  return { count, after };
}

// The `columns:` argument: an integer count, or a parenthesized track list
// whose entries are counted. Any other spelling leaves the column count
// unknown (null) and the argument is skipped.
function parseColumnsArgument(text, from) {
  let i = from;
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (text[i] === '(') {
    const tracks = countTrackList(text, i);
    return { count: tracks.count || null, after: tracks.after };
  }
  DIGITS_RE.lastIndex = i;
  const digits = DIGITS_RE.exec(text)?.[0];
  // an integer only: `3` is a count, `3cm` or `2.5` is a single track spec
  if (digits && !/[.\w%]/.test(text[i + digits.length] ?? '')) {
    return { count: Number(digits), after: i + digits.length };
  }
  return { count: null, after: skipToArgumentEnd(text, i) };
}

// One step over the tokens every cell scanner shares: a content block is
// collected into `cells`, a string literal or parenthesized group is skipped
// whole. Returns the index after the token, or null when the character at `i`
// opens none of them.
function takeCellToken(text, i, cells) {
  const character = text[i];
  if (character === '[') {
    const block = readContentBlock(text, i);
    cells.push(block);
    return block.after;
  }
  if (character === '"') return skipString(text, i);
  if (character === '(') return skipBalanced(text, i);
  return null;
}

// the top-level content-block cells of a call, e.g. of `table.header(...)`
function collectCells(text, open) {
  const cells = [];
  let i = open + 1;
  while (i < text.length && text[i] !== ')') {
    const taken = takeCellToken(text, i, cells);
    i = taken ?? i + 1;
  }
  return { cells, after: i + 1 };
}

// helper calls that draw lines and carry no cell, safe to skip outright
const CELL_FREE_CALLS = new Set(['table.hline', 'table.vline']);

// a named argument: `columns:` feeds the column count, any other one (fill:,
// align:, ...) is skipped whole
function scanNamedArgument(text, scan, identifier, from) {
  if (identifier !== 'columns') return skipToArgumentEnd(text, from);
  const parsed = parseColumnsArgument(text, from);
  scan.columnsCount = parsed.count;
  return parsed.after;
}

// A call in cell position: table.header contributes its cells, the footer
// and the line decorations are skipped whole. Any other call - table.cell
// above all, whose spans would shift every following column - degrades the
// table: its cells still cannot define items, but no keyword entries are read
// from it.
function scanNestedCall(text, scan, identifier, open) {
  if (identifier === 'table.header') {
    const collected = collectCells(text, open);
    scan.header = collected.cells;
    return collected.after;
  }
  if (identifier !== 'table.footer' && !CELL_FREE_CALLS.has(identifier)) scan.degraded = true;
  let i = skipBalanced(text, open);
  // a call may carry its content as a trailing block (table.cell(...)[...])
  while (text[i] === ' ' || text[i] === '\t') i++;
  if (text[i] === '[') i = readContentBlock(text, i).after;
  return i;
}

// one argument-position token of a `#table(...)` call; returns the index
// after it
function scanTableToken(text, scan, i) {
  const taken = takeCellToken(text, i, scan.cells);
  if (taken !== null) return taken;
  IDENTIFIER_RE.lastIndex = i;
  const identifier = IDENTIFIER_RE.exec(text)?.[0];
  if (!identifier) return i + 1;
  let after = i + identifier.length;
  while (text[after] === ' ' || text[after] === '\t') after++;
  if (text[after] === ':' && !identifier.includes('.')) {
    return scanNamedArgument(text, scan, identifier, after + 1);
  }
  if (text[after] === '(') return scanNestedCall(text, scan, identifier, after);
  return after;
}

// scan one `#table(...)` call from its opening paren: the top-level
// content-block cells, the `table.header(...)` cells, and the `columns:`
// count
function scanTableCall(text, open) {
  const scan = { cells: [], header: null, columnsCount: null, degraded: false };
  let i = open + 1;
  while (i < text.length && text[i] !== ')') i = scanTableToken(text, scan, i);
  return { end: Math.min(i, text.length - 1), ...scan };
}

// a cell's text, whitespace-collapsed, located at its first non-blank
// character (or the block start when empty), the way an item column points at
// its backtick
function makeCell(text, block, locate) {
  const content = text.slice(block.contentStart, block.contentEnd);
  const value = content.replace(/\s+/g, ' ').trim();
  const offset = content.search(/\S/);
  const position = locate(block.contentStart + Math.max(offset, 0));
  return { value, line: position.line, character: position.character };
}

/*
 * Digest one scanned call into the table record the body parser consumes.
 * The column count comes from `columns:`, or from the table.header cell count
 * when the argument is missing. Without a count - or degraded by a call whose
 * spans could shift columns - the tracer cannot tell which cell sits in which
 * column: such a table reads as no entries and flags nothing, but
 * keyword-named cells reveal the intent, so their entries are not dropped
 * silently. The header row is table.header's cells, or the first row of plain
 * cells. A column headed by a bare keyword contributes each row's non-empty
 * cell as one entry; every other cell is checked against the definition
 * shape - an item cannot be defined inside a table.
 */
function tableRecord(call, start, end, text, locate, file, problems) {
  const count = call.columnsCount ?? (call.header ? call.header.length : null);
  const usable = !call.degraded && Number.isInteger(count) && count > 0;
  const allCells = call.cells.map((block) => makeCell(text, block, locate));
  let headerCells = [];
  if (call.header) headerCells = call.header.map((block) => makeCell(text, block, locate));
  else if (usable) headerCells = allCells.slice(0, count);
  if (!usable) {
    const keywords = [
      ...new Set([...headerCells, ...allCells].filter((cell) => isKeyword(cell.value)).map((cell) => cell.value)),
    ];
    if (keywords.length > 0) {
      const reason = call.degraded
        ? 'a table.cell or unrecognized call makes the columns ambiguous'
        : 'the column count is unknown';
      problems.push({
        file,
        line: start.line,
        character: start.character,
        message: `a ${keywords.join('/')} column in a table the tracer cannot read (${reason}); the table contributes no entries`,
      });
    }
    return { end, hasKeywordColumns: false, keywordCells: [] };
  }
  const bodyCells = call.header ? allCells : allCells.slice(count);
  const keywordByColumn = new Map();
  headerCells.forEach((cell, index) => {
    if (isKeyword(cell.value)) keywordByColumn.set(index % count, cell.value);
  });
  const flagDefinition = (cell) => {
    const definition = cell.value.match(DEFINITION_RE);
    if (definition) {
      problems.push({
        file,
        line: cell.line,
        character: cell.character,
        message: `item ${makeId(definition[1], definition[2], definition[3], definition[4])} defined inside a table; a table cell is not an item definition`,
      });
    }
  };
  const keywordCells = [];
  headerCells.forEach((cell, index) => {
    if (!keywordByColumn.has(index % count)) flagDefinition(cell);
  });
  bodyCells.forEach((cell, index) => {
    const keyword = keywordByColumn.get(index % count);
    if (keyword === undefined) flagDefinition(cell);
    else if (cell.value !== '') keywordCells.push({ keyword, ...cell });
  });
  return { end, hasKeywordColumns: keywordByColumn.size > 0, keywordCells };
}

// Mark every line belonging to a `#table(...)` call and digest each call into
// its record, keyed by the 0-based line the call starts on. Only a call
// opening a line (after optional indentation) is recognized.
function scanTables(lines, text, lineStarts, locate, file, problems) {
  const inTable = new Array(lines.length).fill(false);
  const tables = new Map();
  let j = 0;
  while (j < lines.length) {
    const start = lines[j].match(TABLE_LINE_RE);
    if (!start) {
      j++;
      continue;
    }
    const call = scanTableCall(text, lineStarts[j] + start[0].length - 1);
    const endLine = locate(call.end).line - 1; // back to 0-based
    for (let k = j; k <= endLine; k++) inTable[k] = true;
    const startPosition = { line: j + 1, character: firstNonBlankColumn(lines[j]) };
    tables.set(j, tableRecord(call, startPosition, endLine, text, locate, file, problems));
    j = endLine + 1;
  }
  return { inTable, tables };
}

// map an absolute index in `text` to its 1-based { line, character }
function makeLocator(lineStarts) {
  return (index) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, character: index - lineStarts[low] + 1 };
  };
}

// A keyword table's cells feed the item, and the table terminates the
// description like a keyword line does; an informative table is display
// material either way, never description. Returns whether the description is
// terminated.
function applyKeywordTable(table, item, context) {
  for (const cell of table.keywordCells) {
    applyTypstKeyword(item, cell.keyword, [cell], context.file, context.problems, `the ${cell.keyword} column of ${item.id}`);
  }
  return table.hasKeywordColumns;
}

// A body line that is neither keyword material nor a forward: description
// text, closed by the first blank line under it - a blank line directly under
// the ID (before the description) is allowed, and anything after the
// terminating one is informative text. Returns whether the description is
// terminated.
function takeDescriptionLine(line, item, descriptionDone) {
  if (line.trim() === '') return descriptionDone || item.description.length > 0;
  if (!descriptionDone) item.description.push(line.trim());
  return descriptionDone;
}

// consume the item's body (description, keyword lines and keyword tables)
// starting at `start`; returns the index of the first line after the item
function parseItemBody(context, start, item) {
  const { lines, tables, inTable, file, problems, forwards } = context;
  let j = start;
  let descriptionDone = false;
  while (j < lines.length && !isBoundary(lines, inTable, j)) {
    const line = lines[j];
    const table = tables.get(j);
    if (table) {
      if (applyKeywordTable(table, item, context)) descriptionDone = true;
      j = table.end + 1;
      continue;
    }
    if (takeForward(line, file, j, problems, forwards)) {
      j++;
      continue;
    }
    const keywordMatch = line.match(KEYWORD_RE);
    if (keywordMatch) {
      descriptionDone = true;
      const collected = keywordEntries(lines, j, keywordMatch[2], BULLET_RE);
      applyTypstKeyword(
        item,
        keywordMatch[1],
        collected.entries,
        file,
        problems,
        `${keywordMatch[1]}: list of ${item.id}`,
      );
      j = collected.j;
    } else {
      descriptionDone = takeDescriptionLine(line, item, descriptionDone);
    }
    j++;
  }
  return j;
}

export function parseTypst(file, text, problems, forwards = []) {
  const masked = maskCommentsAndRawBlocks(text);
  const lines = masked.split(/\r?\n/);
  const lineStarts = [0];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '\n') lineStarts.push(i + 1);
  }
  const locate = makeLocator(lineStarts);
  const { inTable, tables } = scanTables(lines, masked, lineStarts, locate, file, problems);
  const context = { lines, tables, inTable, file, problems, forwards };
  const items = [];

  let i = 0;
  while (i < lines.length) {
    const table = tables.get(i);
    if (table) {
      // a table outside every item body: its cells were already checked
      // against the definition shape; its keyword entries serve no item
      i = table.end + 1;
      continue;
    }
    if (takeForward(lines[i], file, i, problems, forwards)) {
      i++;
      continue;
    }
    const definition = lines[i].match(DEFINITION_RE);
    if (!definition) {
      i++;
      continue;
    }
    const item = newItem(
      makeId(definition[1], definition[2], definition[3], definition[4]),
      'spec',
      file,
      i + 1,
      firstNonBlankColumn(lines[i]),
    );
    item.title = titleAbove(lines, inTable, i);
    i = parseItemBody(context, i + 1, item);
    items.push(item);
  }
  return items;
}
