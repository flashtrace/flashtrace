/*
 * Item semantics shared by every specification format, independent of how a
 * format spells them. `KEYWORDS` is the keyword vocabulary ("Needs", "Covers",
 * "Tags") and `applyKeyword` folds a keyword's entries into an item: Tags are
 * taken verbatim, Needs and Covers are parsed as references against the item
 * stating them. How a format finds those entries - a Markdown keyword line, a
 * bullet list, a table column - stays in that format's parser.
 */

import { parseCoverEntry, parseNeedEntry } from './ids.mjs';

// Bare words only: src/parse-markdown.mjs interpolates these into a regex
// alternation unescaped, so a keyword must carry no regex metacharacters.
export const KEYWORDS = ['Needs', 'Covers', 'Tags'];

// is a piece of text one of the keywords, exactly?
export const isKeyword = (text) => KEYWORDS.includes(text);

// The reference keywords file an item's entries as IDs into a field of that
// item. Both accept the short form (impl, impl:name, impl#2), completed from
// the item's own [group/]name and revision; Needs may demand a wildcard
// revision, Covers stay concrete. Tags are the one keyword handled apart - they
// are taken verbatim, not parsed - so they carry no entry here. This table is
// the vocabulary-to-behaviour map: a keyword in KEYWORDS that reaches
// applyKeyword must be spelled out here or below, never handled by default.
const REFERENCE_KEYWORDS = {
  Needs: { target: 'needs', parse: parseNeedEntry },
  Covers: { target: 'covers', parse: parseCoverEntry },
};

// `source` names where the entries were read from - the keyword line's list
// or the table column the cell sits in - so a problem report points at the
// right spot. Each entry is a { value, line, character } record locating it in
// the source, so an invalid one is reported at its own position.
export function applyKeyword(item, keyword, entries, file, problems, source) {
  if (keyword === 'Tags') {
    for (const entry of entries) item.tags.push(entry.value);
    return;
  }
  const reference = REFERENCE_KEYWORDS[keyword];
  // isKeyword and KEYWORD_RE only ever admit KEYWORDS, so reaching here with a
  // keyword this function has no handling for means the vocabulary grew without
  // teaching applyKeyword. Fail loudly rather than silently filing the entries
  // under Covers.
  if (!reference) throw new Error(`applyKeyword: no handling for keyword "${keyword}"`);
  const { target, parse } = reference;
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
