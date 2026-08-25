/*
 * Item semantics shared by every specification format, independent of how a
 * format spells them. `KEYWORDS` is the keyword vocabulary ("Needs",
 * "Covers", "Tags") and `apply_keyword` folds a keyword's entries into an
 * item: Tags are taken verbatim, Needs and Covers are parsed as references
 * against the item stating them. How a format finds those entries - a
 * Markdown keyword line, a bullet list, a table column - stays in that
 * format's parser.
 */

use crate::defects::{Location, invalid_reference};
use crate::ids::{Item, parse_cover_entry, parse_need_entry};

// Bare words only: the Markdown parser interpolates these into a regex
// alternation unescaped, so a keyword must carry no regex metacharacters.
pub const KEYWORDS: [&str; 3] = ["Needs", "Covers", "Tags"];

/// is a piece of text one of the keywords, exactly?
pub fn is_keyword(text: &str) -> bool {
    KEYWORDS.contains(&text)
}

/// A keyword entry as a format's parser reads it: its text and its own
/// position, so an invalid one is flagged at its own spot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub value: String,
    pub line: usize,
    pub character: usize,
}

/// Fold a keyword's entries into the item stating them. `source` names where
/// the entries were read from - the keyword line's list or the table column
/// the cell sits in - so the defect message names the right spot. Needs and
/// Covers parse each entry as a reference against the item and flag an
/// invalid one as an item defect; Tags take the entry text verbatim, which is
/// never empty, so it is never flagged.
pub fn apply_keyword(item: &mut Item, keyword: &str, entries: &[Entry], file: &str, source: &str) {
    // The complete vocabulary-to-behaviour map: which item field a keyword's
    // entries fold into, and how each entry's text becomes the stored value.
    // A keyword in KEYWORDS must be routed here, before any entry is read -
    // failing loudly beats silently filing the entries under whichever field
    // a default would pick.
    enum Handler {
        Needs,
        Covers,
        Tags,
    }
    let handler = match keyword {
        "Needs" => Handler::Needs,
        "Covers" => Handler::Covers,
        "Tags" => Handler::Tags,
        _ => panic!("apply_keyword: no handling for keyword \"{keyword}\""),
    };
    for entry in entries {
        let parsed = match handler {
            Handler::Needs => parse_need_entry(&entry.value, &item.id),
            Handler::Covers => parse_cover_entry(&entry.value, &item.id),
            Handler::Tags => Some(entry.value.clone()),
        };
        match parsed {
            Some(value) => match handler {
                Handler::Needs => item.needs.push(value),
                Handler::Covers => item.covers.push(value),
                Handler::Tags => item.tags.push(value),
            },
            None => item.defects.push(invalid_reference(
                &entry.value,
                source,
                Location {
                    file: file.to_string(),
                    line: entry.line,
                    character: entry.character,
                },
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{Origin, new_item};

    fn item() -> Item {
        new_item("req:owner#1", Origin::Spec, "f.md", 1, 1)
    }

    // KEYWORDS is the vocabulary, but apply_keyword still spells out each
    // keyword's behaviour; a keyword the vocabulary admits but no handler
    // routes must not slip in.
    #[test]
    fn apply_keyword_handles_every_keyword_in_the_vocabulary() {
        // dispatch happens before any entry is read, so empty entries
        // suffice: an unhandled keyword panics without needing valid IDs
        for keyword in KEYWORDS {
            apply_keyword(&mut item(), keyword, &[], "f.md", "test");
        }
    }

    #[test]
    #[should_panic(expected = "no handling for keyword \"Blocks\"")]
    fn apply_keyword_panics_on_a_keyword_it_has_no_handling_for() {
        // a word outside KEYWORDS must fail loudly, never fall through to Covers
        apply_keyword(&mut item(), "Blocks", &[], "f.md", "test");
    }

    #[test]
    fn tags_entries_are_taken_verbatim() {
        let mut item = item();
        let entry = Entry {
            value: "draft".to_string(),
            line: 1,
            character: 1,
        };
        apply_keyword(&mut item, "Tags", &[entry], "f.md", "test");
        assert_eq!(item.tags, ["draft"]);
    }

    // A verbatim keyword shares apply_keyword's reference loop, so a value
    // that looks like an invalid ID must still be stored, never flagged.
    #[test]
    fn tags_take_a_value_verbatim_without_validating_it_as_an_id() {
        let mut item = item();
        let entry = Entry {
            value: "not an id".to_string(),
            line: 1,
            character: 1,
        };
        apply_keyword(&mut item, "Tags", &[entry], "f.md", "test");
        assert_eq!(item.tags, ["not an id"]);
        assert!(item.defects.is_empty());
    }

    #[test]
    fn needs_and_covers_flag_an_invalid_entry_at_its_own_position() {
        let mut item = item();
        let entry = Entry {
            value: "not an id".to_string(),
            line: 4,
            character: 9,
        };
        apply_keyword(&mut item, "Needs", &[entry], "f.md", "the Needs list");
        assert!(item.needs.is_empty());
        assert_eq!(item.defects.len(), 1);
        assert_eq!(item.defects[0].kind, "invalid-reference");
        let location = item.defects[0].location.as_ref().unwrap();
        assert_eq!((location.line, location.character), (4, 9));
    }

    #[test]
    fn needs_and_covers_complete_against_the_stating_item() {
        let mut item = item();
        apply_keyword(
            &mut item,
            "Needs",
            &[Entry {
                value: "impl#2".to_string(),
                line: 2,
                character: 1,
            }],
            "f.md",
            "test",
        );
        apply_keyword(
            &mut item,
            "Covers",
            &[Entry {
                value: "feat".to_string(),
                line: 3,
                character: 1,
            }],
            "f.md",
            "test",
        );
        assert_eq!(item.needs, ["impl:owner#2"]);
        assert_eq!(item.covers, ["feat:owner#1"]);
    }
}
