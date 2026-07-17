/*
 * Markdown parser (.md, .markdown):
 *   - An item is defined by a line containing only its ID in backticks: `req:auth/login#1`
 *   - Title: the heading directly above the ID (only blank lines in between),
 *     either ATX (#...) or setext (a paragraph line underlined with === / ---).
 *   - Description: the lines following the ID (one blank line directly under the
 *     ID is allowed) up to the next blank line.
 *   - Keywords "Needs:", "Covers:", "Tags:" - inline comma-separated, as a
 *     bullet list on the following lines, or as a table column whose header
 *     cell is the bare keyword name. Needs/Covers list full, explicit IDs.
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
// (a run whose neighbour above is a bullet, not a paragraph). Keyword lines
// and forwarding lines are structural to the tracer, never heading text -
// otherwise one line would feed both a keyword and the next item's title.
// The same holds for a pipe-carrying line: it reads as a table row (the row
// wins over the heading), so a row directly above an underline stays in its
// table instead of vanishing into the next item's title. This mirrors the
// underline side, where a pipe-carrying run is never a setext underline.
function isParagraphLine(line) {
  return (
    line.trim() !== '' &&
    !HEADING_RE.test(line) &&
    !DEFINITION_RE.test(line) &&
    !BULLET_RE.test(line) &&
    !SETEXT_UNDERLINE_RE.test(line) &&
    !KEYWORD_RE.test(line) &&
    !FORWARD_LINE_RE.test(line) &&
    !line.includes('|')
  );
}

// `titleLine` directly followed by `underlineLine` forms a setext heading
// exactly when the underline is a valid =/- run and the line above it is a
// paragraph. titleAbove and isBoundary share this predicate, so title
// recognition and body termination agree by construction.
const isSetextHeading = (titleLine, underlineLine) =>
  underlineLine !== undefined &&
  SETEXT_UNDERLINE_RE.test(underlineLine) &&
  isParagraphLine(titleLine);

// An item's body ends at an ID definition line, an ATX heading, or a setext
// heading - the latter even without a blank line in between, because the
// rendered document shows a heading there, not more of the previous paragraph.
const isBoundary = (lines, j) =>
  DEFINITION_RE.test(lines[j]) || HEADING_RE.test(lines[j]) || isSetextHeading(lines[j], lines[j + 1]);

function titleAbove(lines, definitionIndex) {
  for (let k = definitionIndex - 1; k >= 0; k--) {
    const line = lines[k];
    if (line.trim() === '') continue; // blank lines between heading and ID are fine
    const heading = line.match(HEADING_RE);
    if (heading) return heading[2]; // ATX heading (#...)
    // A setext underline turns the paragraph line directly above it into the
    // title; without such a line the run of =/- is not a heading.
    if (k > 0 && isSetextHeading(lines[k - 1], line)) {
      return lines[k - 1].trim();
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

// a table whose header row contains keyword cells ("Needs", "Covers", "Tags")
// contributes each row's cell in those columns as one entry; empty cells and
// all other columns are ignored. Returns the index of the last consumed line,
// or null if `lines[j]` does not start such a table.
function takeKeywordTable(lines, j, item, file, problems) {
  const header = rowCells(lines[j]);
  if (!header) return null;
  const columns = [];
  header.forEach((cell, col) => {
    if (cell === 'Needs' || cell === 'Covers' || cell === 'Tags') columns.push([col, cell]);
  });
  if (columns.length === 0) return null;
  const delimiter = j + 1 < lines.length ? rowCells(lines[j + 1]) : null;
  // GFM: a delimiter row with a deviating cell count degrades the whole
  // block to prose, so the tracer must not read it as a table either
  if (delimiter?.length !== header.length || !delimiter.every((cell) => DELIMITER_CELL_RE.test(cell))) return null;
  j++;
  // like GFM, the table ends at a new block-level element (here: a heading
  // or an item definition). An ATX heading ends it even when it contains a
  // pipe; a setext heading cannot, because a pipe-carrying line above an
  // underline is a row, and a pipe-less line ends the table by itself.
  while (j + 1 < lines.length && !isBoundary(lines, j + 1)) {
    const cells = rowCells(lines[j + 1]);
    if (!cells) break;
    j++;
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
function parseItemBody(lines, start, item, file, problems, forwards) {
  let j = start;
  let descriptionDone = false;
  while (j < lines.length && !isBoundary(lines, j)) {
    const line = lines[j];
    if (takeForward(line, file, j, forwards)) {
      j++;
      continue;
    }
    const keywordMatch = line.match(KEYWORD_RE);
    const tableEnd = keywordMatch ? null : takeKeywordTable(lines, j, item, file, problems);
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
  const items = [];

  let i = 0;
  while (i < lines.length) {
    if (takeForward(lines[i], file, i, forwards)) {
      i++;
      continue;
    }
    const definition = lines[i].match(DEFINITION_RE);
    if (!definition) {
      i++;
      continue;
    }
    const item = newItem(makeId(definition[1], definition[2], definition[3], definition[4]), 'markdown', file, i + 1);
    item.title = titleAbove(lines, i);
    i = parseItemBody(lines, i + 1, item, file, problems, forwards);
    items.push(item);
  }
  return items;
}
