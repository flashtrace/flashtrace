/*
 * The JSON report against its published contract.
 *
 * Three layers. Formal JSON Schema validation through the jsonschema crate.
 * A producer-side strictness walk the schema deliberately does not
 * express: everything emitted must be documented, or the schema has fallen
 * behind. And the invariants the schema cannot express - the inverse edges,
 * the summary counts, the orderings - asserted on every document the suite
 * can lay hands on, including the committed e2e snapshots.
 */

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use flashtrace::analyze::analyze;
use flashtrace::parse_code::parse_code;
use flashtrace::parse_markdown::parse_markdown;
use flashtrace::report_json::{build_report_document, serialize_report_document};

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative)
}

fn schema() -> Value {
    serde_json::from_str(&std::fs::read_to_string(repo_path("schemas/report/v0.json")).unwrap())
        .unwrap()
}

fn assert_valid(document: &Value, label: &str) {
    let schema = schema();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let errors: Vec<String> = validator
        .iter_errors(document)
        .map(|error| format!("{}: {error}", error.instance_path()))
        .collect();
    assert!(
        errors.is_empty(),
        "{label} does not match the schema:\n  {}",
        errors.join("\n  ")
    );
    let mut undocumented = Vec::new();
    assert_documented(document, &schema, &schema, label, &mut undocumented);
    assert!(
        undocumented.is_empty(),
        "{label} emits undocumented fields:\n  {}",
        undocumented.join("\n  ")
    );
}

// The schema leaves unknown fields unconstrained so a consumer can read a
// newer document. As the producer we hold ourselves to the stricter rule:
// everything we emit must be described, or the schema has fallen behind.
fn assert_documented(
    value: &Value,
    node: &Value,
    schema: &Value,
    where_: &str,
    errors: &mut Vec<String>,
) {
    if let Some(reference) = node.get("$ref").and_then(Value::as_str) {
        let target = reference
            .trim_start_matches("#/")
            .split('/')
            .fold(schema, |step, key| &step[key]);
        assert_documented(value, target, schema, where_, errors);
        return;
    }
    if let Some(branches) = node.get("oneOf").and_then(Value::as_array) {
        // the strictness walk only descends branches whose shape matches; the
        // formal validator already guaranteed exactly one does
        for branch in branches {
            assert_documented(value, branch, schema, where_, errors);
        }
        return;
    }
    if let (Some(object), Some(properties)) = (
        value.as_object(),
        node.get("properties").and_then(Value::as_object),
    ) {
        for (key, child) in object {
            match properties.get(key) {
                None => errors.push(format!("{where_}: undocumented field \"{key}\"")),
                Some(child_node) => assert_documented(
                    child,
                    child_node,
                    schema,
                    &format!("{where_}.{key}"),
                    errors,
                ),
            }
        }
    }
    if let (Some(entries), Some(items_node)) = (value.as_array(), node.get("items")) {
        for (index, entry) in entries.iter().enumerate() {
            assert_documented(
                entry,
                items_node,
                schema,
                &format!("{where_}[{index}]"),
                errors,
            );
        }
    }
}

fn pairs(list: &[(String, String)]) -> HashSet<String> {
    list.iter()
        .map(|(from, to)| format!("{from} -> {to}"))
        .collect()
}

fn string_of(value: &Value) -> String {
    value.as_str().unwrap().to_string()
}

fn assert_invariants(document: &Value, label: &str) {
    let items = document["items"].as_array().unwrap();
    let defined_ids: HashSet<String> = items.iter().map(|item| string_of(&item["id"])).collect();

    // status is the label; defective and deepCovered are the two axes behind it
    for item in items {
        let expected = if item["defective"].as_bool().unwrap() {
            "defective"
        } else if item["deepCovered"].as_bool().unwrap() {
            "deep-covered"
        } else {
            "shallow-covered"
        };
        assert_eq!(
            item["status"], expected,
            "{label}: {} status disagrees",
            item["id"]
        );
        assert_eq!(
            item["defective"].as_bool().unwrap(),
            !item["defects"].as_array().unwrap().is_empty(),
            "{label}: {} defective disagrees",
            item["id"]
        );
    }

    // covers[].status is the classification behind the cover defects
    for item in items {
        let refs_with = |kind: &str| -> HashSet<String> {
            item["defects"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|defect| defect["kind"] == kind)
                .map(|defect| string_of(&defect["ref"]))
                .collect()
        };
        let covers_with = |status: &str| -> HashSet<String> {
            item["covers"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|cover| cover["status"] == status)
                .map(|cover| string_of(&cover["ref"]))
                .collect()
        };
        assert_eq!(
            covers_with("orphaned"),
            refs_with("orphaned-cover"),
            "{label}: {} orphaned",
            item["id"]
        );
        assert_eq!(
            covers_with("unwanted"),
            refs_with("unwanted-cover"),
            "{label}: {} unwanted",
            item["id"]
        );
    }

    // every resolvedTo entry names an item that exists
    for item in items {
        for need in item["needs"].as_array().unwrap() {
            for id in need["resolvedTo"].as_array().unwrap() {
                assert!(
                    defined_ids.contains(id.as_str().unwrap()),
                    "{label}: {} needs {} resolving to unknown {id}",
                    item["id"],
                    need["ref"]
                );
            }
        }
    }

    // wantedBy is exactly the inverse of needs[].resolvedTo
    let wants_forward: Vec<(String, String)> = items
        .iter()
        .flat_map(|item| {
            item["needs"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(move |need| {
                    need["resolvedTo"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(move |id| (string_of(&item["id"]), string_of(id)))
                })
        })
        .collect();
    let wants_inverse: Vec<(String, String)> = items
        .iter()
        .flat_map(|item| {
            item["wantedBy"]
                .as_array()
                .unwrap()
                .iter()
                .map(move |wanter| (string_of(&wanter["id"]), string_of(&item["id"])))
        })
        .collect();
    assert_eq!(
        pairs(&wants_inverse),
        pairs(&wants_forward),
        "{label}: wantedBy inverse"
    );

    // forwardedFrom is exactly the inverse of forwardsTo, over existing targets
    let forwards_forward: Vec<(String, String)> = items
        .iter()
        .filter(|item| {
            !item["forwardsTo"].is_null()
                && defined_ids.contains(item["forwardsTo"].as_str().unwrap())
        })
        .map(|item| (string_of(&item["id"]), string_of(&item["forwardsTo"])))
        .collect();
    let forwards_inverse: Vec<(String, String)> = items
        .iter()
        .flat_map(|item| {
            item["forwardedFrom"]
                .as_array()
                .unwrap()
                .iter()
                .map(move |source| (string_of(&source["id"]), string_of(&item["id"])))
        })
        .collect();
    assert_eq!(
        pairs(&forwards_inverse),
        pairs(&forwards_forward),
        "{label}: forwardedFrom inverse"
    );

    // forwardsTo mirrors exactly the effective declarations
    let mirrored: Vec<(String, String)> = items
        .iter()
        .filter(|item| !item["forwardsTo"].is_null())
        .map(|item| (string_of(&item["id"]), string_of(&item["forwardsTo"])))
        .collect();
    let effective: Vec<(String, String)> = document["forwards"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|forward| forward["effective"].as_bool().unwrap())
        .map(|forward| (string_of(&forward["from"]), string_of(&forward["to"])))
        .collect();
    assert_eq!(
        pairs(&mirrored),
        pairs(&effective),
        "{label}: forwardsTo mirror"
    );

    // voidedBy is present exactly when the declaration is not effective
    for forward in document["forwards"].as_array().unwrap() {
        assert_eq!(
            forward.get("voidedBy").is_some(),
            !forward["effective"].as_bool().unwrap(),
            "{label}: voidedBy presence on {} --> {}",
            forward["from"],
            forward["to"]
        );
    }

    // existingRevisions accompanies the hint in the message, and only then
    for item in items {
        for defect in item["defects"].as_array().unwrap() {
            assert_eq!(
                defect.get("existingRevisions").is_some(),
                defect["message"]
                    .as_str()
                    .unwrap()
                    .contains("(revision mismatch:"),
                "{label}: {} defect {} existingRevisions presence",
                item["id"],
                defect["kind"]
            );
        }
    }

    // the summary counts what the arrays hold
    let defective_items = items
        .iter()
        .filter(|item| item["defective"].as_bool().unwrap())
        .count();
    let spec_items = items.iter().filter(|item| item["origin"] == "spec").count();
    let summary = &document["summary"];
    assert_eq!(summary["items"], items.len(), "{label}");
    assert_eq!(summary["specItems"], spec_items, "{label}");
    assert_eq!(summary["codeItems"], items.len() - spec_items, "{label}");
    assert_eq!(summary["okItems"], items.len() - defective_items, "{label}");
    assert_eq!(summary["defectiveItems"], defective_items, "{label}");
    assert_eq!(
        summary["shallowCoveredItems"],
        items
            .iter()
            .filter(|item| {
                !item["defective"].as_bool().unwrap() && !item["deepCovered"].as_bool().unwrap()
            })
            .count(),
        "{label}"
    );
    assert_eq!(
        summary["problems"],
        document["problems"].as_array().unwrap().len(),
        "{label}"
    );
    assert_eq!(
        document["ok"].as_bool().unwrap(),
        defective_items == 0 && document["problems"].as_array().unwrap().is_empty(),
        "{label}: ok disagrees"
    );

    // located arrays are sorted by file, then line, then character
    let sort_key = |entry: &Value| -> (String, u64, u64) {
        (
            string_of(&entry["file"]),
            entry["line"].as_u64().unwrap(),
            entry["character"].as_u64().unwrap(),
        )
    };
    let mut located: Vec<(String, Vec<Value>)> = vec![
        ("items".to_string(), items.clone()),
        (
            "forwards".to_string(),
            document["forwards"].as_array().unwrap().clone(),
        ),
        (
            "problems".to_string(),
            document["problems"].as_array().unwrap().clone(),
        ),
    ];
    for item in items {
        located.push((
            format!("{}.wantedBy", item["id"]),
            item["wantedBy"].as_array().unwrap().clone(),
        ));
        located.push((
            format!("{}.forwardedFrom", item["id"]),
            item["forwardedFrom"].as_array().unwrap().clone(),
        ));
    }
    for (name, list) in located {
        let keys: Vec<_> = list.iter().map(&sort_key).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted, "{label}: {name} is not sorted by location");
    }

    // paths never leak a backslash, on any platform
    for entry in items
        .iter()
        .chain(document["forwards"].as_array().unwrap())
        .chain(document["problems"].as_array().unwrap())
    {
        assert!(
            !entry["file"].as_str().unwrap().contains('\\'),
            "{label}: {} carries a backslash",
            entry["file"]
        );
    }
}

// every kind of item, edge, defect, void reason and problem in one run
fn build_everything() -> Value {
    let md = [
        "# Titled",
        "`req:a#1`",
        "",
        "Tags: web",
        "",
        "Needs: impl:a#1, dsn:missing#2, impl:wild#3.x, not/valid",
        "",
        "Covers: req:wants#1, req:nowant#1, req:gone#1",
        "",
        "`req:wants#1`",
        "",
        "Needs: req:a#1",
        "",
        "`req:nowant#1`",
        "",
        "`req:legacy#1`",
        "",
        "`req:dup#1`",
        "",
        "`dsn:b#1`",
        "",
        "`dsn:c#1`",
        "",
        "`req:eta#1`",
        "",
        "`req:twice#1`",
        "",
        "`req:twice#1`",
        "",
        "`req:fwdgone#1`",
        "",
        "`[req:legacy#1 --> req:a#1]`",
        "`[req:dup#1 --> dsn:b#1]`",
        "`[req:dup#1 --> dsn:c#1]`",
        "`[req:eta#1 --> req:eta#1]`",
        "`[req:ghost#1 --> dsn:b#1]`",
        "`[req:fwdgone#1 --> dsn:b#9]`",
    ];
    let code = [
        "// [impl:a#1]",
        "// [impl:wild#3.2]",
        "// [impl:stray#1]",
        "// [>>utest:orphan#1]",
    ];

    let mut problems = Vec::new();
    let mut forwards = Vec::new();
    let mut items = parse_markdown("docs/spec.md", &md.join("\n"), &mut problems, &mut forwards);
    items.extend(parse_code(
        "src/impl.js",
        &code.join("\n"),
        &mut problems,
        &mut forwards,
    ));
    analyze(&mut items, &mut forwards, &mut problems);
    let document = build_report_document(&items, &forwards, &problems, Path::new(""), "9.9.9");
    serde_json::from_str(&serialize_report_document(&document)).unwrap()
}

#[test]
fn the_reference_document_matches_the_schema_and_its_invariants() {
    let document = build_everything();
    assert_valid(&document, "reference document");
    assert_invariants(&document, "reference document");
}

#[test]
fn the_reference_document_actually_reaches_every_defect_kind_and_void_reason() {
    let document = build_everything();
    let schema = schema();
    let enum_of = |path: &[&str]| -> Vec<String> {
        let mut node = &schema;
        for key in path {
            node = &node[key];
        }
        let mut listed: Vec<String> = node.as_array().unwrap().iter().map(string_of).collect();
        listed.sort();
        listed
    };
    let sorted_set = |values: HashSet<String>| -> Vec<String> {
        let mut listed: Vec<String> = values.into_iter().collect();
        listed.sort();
        listed
    };

    let items = document["items"].as_array().unwrap();
    let kinds: HashSet<String> = items
        .iter()
        .flat_map(|item| {
            item["defects"]
                .as_array()
                .unwrap()
                .iter()
                .map(|defect| string_of(&defect["kind"]))
        })
        .collect();
    assert_eq!(
        sorted_set(kinds),
        enum_of(&["$defs", "defect", "properties", "kind", "enum"])
    );

    let reasons: HashSet<String> = document["forwards"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|forward| !forward["effective"].as_bool().unwrap())
        .map(|forward| string_of(&forward["voidedBy"]))
        .collect();
    assert_eq!(
        sorted_set(reasons),
        enum_of(&["$defs", "forward", "properties", "voidedBy", "enum"])
    );

    let statuses: HashSet<String> = items
        .iter()
        .map(|item| string_of(&item["status"]))
        .collect();
    assert_eq!(
        sorted_set(statuses),
        enum_of(&["$defs", "item", "properties", "status", "enum"])
    );

    let cover_statuses: HashSet<String> = items
        .iter()
        .flat_map(|item| {
            item["covers"]
                .as_array()
                .unwrap()
                .iter()
                .map(|cover| string_of(&cover["status"]))
        })
        .collect();
    assert_eq!(
        sorted_set(cover_statuses),
        enum_of(&["$defs", "cover", "properties", "status", "enum"])
    );

    let origins: HashSet<String> = items
        .iter()
        .map(|item| string_of(&item["origin"]))
        .collect();
    assert_eq!(
        sorted_set(origins),
        enum_of(&["$defs", "item", "properties", "origin", "enum"])
    );

    assert!(
        !document["problems"].as_array().unwrap().is_empty(),
        "no problem reached"
    );
}

#[test]
fn every_committed_json_snapshot_matches_the_schema_and_its_invariants() {
    let snapshot_dir = repo_path("test/e2e-expect");
    let mut checked = 0;
    for entry in std::fs::read_dir(&snapshot_dir).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json.txt") {
            continue;
        }
        let document: Value =
            serde_json::from_str(&std::fs::read_to_string(entry.path()).unwrap()).unwrap();
        assert_valid(&document, &name);
        assert_invariants(&document, &name);
        checked += 1;
    }
    assert!(checked > 0, "no JSON snapshots found to check");
}
