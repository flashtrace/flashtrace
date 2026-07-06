/*
 * Markdown parser (.md, .markdown):
 *   - An item is defined by a line containing only its ID in backticks: `req:auth/login#1`
 *   - Title: the heading (#...) directly above the ID (only blank lines in between).
 *   - Description: the lines following the ID (one blank line directly under the
 *     ID is allowed) up to the next blank line.
 *   - Keywords "Needs:", "Covers:", "Tags:" - inline comma-separated or as a
 *     bullet list on the following lines. Needs/Covers list full, explicit IDs.
 */

import { ID_SRC, mkId, parseIdEntry, newItem } from './ids.mjs';

const DEF_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
const HEADING_RE = /^(#{1,6})\s+(\S(?:.*\S)?)\s*$/;
const KEYWORD_RE = /^(Needs|Covers|Tags):\s*((?:\S.*)?)$/;
const BULLET_RE = /^\s*[-*+]\s+(\S(?:.*\S)?)\s*$/;

const isBoundary = (l) => DEF_RE.test(l) || HEADING_RE.test(l);

function titleAbove(lines, defIndex) {
  for (let k = defIndex - 1; k >= 0; k--) {
    const l = lines[k];
    if (l.trim() === '') continue; // blank lines between heading and ID are fine
    const h = l.match(HEADING_RE);
    return h ? h[2] : null; // any other text directly above -> no title
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
    const b = lines[j + 1].match(BULLET_RE);
    if (!b) break;
    entries.push(b[1].trim());
    j++;
  }
  return { entries, j };
}

function applyKeyword(item, keyword, entries, file, kwLine, problems) {
  if (keyword === 'Tags') {
    item.tags.push(...entries);
    return;
  }
  const target = keyword === 'Needs' ? 'needs' : 'covers';
  for (const e of entries) {
    const id = parseIdEntry(e);
    if (id) item[target].push(id);
    else
      problems.push({
        file,
        line: kwLine,
        message: `invalid ID "${e}" in ${keyword}: list of ${item.id}`,
      });
  }
}

// consume the item's body (description and keyword lines) starting at `start`;
// returns the index of the first line after the item
function parseItemBody(lines, start, item, file, problems) {
  let j = start;
  let descDone = false;
  while (j < lines.length && !isBoundary(lines[j])) {
    const line = lines[j];
    const kw = line.match(KEYWORD_RE);
    if (kw) {
      descDone = true;
      const collected = keywordEntries(lines, j, kw[2]);
      applyKeyword(item, kw[1], collected.entries, file, j + 1, problems);
      j = collected.j;
    } else if (line.trim() === '') {
      if (item.description.length > 0) descDone = true;
      // a blank line directly under the ID (before the description) is allowed
    } else if (!descDone) {
      item.description.push(line.trim());
    }
    // anything after the description's terminating blank line is informative text
    j++;
  }
  return j;
}

export function parseMarkdown(file, text, problems) {
  const lines = text.split(/\r?\n/);
  const items = [];

  let i = 0;
  while (i < lines.length) {
    const def = lines[i].match(DEF_RE);
    if (!def) {
      i++;
      continue;
    }
    const item = newItem(mkId(def[1], def[2], def[3], def[4]), 'markdown', file, i + 1);
    item.title = titleAbove(lines, i);
    i = parseItemBody(lines, i + 1, item, file, problems);
    items.push(item);
  }
  return items;
}
