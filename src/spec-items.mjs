/*
 * Item semantics shared by every specification format, independent of how a
 * format spells them. `KEYWORDS` is the keyword vocabulary ("Needs", "Covers",
 * "Tags") and `applyKeyword` folds a keyword's entries into an item: Tags are
 * taken verbatim, Needs and Covers are parsed as references against the item
 * stating them. The line layout of a keyword's entries - inline
 * comma-separated, or a list on the following lines - is shared too
 * (`keywordEntries`), parameterized by the format's list-marker regex. Where
 * a format spells those constructs - the keyword line's shape, the list
 * markers, a table column - stays in that format's parser.
 */

import { parseCoverEntry, parseNeedEntry } from './ids.mjs';

// Bare words only: src/parse-markdown.mjs interpolates these into a regex
// alternation unescaped, so a keyword must carry no regex metacharacters.
export const KEYWORDS = ['Needs', 'Covers', 'Tags'];

// is a piece of text one of the keywords, exactly?
export const isKeyword = (text) => KEYWORDS.includes(text);

// Shaped as a parse function so Tags dispatches through the same table as the
// rest; entry text is never empty, so it never returns the falsy "invalid" value.
const parseVerbatimKeyword = (raw) => raw;

// The complete vocabulary-to-behaviour map: which item field a keyword's entries
// fold into, and how each entry's text becomes the stored value. Needs and
// Covers parse a reference against the item stating them and yield null on an
// invalid one, which applyKeyword reports. A keyword in KEYWORDS must appear
// here - never handled by a default.
const KEYWORD_HANDLERS = {
  Needs: { target: 'needs', parse: parseNeedEntry },
  Covers: { target: 'covers', parse: parseCoverEntry },
  Tags: { target: 'tags', parse: parseVerbatimKeyword },
};

// Entries of a keyword line: inline comma-separated, or a list on the
// following lines - each line matching `listMarkerRe`, the format's list
// regex, which captures the entry text as group 1. Each entry carries its own
// source location (the column of its first character, and - for a list - the
// line it sits on rather than the keyword line), so an invalid-ID problem
// points at the entry itself. Returns the entries and the index of the last
// consumed line.
export function keywordEntries(lines, j, inline, listMarkerRe) {
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
    const marker = lines[j + 1].match(listMarkerRe);
    if (!marker) break;
    entries.push({ value: marker[1].trim(), line: j + 2, character: lines[j + 1].indexOf(marker[1]) + 1 });
    j++;
  }
  return { entries, j };
}

// `source` names where the entries were read from - the keyword line's list
// or the table column the cell sits in - so a problem report points at the
// right spot. Each entry is a { value, line, character } record locating it in
// the source, so an invalid one is reported at its own position.
export function applyKeyword(item, keyword, entries, file, problems, source) {
  const handler = KEYWORD_HANDLERS[keyword];
  // only reachable when KEYWORDS grew without a matching handler; fail loudly
  // rather than silently filing the entries under whichever field a default picks
  if (!handler) throw new Error(`applyKeyword: no handling for keyword "${keyword}"`);
  const { target, parse } = handler;
  for (const entry of entries) {
    const value = parse(entry.value, item.id);
    if (value) item[target].push(value);
    else
      problems.push({
        file,
        line: entry.line,
        character: entry.character,
        message: `invalid ID "${entry.value}" in ${source}`,
      });
  }
}
