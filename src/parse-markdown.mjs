/*
 * Markdown parser (.md, .markdown):
 *   - An item is defined by a line containing only its ID in backticks: `req:auth/login#1`
 *   - Title: the heading directly above the ID (only blank lines in between),
 *     either ATX (#...) or setext (a paragraph underlined with === / ---; the
 *     whole paragraph folds into the title, as in CommonMark).
 *   - Description: the lines following the ID (one blank line directly under the
 *     ID is allowed) up to the next blank line.
 *   - Keywords "Needs:", "Covers:", "Tags:" - inline comma-separated, as a
 *     bullet list on the following lines, or as a table column whose header
 *     cell is the bare keyword name. A Needs or Covers entry is a reference:
 *     a full ID, or a short form (impl, impl:name, impl#2) whose omitted
 *     [group/]name and revision are taken from the item stating it. Needs may
 *     demand a wildcard revision; Covers stay concrete.
 *   - Neither a table cell nor a setext heading can define an item: a
 *     backticked ID in a table cell, or an ID line with no blank line below it
 *     (which folds into the following heading), is reported, not defined.
 *   - A line containing only `[<id> --> <id>]` (optionally backticked) forwards
 *     the first item's coverage obligation to the second (spaces optional).
 */

import { FORWARD_SRC, ID_SRC, makeForward, makeId, parseCoverEntry, parseNeedEntry, newItem } from './ids.mjs';

const DEFINITION_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
const HEADING_RE = /^(#{1,6})\s+(\S(?:.*\S)?)\s*$/;
// Setext heading underline: a run of only `=` (level 1) or only `-` (level 2),
// with up to three leading spaces and optional trailing whitespace per
// CommonMark. A row carrying pipes (a table delimiter) never matches.
const SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
// Thematic break, dash-spelled. Only this shape collides with a table row or
// setext underline, and it only matters inside a table - under a paragraph the
// setext underline still wins (CommonMark).
const THEMATIC_BREAK_RE = /^ {0,3}-{3,}[ \t]*$/;
const KEYWORD_RE = /^(Needs|Covers|Tags):\s*((?:\S.*)?)$/;
const BULLET_RE = /^\s*[-*+]\s+(\S(?:.*\S)?)\s*$/;
const DELIMITER_CELL_RE = /^:?-+:?$/;
// group 1 is the optional backtick; the \1 backreference keeps it balanced,
// so the two ID captures start at group 2
const FORWARD_LINE_RE = new RegExp(String.raw`^\s*(\`?)${FORWARD_SRC}\1\s*$`);

// 1-based column of the first non-blank character of a line - the construct a
// location points at (the backtick of an ID line, the opener of a forwarding
// line). Never called on a blank line.
const firstNonBlankColumn = (line) => line.search(/\S/) + 1;

// a line that is only a forwarding tag pushes a forward and is otherwise skipped
function takeForward(line, file, lineIndex, forwards) {
  const forward = line.match(FORWARD_LINE_RE);
  if (forward) forwards.push(makeForward(forward, 2, file, lineIndex + 1, firstNonBlankColumn(line)));
  return !!forward;
}

// A setext underline forms a heading only when a paragraph line sits directly
// above it (CommonMark). That excludes the lookalikes the issue names: a
// thematic break (blank line above the run), a table delimiter row (its run
// carries pipes, so SETEXT_UNDERLINE_RE never matches it), and a bullet list
// (a run whose neighbour above is a bullet, not a paragraph). Keyword,
// forwarding, and ID lines are paragraph text too: folded into a setext title
// they serve the heading, not their usual role (as `# Covers: ...` is a
// heading, not a keyword), and a so-folded ID defines no item. A pipe alone
// does not disqualify a line either - only membership in an actual table
// does, which is context, not shape (see isParagraphAt).
function isParagraphLine(line) {
  return (
    line.trim() !== '' &&
    !HEADING_RE.test(line) &&
    !BULLET_RE.test(line) &&
    !SETEXT_UNDERLINE_RE.test(line)
  );
}

// a paragraph line in document context: paragraph-shaped and not part of a
// table - a table row above an underline stays a row (see scanTables)
const isParagraphAt = (lines, inTable, j) => !inTable[j] && isParagraphLine(lines[j]);

// The line at `titleIndex` forms a setext heading with the line below it
// exactly when that line is a valid =/- run and `titleIndex` is a paragraph
// in context. titleAbove and isBoundary share this predicate, so title
// recognition and body termination agree by construction.
const isSetextHeading = (lines, inTable, titleIndex) =>
  titleIndex + 1 < lines.length &&
  SETEXT_UNDERLINE_RE.test(lines[titleIndex + 1]) &&
  isParagraphAt(lines, inTable, titleIndex);

// Mark every paragraph line that opens a setext heading: one whose run of
// paragraph lines ends directly at an underline - CommonMark folds the whole
// run into the heading, so every line in it belongs to the title, not to the
// body above it. Computed once per run rather than re-walked from each line,
// the way scanTables marks a whole table in one pass instead of re-scanning
// it from every row.
function scanSetextHeadings(lines, inTable) {
  const opensHeading = new Array(lines.length).fill(false);
  let j = 0;
  while (j < lines.length) {
    if (!isParagraphAt(lines, inTable, j)) {
      j++;
      continue;
    }
    const start = j;
    while (j + 1 < lines.length && isParagraphAt(lines, inTable, j + 1)) j++;
    if (isSetextHeading(lines, inTable, j)) opensHeading.fill(true, start, j + 1);
    j++;
  }
  return opensHeading;
}

// An item's body ends at an ID definition, an ATX heading, or a setext heading
// - the last even with no blank line between, since the heading claims its
// whole paragraph, so the body ends at the first line of the folding run. An ID
// line swallowed into a table is a row, not a definition, so it bounds nothing.
const isBoundary = (lines, inTable, opensHeading, j) =>
  (!inTable[j] && DEFINITION_RE.test(lines[j])) ||
  HEADING_RE.test(lines[j]) ||
  opensHeading[j];

// Fold the paragraph run ending at `lastIndex` into one title. Each line is
// trimmed and the lines are joined with a single space - the whitespace a
// renderer shows for a soft line break. A line ending in two or more spaces
// spells a hard line break (CommonMark) and joins with a newline instead.
function foldSetextTitle(lines, inTable, lastIndex) {
  let first = lastIndex;
  while (first > 0 && isParagraphAt(lines, inTable, first - 1)) first--;
  let title = '';
  for (let k = first; k <= lastIndex; k++) {
    title += lines[k].trim();
    if (k < lastIndex) title += / {2}$/.test(lines[k]) ? '\n' : ' ';
  }
  return title;
}

function titleAbove(lines, inTable, definitionIndex) {
  for (let k = definitionIndex - 1; k >= 0; k--) {
    const line = lines[k];
    if (line.trim() === '') continue; // blank lines between heading and ID are fine
    const heading = line.match(HEADING_RE);
    if (heading) return heading[2]; // ATX heading (#...)
    // A setext underline folds the paragraph directly above it into the
    // title; without a paragraph line above, the run of =/- is not a heading.
    if (k > 0 && isSetextHeading(lines, inTable, k - 1)) {
      return foldSetextTitle(lines, inTable, k - 1);
    }
    return null; // any other text directly above -> no title
  }
  return null;
}

// entries of a keyword line: inline comma-separated, or a bullet list on the
// following lines. Each entry carries its own source location (the column of
// its first character, and - for a bullet list - the line it sits on rather
// than the keyword line), so an invalid-ID problem points at the entry itself.
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

// cells of a `| a | b |` table row, or null; as in GFM, one leading and one
// trailing pipe are optional, but a row must contain at least one pipe
function rowCells(line) {
  let row = line.trim();
  if (!row.includes('|')) return null;
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

// 1-based columns of each cell's content, aligned one-to-one with the cells
// rowCellsInTable returns, so a cell-level problem can point at the offending
// cell the way an item column points at its backtick. Mirrors rowCells: it
// works on the trimmed row and one optional leading/trailing pipe, tracking the
// offset back into the original line. An empty cell reports its start column.
function rowCellColumns(line) {
  if (rowCells(line) === null) return [firstNonBlankColumn(line)];
  let base = line.length - line.trimStart().length; // index where the trim starts
  const trimmed = line.trim();
  let body = trimmed;
  if (body.startsWith('|')) {
    body = body.slice(1);
    base += 1;
  }
  if (body.endsWith('|')) body = body.slice(0, -1);
  const columns = [];
  let pos = 0;
  for (const part of body.split('|')) {
    const value = part.trim();
    const leading = value ? part.length - part.trimStart().length : 0;
    columns.push(base + pos + leading + 1);
    pos += part.length + 1; // + 1 for the consumed pipe
  }
  return columns;
}

// does `lines[j]` start a table: a pipe-carrying header row directly followed
// by a delimiter row with the same number of cells? GFM degrades a block
// whose delimiter row deviates in cell count to prose, so the tracer must
// not read it as a table either.
function tableStartsAt(lines, j) {
  const header = rowCells(lines[j]);
  if (!header) return false;
  const delimiter = j + 1 < lines.length ? rowCells(lines[j + 1]) : null;
  return delimiter?.length === header.length && delimiter.every((cell) => DELIMITER_CELL_RE.test(cell));
}

// Like GFM, a table runs to the first blank line or block-level element: an
// ATX heading, or a thematic break (a `---` run under a row is a break, so it
// ends the table as plain text). Any other pipe-less line ends it too, except
// those GFM swallows as single-cell rows: a `===` run, a dash run too short for
// a break (`-`, `--`), or an item-definition line - each fills the first
// column, so it ends nothing, underlines nothing, and defines nothing.
const continuesTable = (line) =>
  line.trim() !== '' &&
  !HEADING_RE.test(line) &&
  !THEMATIC_BREAK_RE.test(line) &&
  (line.includes('|') || SETEXT_UNDERLINE_RE.test(line) || DEFINITION_RE.test(line));

// cells of a row inside a table: a swallowed pipe-less line (a =/- run) is a
// single-cell row - its text fills the first column
const rowCellsInTable = (line) => rowCells(line) ?? [line.trim()];

const isKeywordCell = (cell) => cell === 'Needs' || cell === 'Covers' || cell === 'Tags';

// Mark every line belonging to a table so heading detection can rule them out:
// a table row above an underline stays a row. While scanning, flag a cell that
// holds nothing but a backticked ID - an item cannot be defined inside a table.
// Keyword columns are exempt: their cells are entries, not definitions.
function scanTables(lines, file, problems) {
  const inTable = new Array(lines.length).fill(false);
  let j = 0;
  while (j < lines.length) {
    if (!tableStartsAt(lines, j)) {
      j++;
      continue;
    }
    const keywordColumns = new Set();
    rowCells(lines[j]).forEach((cell, col) => {
      if (isKeywordCell(cell)) keywordColumns.add(col);
    });
    const start = j;
    let end = j + 1;
    while (end + 1 < lines.length && continuesTable(lines[end + 1])) end++;
    for (let k = start; k <= end; k++) {
      inTable[k] = true;
      if (k === start + 1) continue; // the delimiter row carries no content
      const columns = rowCellColumns(lines[k]);
      rowCellsInTable(lines[k]).forEach((cell, col) => {
        const definition = keywordColumns.has(col) ? null : cell.match(DEFINITION_RE);
        if (definition)
          problems.push({
            file,
            line: k + 1,
            character: columns[col],
            message: `item ${makeId(definition[1], definition[2], definition[3], definition[4])} defined inside a table; a table cell is not an item definition`,
          });
      });
    }
    j = end + 1;
  }
  return inTable;
}

// a table whose header row contains keyword cells ("Needs", "Covers", "Tags")
// contributes each row's cell in those columns as one entry; empty cells and
// all other columns are ignored. Returns the index of the last consumed line,
// or null if `lines[j]` is not the header of such a table. Only the line a
// scanned table starts at qualifies - a keyword-headed row inside a larger
// table is a row of that table, not a nested table of its own.
function takeKeywordTable(lines, inTable, j, item, file, problems) {
  if (!inTable[j] || (j > 0 && inTable[j - 1])) return null;
  const columns = [];
  rowCells(lines[j]).forEach((cell, col) => {
    if (isKeywordCell(cell)) columns.push([col, cell]);
  });
  if (columns.length === 0) return null;
  j++; // the delimiter row
  while (j + 1 < lines.length && inTable[j + 1]) {
    j++;
    const cells = rowCellsInTable(lines[j]);
    const cellColumns = rowCellColumns(lines[j]);
    for (const [col, keyword] of columns) {
      if (cells[col])
        applyKeyword(
          item,
          keyword,
          [{ value: cells[col], line: j + 1, character: cellColumns[col] }],
          file,
          problems,
          `the ${keyword} column of ${item.id}`,
        );
    }
  }
  return j;
}

// `source` names where the entries were read from - the keyword line's list
// or the table column the cell sits in - so a problem report points at the
// right spot. Each entry is a { value, line, character } record locating it in
// the source, so an invalid one is reported at its own position.
function applyKeyword(item, keyword, entries, file, problems, source) {
  if (keyword === 'Tags') {
    for (const entry of entries) item.tags.push(entry.value);
    return;
  }
  const target = keyword === 'Needs' ? 'needs' : 'covers';
  // Needs and Covers both accept the short form (impl, impl:name, impl#2),
  // completed from the item's own [group/]name and revision; Needs may demand
  // a wildcard revision, Covers stay concrete.
  const parse = keyword === 'Needs' ? parseNeedEntry : parseCoverEntry;
  for (const entry of entries) {
    const id = parse(entry.value, item.id);
    if (id) item[target].push(id);
    else
      problems.push({
        file,
        line: entry.line,
        character: entry.character,
        message: `invalid ID "${entry.value}" in ${source}`,
      });
  }
}

// consume the item's body (description and keyword lines) starting at `start`;
// returns the index of the first line after the item. `boundary` bundles the
// two precomputed per-line arrays isBoundary needs (inTable, opensHeading) so
// they thread through as one parameter instead of two.
function parseItemBody(lines, boundary, start, item, file, problems, forwards) {
  const { inTable, opensHeading } = boundary;
  let j = start;
  let descriptionDone = false;
  while (j < lines.length && !isBoundary(lines, inTable, opensHeading, j)) {
    const line = lines[j];
    if (takeForward(line, file, j, forwards)) {
      j++;
      continue;
    }
    const keywordMatch = line.match(KEYWORD_RE);
    const tableEnd = keywordMatch ? null : takeKeywordTable(lines, inTable, j, item, file, problems);
    if (keywordMatch) {
      descriptionDone = true;
      const collected = keywordEntries(lines, j, keywordMatch[2]);
      applyKeyword(
        item,
        keywordMatch[1],
        collected.entries,
        file,
        problems,
        `${keywordMatch[1]}: list of ${item.id}`,
      );
      j = collected.j;
    } else if (tableEnd !== null) {
      descriptionDone = true;
      j = tableEnd;
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

export function parseMarkdown(file, text, problems, forwards = []) {
  const lines = text.split(/\r?\n/);
  const inTable = scanTables(lines, file, problems);
  const opensHeading = scanSetextHeadings(lines, inTable);
  const boundary = { inTable, opensHeading };
  const items = [];

  let i = 0;
  while (i < lines.length) {
    const startsHeading = opensHeading[i];
    // a forwarding line serving a setext title is heading text, not a forward
    if (!startsHeading && takeForward(lines[i], file, i, forwards)) {
      i++;
      continue;
    }
    // an ID line swallowed into a table is a row (scanTables reports it
    // outside keyword columns), never a definition
    const definition = inTable[i] ? null : lines[i].match(DEFINITION_RE);
    if (definition && startsHeading) {
      // No blank line below the ID, so its paragraph folds into a setext
      // heading (CommonMark): the ID is heading text, not a definition. Report
      // it and create no item; the folded text titles the item below.
      problems.push({
        file,
        line: i + 1,
        character: firstNonBlankColumn(lines[i]),
        message: `item ${makeId(definition[1], definition[2], definition[3], definition[4])} defined inside a setext heading; a heading is not an item definition`,
      });
      i++;
      continue;
    }
    if (!definition) {
      i++;
      continue;
    }
    const item = newItem(makeId(definition[1], definition[2], definition[3], definition[4]), 'markdown', file, i + 1, firstNonBlankColumn(lines[i]));
    item.title = titleAbove(lines, inTable, i);
    i = parseItemBody(lines, boundary, i + 1, item, file, problems, forwards);
    items.push(item);
  }
  return items;
}
