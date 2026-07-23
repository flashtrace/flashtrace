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
import { KEYWORDS, applyKeyword, isKeyword } from './spec-items.mjs';

const DEFINITION_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
// A Typst heading: a `=` run, whitespace, then text. Any depth - Typst does
// not cap heading levels - and indentation is allowed, as Typst ignores
// leading whitespace before markup elements.
const HEADING_RE = /^\s*=+\s+(\S(?:.*\S)?)\s*$/;
// a trailing <label> attaches a Typst label to its heading; it is metadata
const LABEL_RE = /\s*<[A-Za-z_][A-Za-z0-9_.:-]*>$/;
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
function maskCommentsAndRawBlocks(text) {
  const out = text.split('');
  const blank = (index) => {
    if (out[index] !== '\n' && out[index] !== '\r') out[index] = ' ';
  };
  let blockCommentDepth = 0;
  let rawFence = 0; // length of the backtick run that opened a raw block
  let inRawSpan = false; // inside a single-backtick raw span, one line only
  let i = 0;
  while (i < text.length) {
    const character = text[i];
    if (character === '\n') {
      inRawSpan = false;
      i++;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (character === '/' && text[i + 1] === '*') blockCommentDepth++;
      else if (character === '*' && text[i + 1] === '/') blockCommentDepth--;
      else {
        blank(i);
        i++;
        continue;
      }
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }
    if (rawFence > 0 || (character === '`' && !inRawSpan)) {
      let run = 0;
      while (text[i + run] === '`') run++;
      if (rawFence > 0) {
        // inside a raw block everything is display material
        if (run === 0) {
          blank(i);
          i++;
          continue;
        }
        for (let k = 0; k < run; k++) blank(i + k);
        if (run >= rawFence) rawFence = 0;
      } else if (run >= 3) {
        for (let k = 0; k < run; k++) blank(i + k);
        rawFence = run;
      } else if (run === 1) {
        inRawSpan = true; // a `` pair is an empty raw span and toggles nothing
      }
      i += Math.max(run, 1);
      continue;
    }
    if (character === '`') {
      inRawSpan = false;
      i++;
      continue;
    }
    if (!inRawSpan && character === '/' && text[i + 1] === '/') {
      // `scheme://` is a link, not a comment
      if (text[i - 1] === ':' && /[A-Za-z0-9]/.test(text[i - 2] ?? '')) {
        i += 2;
        continue;
      }
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        blank(i);
        i++;
      }
      continue;
    }
    if (!inRawSpan && character === '/' && text[i + 1] === '*') {
      blockCommentDepth = 1;
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }
    i++;
  }
  return out.join('');
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

// entries of a keyword line: inline comma-separated, or a list on the
// following lines. Each entry carries its own source location (the column of
// its first character, and - for a list - the line it sits on rather than the
// keyword line), so an invalid-ID problem points at the entry itself.
// Returns the entries and the index of the last consumed line.
function keywordEntries(lines, j, inline) {
  if (inline.trim() !== '') {
    // inline is the `$`-anchored tail of lines[j], so it begins at this offset
    const inlineStart = lines[j].length - inline.length;
    const entries = [];
    let pos = 0;
    for (const part of inline.split(',')) {
      const value = part.trim();
      if (value) {
        const leading = part.length - part.trimStart().length;
        entries.push({ value, line: j + 1, character: inlineStart + pos + leading + 1 });
      }
      pos += part.length + 1; // + 1 for the consumed comma
    }
    return { entries, j };
  }
  const entries = [];
  while (j + 1 < lines.length) {
    const bullet = lines[j + 1].match(BULLET_RE);
    if (!bullet) break;
    entries.push({ value: bullet[1].trim(), line: j + 2, character: lines[j + 1].indexOf(bullet[1]) + 1 });
    j++;
  }
  return { entries, j };
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

// the top-level content-block cells of a call, e.g. of `table.header(...)`
function collectCells(text, open) {
  const cells = [];
  let i = open + 1;
  while (i < text.length && text[i] !== ')') {
    const character = text[i];
    if (character === '[') {
      const block = readContentBlock(text, i);
      cells.push(block);
      i = block.after;
      continue;
    }
    if (character === '"') {
      i = skipString(text, i);
      continue;
    }
    if (character === '(') {
      i = skipBalanced(text, i);
      continue;
    }
    i++;
  }
  return { cells, after: i + 1 };
}

// helper calls that draw lines and carry no cell, safe to skip outright
const CELL_FREE_CALLS = new Set(['table.hline', 'table.vline']);

/*
 * Scan one `#table(...)` call from its opening paren: the top-level
 * content-block cells, the `table.header(...)` cells, and the `columns:`
 * count. Other named arguments (fill:, align:, ...) are skipped whole, as are
 * table.hline / table.vline decorations and the table.footer. Any other call
 * in cell position - table.cell above all, whose spans would shift every
 * following column - degrades the table: its cells still cannot define items,
 * but no keyword entries are read from it.
 */
function scanTableCall(text, open) {
  const cells = [];
  let header = null;
  let columnsCount = null;
  let degraded = false;
  let i = open + 1;
  while (i < text.length && text[i] !== ')') {
    const character = text[i];
    if (character === '[') {
      const block = readContentBlock(text, i);
      cells.push(block);
      i = block.after;
      continue;
    }
    if (character === '"') {
      i = skipString(text, i);
      continue;
    }
    if (character === '(') {
      i = skipBalanced(text, i);
      continue;
    }
    IDENTIFIER_RE.lastIndex = i;
    const identifier = IDENTIFIER_RE.exec(text)?.[0];
    if (!identifier) {
      i++;
      continue;
    }
    let after = i + identifier.length;
    while (text[after] === ' ' || text[after] === '\t') after++;
    if (text[after] === ':' && !identifier.includes('.')) {
      if (identifier === 'columns') {
        const parsed = parseColumnsArgument(text, after + 1);
        columnsCount = parsed.count;
        i = parsed.after;
      } else {
        i = skipToArgumentEnd(text, after + 1);
      }
      continue;
    }
    if (text[after] === '(') {
      if (identifier === 'table.header') {
        const collected = collectCells(text, after);
        header = collected.cells;
        i = collected.after;
        continue;
      }
      if (identifier !== 'table.footer' && !CELL_FREE_CALLS.has(identifier)) degraded = true;
      i = skipBalanced(text, after);
      // a call may carry its content as a trailing block (table.cell(...)[...])
      while (text[i] === ' ' || text[i] === '\t') i++;
      if (text[i] === '[') i = readContentBlock(text, i).after;
      continue;
    }
    i = after;
  }
  return { end: Math.min(i, text.length - 1), cells, header, columnsCount, degraded };
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
  const headerCells = call.header
    ? call.header.map((block) => makeCell(text, block, locate))
    : usable
      ? allCells.slice(0, count)
      : [];
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
  for (let j = 0; j < lines.length; j++) {
    const start = lines[j].match(TABLE_LINE_RE);
    if (!start) continue;
    const call = scanTableCall(text, lineStarts[j] + start[0].length - 1);
    const endLine = locate(call.end).line - 1; // back to 0-based
    for (let k = j; k <= endLine; k++) inTable[k] = true;
    const startPosition = { line: j + 1, character: firstNonBlankColumn(lines[j]) };
    tables.set(j, tableRecord(call, startPosition, endLine, text, locate, file, problems));
    j = endLine;
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

// consume the item's body (description, keyword lines and keyword tables)
// starting at `start`; returns the index of the first line after the item
function parseItemBody(lines, tables, inTable, start, item, file, problems, forwards) {
  let j = start;
  let descriptionDone = false;
  while (j < lines.length && !isBoundary(lines, inTable, j)) {
    const line = lines[j];
    const table = tables.get(j);
    if (table) {
      // a keyword table terminates the description like a keyword line; an
      // informative table is display material either way, never description
      if (table.hasKeywordColumns) descriptionDone = true;
      for (const cell of table.keywordCells) {
        applyTypstKeyword(item, cell.keyword, [cell], file, problems, `the ${cell.keyword} column of ${item.id}`);
      }
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
      const collected = keywordEntries(lines, j, keywordMatch[2]);
      applyTypstKeyword(
        item,
        keywordMatch[1],
        collected.entries,
        file,
        problems,
        `${keywordMatch[1]}: list of ${item.id}`,
      );
      j = collected.j;
    } else if (line.trim() === '') {
      if (item.description.length > 0) descriptionDone = true;
      // a blank line directly under the ID (before the description) is allowed
    } else if (!descriptionDone) {
      item.description.push(line.trim());
    }
    // anything after the description's terminating blank line is informative text
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
    i = parseItemBody(lines, tables, inTable, i + 1, item, file, problems, forwards);
    items.push(item);
  }
  return items;
}
