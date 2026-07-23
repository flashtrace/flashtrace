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

// A verbatim keyword parses each entry as its own text: there is no reference to
// resolve and no way to be invalid, so the value is stored as written. Tags are
// the one such keyword. Kept as a parse function - not a separate branch - so
// every keyword dispatches through the same table below. Entries always carry
// non-empty text (the format parsers drop blanks), so this never returns the
// falsy value that would flag an entry as invalid.
const parseVerbatimKeyword = (raw) => raw;

// Every keyword's behaviour: which field of the item its entries fold into, and
// how each entry's text becomes the value stored there. Needs and Covers parse
// a reference against the item stating them - each accepts the short form
// (impl, impl:name, impl#2), completed from the item's own [group/]name and
// revision, with Needs allowing a wildcard revision and Covers staying concrete
// - and yield null on an invalid one, which applyKeyword reports. Tags are
// verbatim. This table is the complete vocabulary-to-behaviour map: a keyword in
// KEYWORDS that reaches applyKeyword must appear here, never handled by default.
const KEYWORD_HANDLERS = {
  Needs: { target: 'needs', parse: parseNeedEntry },
  Covers: { target: 'covers', parse: parseCoverEntry },
  Tags: { target: 'tags', parse: parseVerbatimKeyword },
};

// `source` names where the entries were read from - the keyword line's list
// or the table column the cell sits in - so a problem report points at the
// right spot. Each entry is a { value, line, character } record locating it in
// the source, so an invalid one is reported at its own position.
export function applyKeyword(item, keyword, entries, file, problems, source) {
  const handler = KEYWORD_HANDLERS[keyword];
  // isKeyword and KEYWORD_RE only ever admit KEYWORDS, so reaching here with a
  // keyword this table has no handler for means the vocabulary grew without a
  // matching handler. Fail loudly rather than silently filing the entries under
  // whichever field a default would pick.
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
