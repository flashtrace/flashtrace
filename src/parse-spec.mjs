/*
 * Specification parsers per file extension - the spec-side counterpart of
 * src/languages.mjs. Each format contributes one frontend with the parser
 * signature (file, text, problems, forwards) -> items; the semantics they share
 * live in src/spec-items.mjs.
 *
 * `specParserFor(ext)` resolves a file extension to its parser; `SPEC_EXT` is
 * the set of every extension we read as a specification and is the single
 * source of truth for spec-file collection.
 */

import { parseMarkdown } from './parse-markdown.mjs';

const BY_EXT = {
  '.md': parseMarkdown, '.markdown': parseMarkdown,
};

export const SPEC_EXT = new Set(Object.keys(BY_EXT));

// Parser for a lowercased extension, or null when it is not a spec file.
export const specParserFor = (ext) => BY_EXT[ext] ?? null;
