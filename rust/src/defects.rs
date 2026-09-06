/*
 * Every defect an item can carry, in one place.
 *
 * A defect is { kind, ref, message }, plus existing_revisions when the
 * revision-mismatch hint applies, plus file/line/character - all three or
 * none - when the defect has a source location of its own, distinct from the
 * item's: the invalid entry or the forwarding declaration it is about. A
 * defect without the location group is anchored at the item's own location.
 *
 * There is exactly one kind per condition, and every kind is raised from
 * exactly one place. `kind` is therefore a complete discriminator: a consumer
 * of the JSON report can tell every defect apart without ever reading
 * `message`. The message is offered as the wording the plain-text report
 * uses, not as data to parse - it may be reworded without a kind changing.
 *
 * Adding a condition means adding a kind here, never reusing a neighbouring
 * one. schemas/report/v0.json lists the same kinds and the tests hold the two
 * lists together.
 *
 * The report's `ref` field is named `reference` here (`ref` is a Rust
 * keyword); it still serializes as `ref`.
 */

/// every defect kind, in the order the schema lists them
pub const DEFECT_KINDS: [&str; 9] = [
    "invalid-reference",
    "uncovered-need",
    "uncovered-forward",
    "orphaned-cover",
    "unwanted-cover",
    "unwanted-item",
    "duplicate-id",
    "duplicate-forwarding",
    "cyclic-forwarding",
];

/// A source position: 1-based line and 1-based column in a file, the column
/// counted in characters (Unicode scalar values).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    pub file: String,
    pub line: usize,
    pub character: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Defect {
    pub kind: &'static str,
    pub reference: String,
    pub location: Option<Location>,
    pub existing_revisions: Option<Vec<String>>,
    pub message: String,
}

fn defect(kind: &'static str, reference: String, message: String) -> Defect {
    Defect {
        kind,
        reference,
        location: None,
        existing_revisions: None,
        message,
    }
}

/// a Needs/Covers entry that is not a valid reference; the entry is ignored,
/// so it is also carried nowhere else - the reference is the offending text
/// as written
pub fn invalid_reference(value: &str, source: &str, location: Location) -> Defect {
    Defect {
        location: Some(location),
        ..defect(
            "invalid-reference",
            value.to_string(),
            format!("invalid: \"{value}\" in {source} is not a valid ID and is ignored"),
        )
    }
}

/// a declared need that no defined item matches
pub fn uncovered_need(need: &str) -> Defect {
    defect(
        "uncovered-need",
        need.to_string(),
        format!("uncovered: needs {need}, which does not exist"),
    )
}

/// a forwarding whose target does not exist, so the redirected obligation
/// cannot be met
pub fn uncovered_forward(target: &str) -> Defect {
    defect(
        "uncovered-forward",
        target.to_string(),
        format!("uncovered: forwards to {target}, which does not exist"),
    )
}

/// a covers entry pointing at an item that does not exist
pub fn orphaned_cover(cover_id: &str) -> Defect {
    defect(
        "orphaned-cover",
        cover_id.to_string(),
        format!("orphaned: covers {cover_id}, which does not exist"),
    )
}

/// a covers entry pointing at an existing item that does not need this one
pub fn unwanted_cover(cover_id: &str, item_id: &str) -> Defect {
    defect(
        "unwanted-cover",
        cover_id.to_string(),
        format!("unwanted: covers {cover_id}, but {cover_id} does not need {item_id}"),
    )
}

/// a code item that no item needs, so nothing it implements is traced to it
pub fn unwanted_item(item_id: &str) -> Defect {
    defect(
        "unwanted-item",
        item_id.to_string(),
        format!("unwanted: no item needs {item_id}"),
    )
}

/// the same full ID defined more than once
pub fn duplicate_id(id: &str, count: usize) -> Defect {
    defect(
        "duplicate-id",
        id.to_string(),
        format!("duplicate: ID {id} is defined {count} times"),
    )
}

/// more than one forwarding declared for the same source; only the first is
/// effective, and the defect carries that first declaration's location
pub fn duplicate_forwarding(from: &str, count: usize, location: Location) -> Defect {
    Defect {
        location: Some(location),
        ..defect(
            "duplicate-forwarding",
            from.to_string(),
            format!("duplicate: forwarding for {from} is declared {count} times"),
        )
    }
}

/// a forwarding sitting on a cycle; it is voided, so the source falls back to
/// its own needs
pub fn cyclic_forwarding(target: &str, chain: &str, location: Location) -> Defect {
    Defect {
        location: Some(location),
        ..defect(
            "cyclic-forwarding",
            target.to_string(),
            format!(
                "cyclic: forwards to {target}, closing the cycle {chain}, so the forwarding has no effect"
            ),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema() -> serde_json::Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../schemas/report/v0.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn the_schema_lists_exactly_the_kinds_the_code_can_raise() {
        let schema = schema();
        let listed: Vec<&str> = schema["$defs"]["defect"]["properties"]["kind"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .map(|kind| kind.as_str().unwrap())
            .collect();
        assert_eq!(listed, DEFECT_KINDS);
    }

    #[test]
    fn no_kind_is_spelled_twice() {
        let unique: std::collections::HashSet<&str> = DEFECT_KINDS.into_iter().collect();
        assert_eq!(unique.len(), DEFECT_KINDS.len());
    }

    // the exact message wording is part of the report surface: the
    // plain-text and JSON reports carry it verbatim
    #[test]
    fn every_factory_words_its_message_as_expected() {
        let location = || Location {
            file: "f.md".to_string(),
            line: 2,
            character: 3,
        };
        assert_eq!(
            invalid_reference("x y", "the Needs list", location()).message,
            "invalid: \"x y\" in the Needs list is not a valid ID and is ignored"
        );
        assert_eq!(
            uncovered_need("impl:a#1").message,
            "uncovered: needs impl:a#1, which does not exist"
        );
        assert_eq!(
            uncovered_forward("dsn:a#1").message,
            "uncovered: forwards to dsn:a#1, which does not exist"
        );
        assert_eq!(
            orphaned_cover("feat:a#1").message,
            "orphaned: covers feat:a#1, which does not exist"
        );
        assert_eq!(
            unwanted_cover("feat:a#1", "req:b#1").message,
            "unwanted: covers feat:a#1, but feat:a#1 does not need req:b#1"
        );
        assert_eq!(
            unwanted_item("impl:a#1").message,
            "unwanted: no item needs impl:a#1"
        );
        assert_eq!(
            duplicate_id("req:a#1", 2).message,
            "duplicate: ID req:a#1 is defined 2 times"
        );
        assert_eq!(
            duplicate_forwarding("req:a#1", 2, location()).message,
            "duplicate: forwarding for req:a#1 is declared 2 times"
        );
        assert_eq!(
            cyclic_forwarding("dsn:b#1", "req:a#1 --> dsn:b#1 --> req:a#1", location()).message,
            "cyclic: forwards to dsn:b#1, closing the cycle req:a#1 --> dsn:b#1 --> req:a#1, so the forwarding has no effect"
        );
    }

    #[test]
    fn only_the_located_factories_carry_a_location() {
        let location = Location {
            file: "f.md".to_string(),
            line: 2,
            character: 3,
        };
        assert_eq!(
            invalid_reference("x", "s", location.clone())
                .location
                .as_ref(),
            Some(&location)
        );
        assert_eq!(
            duplicate_forwarding("a", 2, location.clone())
                .location
                .as_ref(),
            Some(&location)
        );
        assert_eq!(
            cyclic_forwarding("a", "c", location.clone())
                .location
                .as_ref(),
            Some(&location)
        );
        assert_eq!(uncovered_need("a").location, None);
        assert_eq!(uncovered_forward("a").location, None);
        assert_eq!(orphaned_cover("a").location, None);
        assert_eq!(unwanted_cover("a", "b").location, None);
        assert_eq!(unwanted_item("a").location, None);
        assert_eq!(duplicate_id("a", 2).location, None);
    }
}
