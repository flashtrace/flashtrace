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

import { FORWARD_SRC, ID_SRC, NEED_ID_SRC, makeForward, makeId, parseIdEntry, parseNeedEntry, newItem } from './ids.mjs';

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
// an ID wrapped directly in backticks anywhere within a line; the revision may
// be a wildcard so informative references like `impl:auth#2.x` are found too.
// Group 1 is the full ID text as written.
const INLINE_ID_RE = new RegExp(String.raw`\`(${NEED_ID_SRC})\``, 'g');
// an ID line behind one or more blockquote markers: > `req:auth/login#1`
const BLOCKQUOTED_DEFINITION_RE = new RegExp(String.raw`^ {0,3}(?:> ?)+\s*\`${ID_SRC}\`\s*$`);

const isBoundary = (line) => DEFINITION_RE.test(line) || HEADING_RE.test(line);

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
// (a run whose neighbour above is a bullet, not a paragraph).
function isParagraphLine(line) {
  return (
    line.trim() !== '' &&
    !HEADING_RE.test(line) &&
    !DEFINITION_RE.test(line) &&
    !BULLET_RE.test(line) &&
    !SETEXT_UNDERLINE_RE.test(line)
  );
}

function titleAbove(lines, definitionIndex) {
  for (let k = definitionIndex - 1; k >= 0; k--) {
    const line = lines[k];
    if (line.trim() === '') continue; // blank lines between heading and ID are fine
    const heading = line.match(HEADING_RE);
    if (heading) return heading[2]; // ATX heading (#...)
    // A setext underline turns the paragraph line directly above it into the
    // title; without such a line the run of =/- is not a heading.
    if (SETEXT_UNDERLINE_RE.test(line) && k > 0 && isParagraphLine(lines[k - 1])) {
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

// do lines[j] (header row) and lines[j + 1] (delimiter row) open a GFM table?
// GFM: a delimiter row with a deviating cell count degrades the whole block
// to prose, so the tracer must not read it as a table either.
function opensTable(lines, j) {
  const header = rowCells(lines[j]);
  if (!header) return false;
  const delimiter = j + 1 < lines.length ? rowCells(lines[j + 1]) : null;
  return delimiter?.length === header.length && delimiter.every((cell) => DELIMITER_CELL_RE.test(cell));
}

// the [index, keyword] pairs of a header row's keyword cells
function keywordColumns(header) {
  const columns = [];
  header.forEach((cell, columnIndex) => {
    if (cell === 'Needs' || cell === 'Covers' || cell === 'Tags') columns.push([columnIndex, cell]);
  });
  return columns;
}

// a table whose header row contains keyword cells ("Needs", "Covers", "Tags")
// contributes each row's cell in those columns as one entry; empty cells and
// all other columns are ignored. Returns the index of the last consumed line,
// or null if `lines[j]` does not start such a table.
function takeKeywordTable(lines, j, item, file, problems) {
  const header = rowCells(lines[j]);
  if (!header) return null;
  const columns = keywordColumns(header);
  if (columns.length === 0 || !opensTable(lines, j)) return null;
  j++;
  // like GFM, the table ends at a new block-level element (here: a heading
  // or an item definition), even when that line contains a pipe
  while (j + 1 < lines.length && !isBoundary(lines[j + 1])) {
    const cells = rowCells(lines[j + 1]);
    if (!cells) break;
    j++;
    for (const [columnIndex, keyword] of columns) {
      if (cells[columnIndex]) applyKeyword(item, keyword, [cells[columnIndex]], file, j + 1, problems);
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
        severity: 'error',
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
  while (j < lines.length && !isBoundary(lines[j])) {
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

/*
 * Item location diagnostics.
 *
 * Guiding rule: an ID line is only cleanly placed where the rendered GFM page
 * would show it as a paragraph of its own. Items in other locations are still
 * created exactly as before - never suppressed - but a problem records the
 * disagreement:
 *   - error:   the rendered page absorbs or repurposes the ID line (table
 *              row, paragraph continuation, setext heading text), so the page
 *              and the tracer disagree about what the line is.
 *   - warning: the page renders fine, but flashtrace deliberately does not
 *              read the reference (backticked ID in prose, blockquoted ID).
 */
function checkItemLocations(lines, file, problems) {
  const push = (severity, lineIndex, message) => problems.push({ severity, file, line: lineIndex + 1, message });
  // a line the page renders as prose: warn about every backticked ID in it
  const scanProse = (line, lineIndex) => {
    for (const m of line.matchAll(INLINE_ID_RE)) {
      push(
        'warning',
        lineIndex,
        `ID \`${m[1]}\` in prose is not traced: flashtrace reads IDs only in definitions, keyword entries, and forwarding lines`,
      );
    }
  };
  const definedId = (m) => makeId(m[1], m[2], m[3], m[4]);

  // GFM table state: once a header and delimiter row establish a table, it
  // absorbs every following non-blank line as a row (even one without pipes)
  // until a blank line or the start of another block - tracked here as a
  // heading, matching the boundaries the keyword-table parser knows.
  let openTable = null; // null | 'keyword' | 'informative'
  let keywordBulletsOpen = false; // bullet entries of a preceding keyword line

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      openTable = null;
      keywordBulletsOpen = false;
      continue;
    }
    if (openTable !== null) {
      if (HEADING_RE.test(line)) {
        openTable = null; // a heading starts a new block and ends the table
      } else {
        const definition = line.match(DEFINITION_RE);
        if (definition) {
          push(
            'error',
            i,
            `item ${definedId(definition)} is absorbed into the table above: the rendered page shows this line as a table row, not as a definition; separate it from the table with a blank line`,
          );
        } else if (openTable === 'informative') {
          scanProse(line, i); // keyword table cells are read, all others are prose
        }
        continue;
      }
    }
    if (opensTable(lines, i)) {
      openTable = keywordColumns(rowCells(lines[i])).length > 0 ? 'keyword' : 'informative';
      keywordBulletsOpen = false;
      if (openTable === 'informative') scanProse(line, i);
      i++; // the delimiter row carries only dashes
      continue;
    }
    const definition = line.match(DEFINITION_RE);
    if (definition) {
      keywordBulletsOpen = false;
      const above = i > 0 ? lines[i - 1] : '';
      const below = i + 1 < lines.length ? lines[i + 1] : '';
      if (above.trim() !== '' && !HEADING_RE.test(above) && !SETEXT_UNDERLINE_RE.test(above)) {
        push(
          'error',
          i,
          `item ${definedId(definition)} is defined in the middle of a paragraph: the rendered page shows this line as part of the text above; an item ID needs a blank line or its heading directly above`,
        );
      } else if (SETEXT_UNDERLINE_RE.test(below)) {
        push(
          'error',
          i,
          `item ${definedId(definition)} is turned into a heading by the underline below; item IDs are never heading text - separate the ID and the underline with a blank line`,
        );
      }
      continue;
    }
    if (FORWARD_LINE_RE.test(line)) {
      keywordBulletsOpen = false;
      continue;
    }
    const keyword = line.match(KEYWORD_RE);
    if (keyword) {
      keywordBulletsOpen = keyword[2].trim() === '';
      continue;
    }
    if (keywordBulletsOpen && BULLET_RE.test(line)) continue;
    keywordBulletsOpen = false;
    const quoted = line.match(BLOCKQUOTED_DEFINITION_RE);
    if (quoted) {
      push(
        'warning',
        i,
        `item definition ${definedId(quoted)} inside a blockquote is not read; move it out of the blockquote to define the item`,
      );
      continue;
    }
    scanProse(line, i);
  }
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
  checkItemLocations(lines, file, problems);
  return items;
}
