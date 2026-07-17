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
 *     cell is the bare keyword name. Needs/Covers list full, explicit IDs.
 *   - A table cannot define an item: a cell holding nothing but a backticked
 *     ID is reported as a problem, not read as a definition. Nor can a setext
 *     heading: an ID line with no blank line below it folds into the heading
 *     of the following paragraph (CommonMark) and is reported the same way.
 *   - A line containing only `[<id> --> <id>]` (optionally backticked) forwards
 *     the first item's coverage obligation to the second (spaces optional).
 */

import { FORWARD_SRC, ID_SRC, makeForward, makeId, parseIdEntry, parseNeedEntry, newItem } from './ids.mjs';

const DEFINITION_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
const HEADING_RE = /^(#{1,6})\s+(\S(?:.*\S)?)\s*$/;
// Setext heading underline: a run of only `=` (level 1) or only `-` (level 2),
// with up to three leading spaces and optional trailing whitespace per
// CommonMark. A row carrying pipes (a table delimiter) never matches.
const SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const KEYWORD_RE = /^(Needs|Covers|Tags):\s*((?:\S.*)?)$/;
const BULLET_RE = /^\s*[-*+]\s+(\S(?:.*\S)?)\s*$/;
const DELIMITER_CELL_RE = /^:?-+:?$/;
// group 1 is the optional backtick; the \1 backreference keeps it balanced,
// so the two ID captures start at group 2
const FORWARD_LINE_RE = new RegExp(String.raw`^\s*(\`?)${FORWARD_SRC}\1\s*$`);

// a line that is only a forwarding tag pushes a forward and is otherwise skipped
function takeForward(line, file, lineIndex, forwards) {
  const forward = line.match(FORWARD_LINE_RE);
  if (forward) forwards.push(makeForward(forward, 2, file, lineIndex + 1));
  return !!forward;
}

// A setext underline forms a heading only when a paragraph line sits directly
// above it (CommonMark). That excludes the lookalikes the issue names: a
// thematic break (blank line above the run), a table delimiter row (its run
// carries pipes, so SETEXT_UNDERLINE_RE never matches it), and a bullet list
// (a run whose neighbour above is a bullet, not a paragraph). Keyword lines,
// forwarding lines, and ID lines are paragraph text like any other: folded
// into a setext title they serve the heading, not their usual role - exactly
// as `# Covers: ...` is a heading, not a keyword. An ID line so folded cannot
// also define an item; parseMarkdown reports it and creates no item.
// A pipe alone does not disqualify a line: as in GFM, a pipe-carrying
// paragraph above an underline is a heading with the pipe in its text. Only
// membership in an actual table (header plus delimiter row) rules a line
// out, and that is context, not shape - see isParagraphAt.
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

// A paragraph line opens a setext heading when the run of paragraph lines it
// starts ends directly at an underline - CommonMark folds the whole run into
// the heading, so every line of the run belongs to the title, not to the
// body above it.
function opensSetextHeading(lines, inTable, j) {
  if (!isParagraphAt(lines, inTable, j)) return false;
  let k = j;
  while (k + 1 < lines.length && isParagraphAt(lines, inTable, k + 1)) k++;
  return isSetextHeading(lines, inTable, k);
}

// An item's body ends at an ID definition line, an ATX heading, or a setext
// heading - the latter even without a blank line in between, because the
// rendered document shows a heading there, not more of the previous paragraph.
// The heading claims its whole paragraph, so the body already ends at the
// first line of a run that folds into a heading.
const isBoundary = (lines, inTable, j) =>
  DEFINITION_RE.test(lines[j]) || HEADING_RE.test(lines[j]) || opensSetextHeading(lines, inTable, j);

// Fold the paragraph run ending at `lastIndex` into one title. Lines are
// joined exactly as written: a line ending in two or more spaces contributes
// a hard line break (a newline in the title), any other line-end whitespace
// is kept as the separator it spells. Only the outer edges of the heading
// are trimmed.
function foldSetextTitle(lines, inTable, lastIndex) {
  let first = lastIndex;
  while (first > 0 && isParagraphAt(lines, inTable, first - 1)) first--;
  let title = '';
  for (let k = first; k <= lastIndex; k++) {
    let line = lines[k];
    if (k === first) line = line.trimStart();
    if (k === lastIndex) line = line.trimEnd();
    title += / {2}$/.test(line) ? line.trimEnd() + '\n' : line;
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
// following lines; returns the entries and the index of the last consumed line
function keywordEntries(lines, j, inline) {
  if (inline.trim() !== '') {
    return { entries: inline.split(',').map((s) => s.trim()).filter(Boolean), j };
  }
  const entries = [];
  while (j + 1 < lines.length) {
    const bullet = lines[j + 1].match(BULLET_RE);
    if (!bullet) break;
    entries.push(bullet[1].trim());
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

// Like GFM, a table runs to the first blank line or block-level element (an
// ATX heading or an item definition - both end it even when they carry a
// pipe). Any other pipe-less line ends the table too, except a =/- run: GFM
// swallows a `===` run as a single-cell row, and the tracer deliberately
// swallows `---` the same way (GFM reads a thematic break there), so neither
// run can end a table - or underline a heading.
const continuesTable = (line) =>
  line.trim() !== '' &&
  !HEADING_RE.test(line) &&
  !DEFINITION_RE.test(line) &&
  (line.includes('|') || SETEXT_UNDERLINE_RE.test(line));

// cells of a row inside a table: a swallowed pipe-less line (a =/- run) is a
// single-cell row - its text fills the first column
const rowCellsInTable = (line) => rowCells(line) ?? [line.trim()];

const isKeywordCell = (cell) => cell === 'Needs' || cell === 'Covers' || cell === 'Tags';

// Mark every line belonging to a table - header, delimiter, and rows - so
// heading detection can rule them out: a table row above an underline stays
// a row. While scanning, flag definition-shaped cells: an item cannot be
// defined inside a table, so a cell holding nothing but a backticked ID is
// reported as a problem instead of silently defining nothing. Keyword
// columns are exempt - their cells are entries (optionally backticked),
// not definitions.
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
      rowCellsInTable(lines[k]).forEach((cell, col) => {
        const definition = keywordColumns.has(col) ? null : cell.match(DEFINITION_RE);
        if (definition)
          problems.push({
            file,
            line: k + 1,
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
    for (const [col, keyword] of columns) {
      if (cells[col]) applyKeyword(item, keyword, [cells[col]], file, j + 1, problems);
    }
  }
  return j;
}

function applyKeyword(item, keyword, entries, file, keywordLine, problems) {
  if (keyword === 'Tags') {
    item.tags.push(...entries);
    return;
  }
  const target = keyword === 'Needs' ? 'needs' : 'covers';
  // Needs may reference a wildcard revision (2.x); Covers must be concrete.
  const parse = keyword === 'Needs' ? parseNeedEntry : parseIdEntry;
  for (const entry of entries) {
    const id = parse(entry);
    if (id) item[target].push(id);
    else
      problems.push({
        file,
        line: keywordLine,
        message: `invalid ID "${entry}" in ${keyword}: list of ${item.id}`,
      });
  }
}

// consume the item's body (description and keyword lines) starting at `start`;
// returns the index of the first line after the item
function parseItemBody(lines, inTable, start, item, file, problems, forwards) {
  let j = start;
  let descriptionDone = false;
  while (j < lines.length && !isBoundary(lines, inTable, j)) {
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
      applyKeyword(item, keywordMatch[1], collected.entries, file, j + 1, problems);
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
  const items = [];

  let i = 0;
  while (i < lines.length) {
    const startsHeading = opensSetextHeading(lines, inTable, i);
    // a forwarding line serving a setext title is heading text, not a forward
    if (!startsHeading && takeForward(lines[i], file, i, forwards)) {
      i++;
      continue;
    }
    const definition = lines[i].match(DEFINITION_RE);
    if (definition && startsHeading) {
      // The ID line has no blank line below it, so its paragraph folds into a
      // setext heading (CommonMark): the ID is heading text, not a standalone
      // block. Report it - an item must live on its own line, inside no
      // heading - and create no item; the folded text titles the item below.
      problems.push({
        file,
        line: i + 1,
        message: `item ${makeId(definition[1], definition[2], definition[3], definition[4])} defined inside a setext heading; a heading is not an item definition`,
      });
      i++;
      continue;
    }
    if (!definition) {
      i++;
      continue;
    }
    const item = newItem(makeId(definition[1], definition[2], definition[3], definition[4]), 'markdown', file, i + 1);
    item.title = titleAbove(lines, inTable, i);
    i = parseItemBody(lines, inTable, i + 1, item, file, problems, forwards);
    items.push(item);
  }
  return items;
}
