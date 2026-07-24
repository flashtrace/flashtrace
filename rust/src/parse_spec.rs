/*
 * Specification parsers per file extension - the spec-side counterpart of the
 * code-language table. Each format contributes one frontend with the parser
 * signature (file, text, problems, forwards) -> items; the semantics they
 * share live in spec_items.rs.
 *
 * `spec_parser_for(ext)` resolves a file extension to its parser; `SPEC_EXT`
 * is the set of every extension we read as a specification and is the single
 * source of truth for spec-file collection. Extensions are spelled without
 * their leading dot, as `std::path::Path::extension` yields them.
 */

use crate::defects::Problem;
use crate::ids::{Forward, Item};
use crate::parse_markdown::parse_markdown;

/// the parser signature every specification format frontend shares
pub type SpecParser = fn(&str, &str, &mut Vec<Problem>, &mut Vec<Forward>) -> Vec<Item>;

pub const SPEC_EXT: [&str; 2] = ["md", "markdown"];

/// Parser for a lowercased extension (without its dot), or None when it is
/// not a spec file.
pub fn spec_parser_for(ext: &str) -> Option<SpecParser> {
    match ext {
        "md" | "markdown" => Some(parse_markdown as SpecParser),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec_items::{KEYWORDS, is_keyword};
    use regex::Regex;

    // The dispatcher and the extension set are two views of one map, so they
    // cannot drift: every spec extension resolves to a parser, and nothing
    // else does. Function pointers compare unreliably in Rust, so the test
    // exercises the resolved parser instead of comparing identities.
    #[test]
    fn spec_parser_for_resolves_spec_extensions_to_their_parser() {
        for ext in ["md", "markdown"] {
            let parser = spec_parser_for(ext).unwrap();
            let mut problems = Vec::new();
            let mut forwards = Vec::new();
            let items = parser("spec.md", "`req:a#1`", &mut problems, &mut forwards);
            assert_eq!(items.len(), 1, "{ext}");
            assert_eq!(items[0].id, "req:a#1", "{ext}");
        }
    }

    #[test]
    fn spec_parser_for_returns_none_for_non_spec_extensions() {
        // a code extension is not a spec format; the CLI falls back to the
        // code tag scanner
        assert!(spec_parser_for("js").is_none());
        // an unknown extension is neither, and neither is no extension
        assert!(spec_parser_for("txt").is_none());
        assert!(spec_parser_for("").is_none());
    }

    #[test]
    fn spec_ext_is_exactly_the_set_of_dispatched_extensions() {
        let mut sorted = SPEC_EXT.to_vec();
        sorted.sort_unstable();
        assert_eq!(sorted, ["markdown", "md"]);
        for ext in SPEC_EXT {
            assert!(spec_parser_for(ext).is_some());
        }
    }

    // parse_markdown.rs interpolates KEYWORDS into a regex alternation
    // unescaped, so this invariant is what keeps that safe. If a future
    // keyword needs a metacharacter, escape at the interpolation site rather
    // than loosen this.
    #[test]
    fn every_keyword_is_a_regex_safe_bare_word() {
        let metacharacter = Regex::new(r"[\\^$.*+?()\[\]{}|]").unwrap();
        for keyword in KEYWORDS {
            assert!(!metacharacter.is_match(keyword), "keyword \"{keyword}\"");
            assert!(is_keyword(keyword));
        }
    }
}
