/*
 * JSON report (--format json): the run as a single JSON document on stdout,
 * in place of the plain-text report. It carries every item with its declared
 * references, their resolution, its defects and the items that want it, plus
 * every forwarding declaration, all problems and the summary.
 *
 * The document is deterministic: items, forwards and problems are sorted by
 * file, then line, then character; object keys serialize in a fixed order;
 * the output is two-space indented and ends with a single newline. See
 * schemas/report/v0.json for the contract and docs/json-report.md for how the
 * format is invoked and what it guarantees beyond the schema.
 *
 * The typed document structs declare their fields in the key order the
 * document guarantees; serde_json's pretty printer produces the two-space
 * indentation and separators the format pins (see the serialization tests).
 */

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::analyze::{Resolver, Summary, build_resolver, is_clean, status_of, summarize};
use crate::defects::{Defect, Problem};
use crate::ids::{Forward, Item, canonical_id, compare_rev, rev_of};
use crate::paths::display_relative;

// 0 marks the format unstable; it becomes 1 with flashtrace 1.0.0
const SCHEMA_VERSION: u64 = 0;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ItemReference {
    pub id: String,
    pub file: String,
    pub line: usize,
    pub character: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct NeedDocument {
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(rename = "resolvedTo")]
    pub resolved_to: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CoverDocument {
    #[serde(rename = "ref")]
    pub reference: String,
    pub status: &'static str,
}

// defect record in documented key order: the location group, present exactly
// when the defect carries a source location of its own, sits after ref;
// existingRevisions, when present, before the message
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct DefectDocument {
    pub kind: &'static str,
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character: Option<usize>,
    #[serde(rename = "existingRevisions", skip_serializing_if = "Option::is_none")]
    pub existing_revisions: Option<Vec<String>>,
    pub message: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ItemDocument {
    pub id: String,
    pub title: Option<String>,
    pub origin: &'static str,
    pub tags: Vec<String>,
    pub file: String,
    pub line: usize,
    pub character: usize,
    pub status: &'static str,
    pub defective: bool,
    #[serde(rename = "deepCovered")]
    pub deep_covered: bool,
    pub needs: Vec<NeedDocument>,
    pub covers: Vec<CoverDocument>,
    #[serde(rename = "forwardsTo")]
    pub forwards_to: Option<String>,
    #[serde(rename = "forwardedFrom")]
    pub forwarded_from: Vec<ItemReference>,
    pub defects: Vec<DefectDocument>,
    #[serde(rename = "wantedBy")]
    pub wanted_by: Vec<ItemReference>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ForwardDocument {
    pub from: String,
    pub to: String,
    pub file: String,
    pub line: usize,
    pub character: usize,
    pub effective: bool,
    #[serde(rename = "voidedBy", skip_serializing_if = "Option::is_none")]
    pub voided_by: Option<&'static str>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ProblemDocument {
    pub file: String,
    pub line: usize,
    pub character: usize,
    pub message: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ReportDocument {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u64,
    pub flashtrace: String,
    pub ok: bool,
    pub items: Vec<ItemDocument>,
    pub forwards: Vec<ForwardDocument>,
    pub problems: Vec<ProblemDocument>,
    pub summary: Summary,
}

// covers ref -> its status, read off the defects analyze raised rather than
// re-deciding the coverage rules here: it emits orphaned-cover /
// unwanted-cover for exactly the refs that are not valid, so anything
// unmentioned is valid.
fn cover_status_of(item: &Item) -> HashMap<&str, &'static str> {
    let mut status: HashMap<&str, &'static str> = HashMap::new();
    for defect in &item.defects {
        if defect.kind == "orphaned-cover" {
            status.insert(&defect.reference, "orphaned");
        } else if defect.kind == "unwanted-cover" {
            status.insert(&defect.reference, "unwanted");
        }
    }
    status
}

// item -> the items whose effective forwarding targets it. Built from the
// items' own forwards_to rather than from the forwards array, so it is the
// exact inverse of that field by construction and the two cannot disagree.
// A forwards_to naming an item that does not exist contributes nothing.
fn build_forwarded_from(items: &[Item], resolver: &Resolver) -> HashMap<usize, Vec<usize>> {
    let mut forwarded_from: HashMap<usize, Vec<usize>> = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        let Some(forwards_to) = &item.forwards_to else {
            continue;
        };
        if let Some(targets) = resolver.group(&canonical_id(forwards_to)) {
            for &target in targets {
                forwarded_from.entry(target).or_default().push(index);
            }
        }
    }
    forwarded_from
}

struct Locator {
    cwd: PathBuf,
}

impl Locator {
    // the document's `file`: relative to the working directory, with forward
    // slashes on every platform
    fn relative(&self, file: &str) -> String {
        display_relative(&self.cwd, file).replace('\\', "/")
    }
}

// the document's location order: file (code-point order), line, character
fn by_location(a: (&str, usize, usize), b: (&str, usize, usize)) -> std::cmp::Ordering {
    a.0.cmp(b.0)
        .then_with(|| a.1.cmp(&b.1))
        .then_with(|| a.2.cmp(&b.2))
}

pub fn build_report_document(
    items: &[Item],
    forwards: &[Forward],
    problems: &[Problem],
    cwd: &Path,
    version: &str,
) -> ReportDocument {
    let locator = Locator {
        cwd: cwd.to_path_buf(),
    };
    let resolver = build_resolver(items);
    let forwarded_from = build_forwarded_from(items, &resolver);

    // a need's resolution: the matching items' IDs as written, ascending by
    // revision. matches_of filters, so it already hands back an array of its
    // own to sort; each canonical match maps back to the defined spellings
    // behind it.
    let resolved_to = |reference: &str| -> Vec<String> {
        let mut matches: Vec<&String> = resolver.matches_of(reference);
        matches.sort_by(|a, b| compare_rev(rev_of(a), rev_of(b)));
        let mut resolved: Vec<String> = Vec::new();
        for id in matches {
            for &index in resolver.group(id).unwrap() {
                if !resolved.contains(&items[index].id) {
                    resolved.push(items[index].id.clone());
                }
            }
        }
        resolved
    };

    // both inverse edges serialize as located item references, sorted alike
    let item_references = |related: &[usize]| -> Vec<ItemReference> {
        let mut references: Vec<ItemReference> = related
            .iter()
            .map(|&index| ItemReference {
                id: items[index].id.clone(),
                file: locator.relative(&items[index].file),
                line: items[index].line,
                character: items[index].character,
            })
            .collect();
        references.sort_by(|a, b| {
            by_location(
                (&a.file, a.line, a.character),
                (&b.file, b.line, b.character),
            )
        });
        references
    };

    let defect_document = |defect: &Defect| -> DefectDocument {
        let location = defect.location.as_ref();
        DefectDocument {
            kind: defect.kind,
            reference: defect.reference.clone(),
            file: location.map(|location| locator.relative(&location.file)),
            line: location.map(|location| location.line),
            character: location.map(|location| location.character),
            existing_revisions: defect.existing_revisions.clone(),
            message: defect.message.clone(),
        }
    };

    let item_document = |(index, item): (usize, &Item)| -> ItemDocument {
        let cover_status = cover_status_of(item);
        ItemDocument {
            id: item.id.clone(),
            title: item.title.clone(),
            origin: item.origin.as_str(),
            tags: item.tags.clone(),
            file: locator.relative(&item.file),
            line: item.line,
            character: item.character,
            status: status_of(item),
            defective: !item.defects.is_empty(),
            deep_covered: item.deep_covered,
            needs: item
                .needs
                .iter()
                .map(|reference| NeedDocument {
                    reference: reference.clone(),
                    resolved_to: resolved_to(reference),
                })
                .collect(),
            covers: item
                .covers
                .iter()
                .map(|reference| CoverDocument {
                    reference: reference.clone(),
                    status: cover_status
                        .get(reference.as_str())
                        .copied()
                        .unwrap_or("valid"),
                })
                .collect(),
            forwards_to: item.forwards_to.clone(),
            forwarded_from: item_references(
                forwarded_from.get(&index).map(Vec::as_slice).unwrap_or(&[]),
            ),
            defects: item.defects.iter().map(defect_document).collect(),
            wanted_by: item_references(
                resolver
                    .wanted_by
                    .get(&index)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
            ),
        }
    };

    let forward_document = |forward: &Forward| -> ForwardDocument {
        ForwardDocument {
            from: forward.from.clone(),
            to: forward.to.clone(),
            file: locator.relative(&forward.file),
            line: forward.line,
            character: forward.character,
            effective: forward.effective,
            voided_by: if forward.effective {
                None
            } else {
                forward.voided_by
            },
        }
    };

    let mut item_documents: Vec<ItemDocument> =
        items.iter().enumerate().map(item_document).collect();
    item_documents.sort_by(|a, b| {
        by_location(
            (&a.file, a.line, a.character),
            (&b.file, b.line, b.character),
        )
    });
    let mut forward_documents: Vec<ForwardDocument> =
        forwards.iter().map(forward_document).collect();
    forward_documents.sort_by(|a, b| {
        by_location(
            (&a.file, a.line, a.character),
            (&b.file, b.line, b.character),
        )
    });
    let mut problem_documents: Vec<ProblemDocument> = problems
        .iter()
        .map(|problem| ProblemDocument {
            file: locator.relative(&problem.file),
            line: problem.line,
            character: problem.character,
            message: problem.message.clone(),
        })
        .collect();
    problem_documents.sort_by(|a, b| {
        by_location(
            (&a.file, a.line, a.character),
            (&b.file, b.line, b.character),
        )
    });

    // summarize returns the counts already in the document's key order
    let summary = summarize(items, problems);
    let ok = is_clean(&summary);

    ReportDocument {
        schema_version: SCHEMA_VERSION,
        flashtrace: version.to_string(),
        ok,
        items: item_documents,
        forwards: forward_documents,
        problems: problem_documents,
        summary,
    }
}

/// the serialized document exactly as `JSON.stringify(document, null, 2)`
/// spells it
pub fn serialize_report_document(document: &ReportDocument) -> String {
    serde_json::to_string_pretty(document).expect("the document serializes")
}

/// Build the JSON document, print it, and return the run verdict (true iff no
/// item is defective and no problem occurred - the same verdict, and exit
/// code, as the plain-text report).
pub fn report_json(
    items: &[Item],
    forwards: &[Forward],
    problems: &[Problem],
    cwd: &Path,
    version: &str,
) -> bool {
    let document = build_report_document(items, forwards, problems, cwd, version);
    crate::report::print_line(&serialize_report_document(&document));
    document.ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyze::analyze;
    use crate::parse_code::parse_code;
    use crate::parse_markdown::parse_markdown;

    // Build the JSON document straight from the real parsers and analyze, so
    // the shapes always match production. Markdown lands in docs/spec.md,
    // code in src/impl.js; cwd is '' so the relative paths come out as those
    // names.
    fn build(md: &[&str], code: &[&str]) -> ReportDocument {
        let mut problems = Vec::new();
        let mut forwards = Vec::new();
        let mut items =
            parse_markdown("docs/spec.md", &md.join("\n"), &mut problems, &mut forwards);
        items.extend(parse_code(
            "src/impl.js",
            &code.join("\n"),
            &mut problems,
            &mut forwards,
        ));
        analyze(&mut items, &mut forwards, &mut problems);
        build_report_document(&items, &forwards, &problems, Path::new(""), "9.9.9")
    }

    fn item_of<'doc>(document: &'doc ReportDocument, id: &str) -> &'doc ItemDocument {
        document
            .items
            .iter()
            .find(|item| item.id == id)
            .expect("item exists")
    }

    #[test]
    fn document_envelope_ordering_and_a_resolved_need() {
        let document = build(&["`req:a#1`", "", "Needs: impl:a#1"], &["// [impl:a#1]"]);
        assert_eq!(document.schema_version, 0);
        assert_eq!(document.flashtrace, "9.9.9");
        assert!(document.ok);
        assert!(document.forwards.is_empty());

        // items are sorted by file, then line, then character
        let ids: Vec<&str> = document.items.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["req:a#1", "impl:a#1"]);

        let req = item_of(&document, "req:a#1");
        assert_eq!(req.title, None);
        assert_eq!(req.origin, "spec");
        assert!(req.tags.is_empty());
        assert_eq!(req.file, "docs/spec.md");
        assert_eq!((req.line, req.character), (1, 1));
        assert_eq!(req.status, "deep-covered");
        assert!(!req.defective);
        assert!(req.deep_covered);
        assert_eq!(
            req.needs,
            [NeedDocument {
                reference: "impl:a#1".to_string(),
                resolved_to: vec!["impl:a#1".to_string()]
            }]
        );
        assert!(req.covers.is_empty());
        assert_eq!(req.forwards_to, None);
        assert!(req.forwarded_from.is_empty());
        assert!(req.defects.is_empty());
        assert!(req.wanted_by.is_empty());

        assert_eq!(document.summary.items, 2);
        assert_eq!(document.summary.spec_items, 1);
        assert_eq!(document.summary.code_items, 1);
        assert_eq!(document.summary.ok_items, 2);
        assert_eq!(document.summary.defective_items, 0);
        assert_eq!(document.summary.shallow_covered_items, 0);
        assert_eq!(document.summary.problems, 0);
    }

    #[test]
    fn a_wildcard_need_resolves_to_every_match_in_ascending_revision_order() {
        let document = build(
            &["`req:a#1`", "", "Needs: impl:a#2.x"],
            &["// [impl:a#2.10]", "// [impl:a#2.2]"],
        );
        assert_eq!(
            item_of(&document, "req:a#1").needs,
            [NeedDocument {
                reference: "impl:a#2.x".to_string(),
                resolved_to: vec!["impl:a#2.2".to_string(), "impl:a#2.10".to_string()]
            }]
        );
    }

    #[test]
    fn an_uncovered_need_is_a_defect_carrying_the_revision_mismatch_data() {
        let document = build(&["`req:a#1`", "", "Needs: impl:a#2"], &["// [impl:a#1]"]);
        let defect = &item_of(&document, "req:a#1").defects[0];
        assert_eq!(defect.kind, "uncovered-need");
        assert_eq!(defect.reference, "impl:a#2");
        assert_eq!(
            defect.existing_revisions.as_deref(),
            Some(["1".to_string()].as_slice())
        );
        assert!(
            defect
                .message
                .contains("revision mismatch: existing revision(s) of impl:a: 1")
        );
        assert_eq!(item_of(&document, "req:a#1").status, "defective");
        // existingRevisions sits before message, per the documented key order
        let serialized = serialize_report_document(&document);
        let revisions_at = serialized.find("\"existingRevisions\"").unwrap();
        assert!(serialized[revisions_at..].contains("\"message\""));
    }

    #[test]
    fn covers_entries_are_classified_valid_unwanted_or_orphaned() {
        let document = build(
            &[
                "`req:cover#1`",
                "",
                "Covers: req:wants#1, req:nowant#1, req:gone#1",
                "",
                "`req:wants#1`",
                "",
                "Needs: req:cover#1",
                "",
                "`req:nowant#1`",
            ],
            &[],
        );
        let cover = item_of(&document, "req:cover#1");
        let statuses: Vec<(&str, &str)> = cover
            .covers
            .iter()
            .map(|entry| (entry.reference.as_str(), entry.status))
            .collect();
        assert_eq!(
            statuses,
            [
                ("req:wants#1", "valid"),
                ("req:nowant#1", "unwanted"),
                ("req:gone#1", "orphaned")
            ]
        );
        let mut kinds: Vec<&str> = cover.defects.iter().map(|defect| defect.kind).collect();
        kinds.sort_unstable();
        assert_eq!(kinds, ["orphaned-cover", "unwanted-cover"]);
    }

    #[test]
    fn defective_and_deep_covered_are_independent_of_each_other() {
        let document = build(
            &[
                "`feat:x#1`",
                "",
                "`req:clean#1`",
                "",
                "Needs: impl:a#1",
                "",
                "Covers: feat:x#1",
                "",
                "`req:broken#1`",
                "",
                "Needs: dsn:z#1",
                "",
                "Covers: feat:x#1",
                "",
                "`dsn:z#1`",
                "",
                "Needs: impl:gone#1",
            ],
            &["// [impl:a#1]"],
        );
        let clean = item_of(&document, "req:clean#1");
        let broken = item_of(&document, "req:broken#1");
        assert_eq!(clean.status, broken.status, "status collapses the two");
        assert_eq!(clean.status, "defective");
        assert!(clean.defective);
        assert!(clean.deep_covered); // fixing the cover leaves nothing below
        assert!(broken.defective);
        assert!(!broken.deep_covered); // dsn:z#1 is itself uncovered
    }

    #[test]
    fn a_forwarding_source_still_has_its_covers_classified() {
        // forwarding excuses the source's needs but not its covers
        let document = build(
            &[
                "`req:legacy#1`",
                "",
                "Covers: req:nowant#1",
                "",
                "`req:nowant#1`",
                "",
                "`dsn:b#1`",
                "",
                "`[req:legacy#1 --> dsn:b#1]`",
            ],
            &[],
        );
        let covers = &item_of(&document, "req:legacy#1").covers;
        assert_eq!(covers.len(), 1);
        assert_eq!(covers[0].reference, "req:nowant#1");
        assert_eq!(covers[0].status, "unwanted");
    }

    #[test]
    fn forwards_and_wanted_by_record_the_reverse_edges() {
        let document = build(
            &[
                "`req:a#1`",
                "",
                "Needs: impl:a#1",
                "",
                "`req:legacy#1`",
                "",
                "`[req:legacy#1 --> req:a#1]`",
            ],
            &["// [impl:a#1]"],
        );
        assert_eq!(document.forwards.len(), 1);
        let forward = &document.forwards[0];
        assert_eq!(
            (forward.from.as_str(), forward.to.as_str()),
            ("req:legacy#1", "req:a#1")
        );
        assert_eq!(
            (forward.file.as_str(), forward.line, forward.character),
            ("docs/spec.md", 7, 1)
        );
        assert!(forward.effective);
        assert_eq!(forward.voided_by, None);

        // impl:a#1 is wanted by req:a#1; forwarding demand is not counted here
        assert_eq!(
            item_of(&document, "impl:a#1").wanted_by,
            [ItemReference {
                id: "req:a#1".to_string(),
                file: "docs/spec.md".to_string(),
                line: 1,
                character: 1
            }]
        );
        assert!(item_of(&document, "req:a#1").wanted_by.is_empty());
        assert_eq!(item_of(&document, "req:a#1").forwards_to, None);
        assert_eq!(
            item_of(&document, "req:legacy#1").forwards_to.as_deref(),
            Some("req:a#1")
        );

        // the forwarding demand wantedBy leaves out shows up here instead
        assert_eq!(
            item_of(&document, "req:a#1").forwarded_from,
            [ItemReference {
                id: "req:legacy#1".to_string(),
                file: "docs/spec.md".to_string(),
                line: 5,
                character: 1
            }]
        );
        assert!(item_of(&document, "req:legacy#1").forwarded_from.is_empty());
    }

    #[test]
    fn forwards_record_every_void_reason_and_mirror_forwards_to() {
        let document = build(
            &[
                "`req:dup#1`",
                "",
                "`dsn:b#1`",
                "",
                "`dsn:c#1`",
                "",
                "`[req:dup#1 --> dsn:b#1]`",
                "`[req:dup#1 --> dsn:c#1]`",
                "",
                "`req:eta#1`",
                "",
                "`[req:eta#1 --> req:eta#1]`",
                "",
                "`[req:ghost#1 --> dsn:b#1]`",
            ],
            &[],
        );
        let reason = |from: &str, to: &str| {
            document
                .forwards
                .iter()
                .find(|forward| forward.from == from && forward.to == to)
                .unwrap()
        };
        assert!(reason("req:dup#1", "dsn:b#1").effective);
        assert_eq!(reason("req:dup#1", "dsn:b#1").voided_by, None);
        assert_eq!(reason("req:dup#1", "dsn:c#1").voided_by, Some("duplicate"));
        assert_eq!(reason("req:eta#1", "req:eta#1").voided_by, Some("cycle"));
        assert_eq!(
            reason("req:ghost#1", "dsn:b#1").voided_by,
            Some("missing-source")
        );
        // the effective declaration is the only one mirrored on the item
        assert_eq!(
            item_of(&document, "req:dup#1").forwards_to.as_deref(),
            Some("dsn:b#1")
        );
        // forwardedFrom lists only effective forwardings
        let from_b: Vec<&str> = item_of(&document, "dsn:b#1")
            .forwarded_from
            .iter()
            .map(|source| source.id.as_str())
            .collect();
        assert_eq!(from_b, ["req:dup#1"]);
        assert!(item_of(&document, "dsn:c#1").forwarded_from.is_empty());
    }

    #[test]
    fn a_forwarding_to_a_missing_target_contributes_no_forwarded_from_anywhere() {
        let document = build(&["`req:a#1`", "", "`[req:a#1 --> dsn:gone#1]`"], &[]);
        assert_eq!(
            item_of(&document, "req:a#1").forwards_to.as_deref(),
            Some("dsn:gone#1")
        );
        for item in &document.items {
            assert!(item.forwarded_from.is_empty());
        }
    }

    #[test]
    fn problems_are_reported_with_location_and_fail_the_run_without_any_defect() {
        let document = build(&[], &["// [>>utest:a#1]"]);
        assert!(!document.ok);
        assert_eq!(
            document.problems,
            [ProblemDocument {
                file: "src/impl.js".to_string(),
                line: 1,
                character: 4,
                message: "need tag [>>utest:a#1] has no preceding item tag in this file"
                    .to_string(),
            }]
        );
        assert_eq!(document.summary.defective_items, 0);
        assert_eq!(document.summary.problems, 1);
    }

    #[test]
    fn building_the_document_twice_over_the_same_items_yields_the_same_bytes() {
        let mut problems = Vec::new();
        let mut forwards = Vec::new();
        let mut items = parse_markdown(
            "docs/spec.md",
            &[
                "`req:a#1`",
                "",
                "Needs: impl:a#2.x",
                "",
                "`req:b#1`",
                "",
                "Needs: impl:a#2.x",
            ]
            .join("\n"),
            &mut problems,
            &mut forwards,
        );
        items.extend(parse_code(
            "src/impl.js",
            &["// [impl:a#2.10]", "// [impl:a#2.2]"].join("\n"),
            &mut problems,
            &mut forwards,
        ));
        analyze(&mut items, &mut forwards, &mut problems);

        let first = build_report_document(&items, &forwards, &problems, Path::new(""), "9.9.9");
        let second = build_report_document(&items, &forwards, &problems, Path::new(""), "9.9.9");
        assert_eq!(
            serialize_report_document(&first),
            serialize_report_document(&second)
        );
        // and the wildcard still resolves in ascending revision order both times
        for document in [&first, &second] {
            assert_eq!(
                item_of(document, "req:a#1").needs[0].resolved_to,
                ["impl:a#2.2", "impl:a#2.10"]
            );
        }
    }

    #[test]
    fn items_forwards_and_problems_are_sorted_by_file_line_character() {
        let document = build(&["`req:b#1`", "", "`req:a#1`"], &[]);
        // two items on the same file: order follows line, not id
        let ids: Vec<&str> = document.items.iter().map(|item| item.id.as_str()).collect();
        assert_eq!(ids, ["req:b#1", "req:a#1"]);
        let lines: Vec<usize> = document.items.iter().map(|item| item.line).collect();
        assert_eq!(lines, [1, 3]);
        for item in &document.items {
            assert!(!item.file.contains('\\')); // forward slashes only
        }
    }

    // the serialized shape is part of the format: two-space indentation,
    // `": "` separators and the documented key order
    #[test]
    fn serialization_keeps_the_documented_key_order_and_indentation() {
        let document = build(&["`req:a#1`", "", "Needs: impl:a#1"], &["// [impl:a#1]"]);
        let serialized = serialize_report_document(&document);
        let expected_head = concat!(
            "{\n  \"schemaVersion\": 0,\n  \"flashtrace\": \"9.9.9\",\n",
            "  \"ok\": true,\n  \"items\": ["
        );
        assert!(serialized.starts_with(expected_head));
        assert!(serialized.ends_with('}'));
        // key order within an item document
        let item_keys = [
            "\"id\"",
            "\"title\"",
            "\"origin\"",
            "\"tags\"",
            "\"file\"",
            "\"line\"",
            "\"character\"",
            "\"status\"",
            "\"defective\"",
            "\"deepCovered\"",
            "\"needs\"",
            "\"covers\"",
            "\"forwardsTo\"",
            "\"forwardedFrom\"",
            "\"defects\"",
            "\"wantedBy\"",
        ];
        let mut position = serialized.find("\"items\"").unwrap();
        for key in item_keys {
            let found = serialized[position..].find(key).expect(key);
            position += found;
        }
    }

    // the document is UTF-8 with the minimal JSON escaping: `"` and `\`
    // escaped, the C0 controls as \b \t \n \f \r or lowercase \u00xx,
    // everything else - non-ASCII, U+2028/29, astral - raw
    #[test]
    fn string_escaping_is_the_json_minimum_with_non_ascii_raw() {
        let mut subject = String::new();
        for code in 0x00u32..=0x20 {
            subject.push(char::from_u32(code).unwrap());
        }
        subject.push_str("\"\\\u{e9}\u{2713}\u{fffd}\u{2028}\u{2029}\u{1f600}");
        let mut expected = String::from("\"");
        for code in 0x00u32..=0x1f {
            match code {
                0x08 => expected.push_str("\\b"),
                0x09 => expected.push_str("\\t"),
                0x0a => expected.push_str("\\n"),
                0x0c => expected.push_str("\\f"),
                0x0d => expected.push_str("\\r"),
                _ => expected.push_str(&format!("\\u{code:04x}")),
            }
        }
        expected.push(' ');
        expected.push_str("\\\"\\\\\u{e9}\u{2713}\u{fffd}\u{2028}\u{2029}\u{1f600}");
        expected.push('"');
        assert_eq!(serde_json::to_string(&subject).unwrap(), expected);
    }
}
