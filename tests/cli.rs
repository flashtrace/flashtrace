/*
 * Process-level CLI suite: every case spawns the built binary in a temp
 * project and asserts stdout, stderr and the exit code.
 */

use std::path::PathBuf;
use std::process::{Command, Output};

struct Project(PathBuf);

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn with_project(name: &str, files: &[(&str, &[&str])]) -> Project {
    let dir = std::env::temp_dir().join(format!("flashtrace-cli-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    for (file, lines) in files {
        std::fs::write(dir.join(file), lines.join("\n") + "\n").unwrap();
    }
    Project(dir)
}

fn run(project: &Project, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_flashtrace"))
        .args(args)
        .current_dir(&project.0)
        .output()
        .unwrap()
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn clean_project_exit_0_and_final_ok() {
    let project = with_project(
        "clean",
        &[
            (
                "spec.md",
                &["# Login", "`req:login#1`", "", "Needs: impl:login#1"],
            ),
            ("login.ts", &["// [impl:login#1]"]),
        ],
    );
    let result = run(&project, &[]);
    assert_eq!(result.status.code(), Some(0));
    assert!(stdout(&result).trim_end().ends_with("ok"));
    assert!(!stdout(&result).contains("not ok"));
}

#[test]
fn defective_project_exit_1_defect_listed_final_not_ok() {
    let project = with_project(
        "defective",
        &[("spec.md", &["`req:login#1`", "", "Needs: impl:missing#1"])],
    );
    let result = run(&project, &[]);
    assert_eq!(result.status.code(), Some(1));
    assert!(stdout(&result).contains("uncovered: needs impl:missing#1"));
    assert!(stdout(&result).trim_end().ends_with("not ok"));
}

#[test]
fn parse_problems_alone_make_the_run_fail() {
    let project = with_project("problems", &[("orphan.ts", &["// [>>utest:a#1]"])]);
    let result = run(&project, &[]);
    assert_eq!(result.status.code(), Some(1));
    assert!(stdout(&result).contains("no preceding item tag"));
}

#[test]
fn unknown_option_exit_2_with_message_on_stderr() {
    let project = with_project("unknown-option", &[]);
    let result = run(&project, &["--frobnicate"]);
    assert_eq!(result.status.code(), Some(2));
    assert!(stderr(&result).contains("unknown option"));
}

#[test]
fn version_prints_the_crate_version_and_exits_0() {
    let project = with_project("version", &[]);
    for flag in ["--version", "-V"] {
        let result = run(&project, &[flag]);
        assert_eq!(result.status.code(), Some(0), "{}", stderr(&result));
        assert_eq!(stdout(&result).trim_end(), env!("CARGO_PKG_VERSION"));
    }
}

#[test]
fn help_prints_usage_and_exits_0() {
    let project = with_project("help", &[]);
    for flag in ["--help", "-h"] {
        let result = run(&project, &[flag]);
        assert_eq!(result.status.code(), Some(0));
        assert!(stdout(&result).starts_with("Usage: flashtrace"));
        assert!(
            stdout(&result)
                .contains("Exit codes: 0 clean, 1 defects or problems found, 2 usage error")
        );
    }
}

#[test]
fn non_existent_input_path_exit_2() {
    let project = with_project("missing-path", &[]);
    let result = run(&project, &["does-not-exist"]);
    assert_eq!(result.status.code(), Some(2));
    assert!(stderr(&result).contains("does not exist"));
}

const TAGS_SPEC: &[&str] = &["# A", "`req:a#1`", "", "Tags: Auth", "", "# B", "`req:b#1`"];

#[test]
fn tags_filters_markdown_items_and_underscore_readmits_untagged_ones() {
    let project = with_project("tags", &[("spec.md", TAGS_SPEC)]);
    for (args, expected_items) in [
        (vec!["-t", "Auth"], "items       1"),
        (vec!["-t", "Auth,_"], "items       2"),
        (vec!["--tags=Auth"], "items       1"),
        (vec!["--tags=Auth,_"], "items       2"),
        (vec!["--tags", "Auth , _"], "items       2"),
        (vec!["--tags=Auth , _"], "items       2"),
        (vec!["--tags=Auth,,_,"], "items       2"),
    ] {
        let result = run(&project, &args);
        assert_eq!(
            result.status.code(),
            Some(0),
            "{args:?}: {}",
            stderr(&result)
        );
        assert!(
            stdout(&result).contains(expected_items),
            "{args:?}: {}",
            stdout(&result)
        );
    }
}

#[test]
fn tags_split_at_the_first_equals_only_keeping_equals_in_the_value() {
    let project = with_project(
        "tags-equals",
        &[(
            "spec.md",
            &["# A", "`req:a#1`", "", "Tags: a=b", "", "# B", "`req:b#1`"],
        )],
    );
    let result = run(&project, &["--tags=a=b"]);
    assert_eq!(result.status.code(), Some(0), "{}", stderr(&result));
    assert!(stdout(&result).contains("items       1"));
}

#[test]
fn selecting_the_tag_filter_twice_is_a_usage_error_with_empty_stdout() {
    let project = with_project("tags-twice", &[("spec.md", TAGS_SPEC)]);
    // differing, agreeing and mixed spellings alike: one rule
    for (args, blamed) in [
        (vec!["-t", "Auth", "-t", "Other"], "-t"),
        (vec!["--tags", "Auth", "--tags", "Other"], "--tags"),
        (vec!["--tags=Auth", "--tags=Other"], "--tags"),
        (vec!["-t", "Auth", "--tags=Auth"], "-t"),
        (vec!["--tags", "Auth", "-t", "Other"], "--tags"),
    ] {
        let result = run(&project, &args);
        assert_eq!(result.status.code(), Some(2), "{args:?}");
        assert_eq!(stdout(&result), "", "{args:?}");
        assert!(
            stderr(&result).contains(&format!("the tag filter is already selected by {blamed}")),
            "{args:?}: {}",
            stderr(&result)
        );
    }
}

#[test]
fn verbose_lists_clean_items_with_needs_and_wanted_by_edges_default_omits_them() {
    let project = with_project(
        "verbose",
        &[
            (
                "spec.md",
                &["# Login", "`req:login#1`", "", "Needs: impl:login#1"],
            ),
            ("login.ts", &["// [impl:login#1]"]),
        ],
    );
    let default_run = run(&project, &[]);
    assert_eq!(default_run.status.code(), Some(0));
    assert!(!stdout(&default_run).contains("req:login#1"));

    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(0));
    let text = stdout(&result);
    assert!(text.contains("\u{2714} req:login#1 \"Login\"  spec.md:2  [deep-covered]"));
    assert!(text.contains("needs impl:login#1  \u{2714} login.ts:1"));
    assert!(text.contains("wanted by req:login#1  spec.md:2"));
    assert!(text.trim_end().ends_with("ok"));
}

#[test]
fn verbose_resolves_a_wildcard_need_and_shows_every_matched_revision() {
    let project = with_project(
        "verbose-wildcard",
        &[
            ("spec.md", &["`req:login#1`", "", "Needs: impl:login#2.x"]),
            ("login.ts", &["// [impl:login#2.4]", "// [impl:login#2.5]"]),
        ],
    );
    let result = run(&project, &["--verbose"]);
    assert_eq!(result.status.code(), Some(0));
    let text = stdout(&result);
    assert!(text.contains("needs impl:login#2.x (\u{2192} impl:login#2.4)  \u{2714} login.ts:1"));
    assert!(text.contains("needs impl:login#2.x (\u{2192} impl:login#2.5)  \u{2714} login.ts:2"));
}

// req:a is ok through req:b, whose own need is missing
const SHALLOW_CHAIN_SPEC: &[&str] = &[
    "`req:a#1`",
    "",
    "Needs: req:b#1",
    "",
    "`req:b#1`",
    "",
    "Needs: impl:missing#1",
];

#[test]
fn verbose_honors_the_tag_filter_leaving_filtered_out_items_absent() {
    let project = with_project(
        "verbose-tags",
        &[
            (
                "spec.md",
                &[
                    "# A",
                    "`req:a#1`",
                    "",
                    "Needs: impl:a#1",
                    "Tags: Auth",
                    "",
                    "# B",
                    "`req:b#1`",
                    "",
                    "Needs: impl:a#1",
                    "Tags: Other",
                ],
            ),
            ("a.ts", &["// [impl:a#1]"]),
        ],
    );
    let result = run(&project, &["-v", "-t", "Auth"]);
    assert_eq!(result.status.code(), Some(0));
    let text = stdout(&result);
    assert!(text.contains("\u{2714} req:a#1 \"A\"  spec.md:2  [deep-covered]"));
    assert!(text.contains("needs impl:a#1  \u{2714} a.ts:1"));
    assert!(!text.contains("req:b#1"), "{text}");
    // req:a and impl:a; req:b is filtered out
    assert!(
        text.contains("items       2  (1 from specs, 1 from code)"),
        "{text}"
    );
}

#[test]
fn verbose_renders_a_forwarding_source_as_an_arrow_edge_to_its_target() {
    let project = with_project(
        "verbose-forwarding",
        &[(
            "spec.md",
            &[
                "`req:login#1`",
                "",
                "`[req:login#1 --> dsn:auth#2]`",
                "",
                "`dsn:auth#2`",
            ],
        )],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(0));
    let text = stdout(&result);
    assert!(text.contains("\u{2714} req:login#1  spec.md:1  [deep-covered]"));
    assert!(text.contains("\u{2192} dsn:auth#2  \u{2714} spec.md:5"));
}

#[test]
fn verbose_marks_a_forwarding_to_a_nonexistent_target_as_missing() {
    let project = with_project(
        "verbose-forwarding-missing",
        &[("spec.md", &["`req:a#1`", "", "`[req:a#1 --> dsn:gone#1]`"])],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(1));
    let text = stdout(&result);
    assert!(text.contains("\u{2718} req:a#1  spec.md:1  [defective]"));
    assert!(text.contains("\u{2192} dsn:gone#1  \u{2718} missing"));
    assert!(text.contains("uncovered: forwards to dsn:gone#1"));
}

#[test]
fn verbose_shows_a_forwarding_edge_with_the_target_s_own_status_mark() {
    // dsn:auth#2 exists but is itself shallow (its need is defective), so the
    // source is shallow and its arrow edge shows ~, not a bare check mark
    let project = with_project(
        "verbose-forwarding-shallow",
        &[(
            "spec.md",
            &[
                "`req:login#1`",
                "",
                "`[req:login#1 --> dsn:auth#2]`",
                "",
                "`dsn:auth#2`",
                "",
                "Needs: dsn:auth#3",
                "",
                "`dsn:auth#3`",
                "",
                "Needs: impl:missing#1",
            ],
        )],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(1));
    let text = stdout(&result);
    assert!(text.contains("~ req:login#1  spec.md:1  [shallow-covered]"));
    assert!(text.contains("\u{2192} dsn:auth#2  ~ spec.md:5"));
}

#[test]
fn verbose_shows_a_code_item_s_need_on_a_markdown_target_as_wanted_by() {
    let project = with_project(
        "verbose-code-need",
        &[
            (
                "spec.md",
                &["`req:top#1`", "", "Needs: impl:a#1", "", "`dsn:spec#1`"],
            ),
            ("login.ts", &["// [impl:a#1]", "// [>>dsn:spec#1]"]),
        ],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(0));
    assert!(stdout(&result).contains(
        "\u{2714} dsn:spec#1  spec.md:5  [deep-covered]\n    wanted by impl:a#1  login.ts:1"
    ));
}

#[test]
fn verbose_lists_covers_edges_valid_or_missing() {
    let project = with_project(
        "verbose-covers",
        &[
            (
                "spec.md",
                &[
                    "`req:parent#1`",
                    "",
                    "Needs: req:child#1",
                    "",
                    "`req:child#1`",
                    "",
                    "Needs: impl:c#1",
                    "Covers: req:parent#1, req:gone#1",
                ],
            ),
            ("c.ts", &["// [impl:c#1]"]),
        ],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(1));
    let text = stdout(&result);
    assert!(text.contains("covers req:parent#1  \u{2714} spec.md:1"));
    assert!(text.contains("covers req:gone#1  \u{2718} missing"));
    assert!(text.contains("orphaned: covers req:gone#1"));
}

#[test]
fn verbose_lists_a_forwarding_source_s_own_covers_alongside_its_arrow_edge() {
    // forwarding excuses the source's needs but not its Covers, which stay
    // checked and still appear as edges in the verbose report
    let project = with_project(
        "verbose-forwarding-covers",
        &[(
            "spec.md",
            &[
                "`req:base#1`",
                "",
                "Needs: req:src#1",
                "",
                "`req:src#1`",
                "",
                "Covers: req:base#1",
                "",
                "`[req:src#1 --> dsn:tgt#1]`",
                "",
                "`dsn:tgt#1`",
            ],
        )],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(0));
    let text = stdout(&result);
    assert!(text.contains("\u{2192} dsn:tgt#1  \u{2714} spec.md:11"));
    assert!(text.contains("covers req:base#1  \u{2714} spec.md:1"));
}

#[test]
fn verbose_marks_an_item_with_a_defective_downstream_chain_as_shallow_covered() {
    let project = with_project("verbose-shallow", &[("spec.md", SHALLOW_CHAIN_SPEC)]);
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(1));
    let text = stdout(&result);
    assert!(text.contains("~ req:a#1  spec.md:1  [shallow-covered]"));
    // the need edge carries a's obligation, so it shows b's own (defective)
    // mark - the broken chain is diagnosable without scanning the whole report
    assert!(text.contains("needs req:b#1  \u{2718} spec.md:5"));
    assert!(text.contains("\u{2718} req:b#1  spec.md:5  [defective]"));
}

#[test]
fn the_summary_splits_the_ok_count_into_deep_and_shallow_covered_items() {
    let project = with_project("summary-split", &[("spec.md", SHALLOW_CHAIN_SPEC)]);
    let result = run(&project, &[]);
    assert!(stdout(&result).contains("ok          1  (0 deep-covered, 1 only shallow-covered)"));
}

#[test]
fn the_summary_omits_the_coverage_breakdown_when_no_item_is_shallow_covered() {
    let project = with_project("summary-plain", &[("spec.md", &["`req:a#1`"])]);
    let result = run(&project, &[]);
    assert_eq!(result.status.code(), Some(0));
    let text = stdout(&result);
    assert!(text.contains("ok          1\n"), "{text}");
    assert!(!text.contains("deep-covered"), "{text}");
}

#[test]
fn verbose_still_renders_parse_problems() {
    let project = with_project("verbose-problems", &[("orphan.ts", &["// [>>utest:a#1]"])]);
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(1));
    let text = stdout(&result);
    let problem = text
        .lines()
        .find(|line| line.contains("no preceding item tag"))
        .expect("the parse problem is rendered");
    assert!(problem.trim_start().starts_with('\u{26A0}'), "{problem}");
    assert!(text.contains("problems    1\n"), "{text}");
}

#[test]
fn verbose_keeps_defect_details_and_the_exit_code_of_a_defective_run() {
    let project = with_project(
        "verbose-defective",
        &[("spec.md", &["`req:login#1`", "", "Needs: impl:missing#1"])],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(1));
    let text = stdout(&result);
    assert!(text.contains("\u{2718} req:login#1  spec.md:1  [defective]"));
    assert!(text.contains("needs impl:missing#1  \u{2718} missing"));
    assert!(text.contains("uncovered: needs impl:missing#1"));
    assert!(text.trim_end().ends_with("not ok"));
}

#[test]
fn verbose_groups_items_by_file_then_line_with_a_blank_line_between_files() {
    let project = with_project(
        "verbose-groups",
        &[
            ("a.md", &["`req:one#1`", "", "", "", "`req:two#1`"]),
            ("b.md", &["`req:three#1`"]),
        ],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(0));
    let text = stdout(&result);
    let one = text.find("req:one#1").unwrap();
    let two = text.find("req:two#1").unwrap();
    let three = text.find("req:three#1").unwrap();
    assert!(one < two && two < three, "{text}");
    assert!(text.contains("req:two#1  a.md:5  [deep-covered]\n\n\u{2714} req:three#1"));
}

#[test]
fn git_ignored_files_are_excluded_outside_a_repository() {
    let project = with_project(
        "gitignore",
        &[
            (".gitignore", &["ignored.md"]),
            ("tracked.md", &["`req:good#1`"]),
            ("ignored.md", &["`req:bad#1`", "", "Needs: impl:missing#1"]),
        ],
    );
    let result = run(&project, &[]);
    assert_eq!(result.status.code(), Some(0), "{}", stdout(&result));
    assert!(!stdout(&result).contains("req:bad#1"));
}

const JSON_SPEC: &[&str] = &[
    "# Login",
    "`req:login#1`",
    "",
    "Needs: impl:login#1",
    "",
    "`req:legacy#1`",
    "",
    "`[req:legacy#1 --> req:login#1]`",
];

#[test]
fn json_prints_the_document_and_keeps_the_exit_code() {
    let project = with_project(
        "json",
        &[("spec.md", JSON_SPEC), ("login.ts", &["// [impl:login#1]"])],
    );
    let result = run(&project, &["--json"]);
    assert_eq!(result.status.code(), Some(0), "{}", stderr(&result));
    assert_eq!(stderr(&result), "");
    let text = stdout(&result);
    let document: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(document["ok"], serde_json::Value::Bool(true));
    assert_eq!(document["flashtrace"], env!("CARGO_PKG_VERSION"));
    assert!(text.ends_with("}\n")); // single trailing newline
    let items = document["items"].as_array().unwrap();
    assert!(items.iter().any(|item| item["id"] == "req:login#1"));
    for item in items {
        assert!(item.get("wantedBy").is_some());
    }
    let forwards: Vec<_> = document["forwards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|forward| {
            (
                forward["from"].clone(),
                forward["to"].clone(),
                forward["effective"].clone(),
            )
        })
        .collect();
    assert_eq!(
        forwards,
        [(
            "req:legacy#1".into(),
            "req:login#1".into(),
            serde_json::Value::Bool(true)
        )]
    );
}

#[test]
fn json_honors_the_tag_filter() {
    let project = with_project("json-tags", &[("spec.md", TAGS_SPEC)]);
    let result = run(&project, &["--json", "-t", "Auth"]);
    assert_eq!(result.status.code(), Some(0), "{}", stderr(&result));
    let document: serde_json::Value = serde_json::from_str(&stdout(&result)).unwrap();
    assert_eq!(document["summary"]["items"], 1);
    let items = document["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], "req:a#1");
}

#[test]
fn json_on_a_defective_project_exits_1_with_ok_false() {
    let project = with_project(
        "json-defective",
        &[("spec.md", &["`req:login#1`", "", "Needs: impl:missing#1"])],
    );
    let result = run(&project, &["--json"]);
    assert_eq!(result.status.code(), Some(1));
    let document: serde_json::Value = serde_json::from_str(&stdout(&result)).unwrap();
    assert_eq!(document["ok"], serde_json::Value::Bool(false));
    assert_eq!(document["summary"]["defectiveItems"], 1);
}

#[test]
fn format_json_produces_the_same_document_as_the_shorthand() {
    let project = with_project(
        "format-json",
        &[("spec.md", JSON_SPEC), ("login.ts", &["// [impl:login#1]"])],
    );
    let shorthand = run(&project, &["--json"]);
    for args in [
        vec!["-f", "json"],
        vec!["--format", "json"],
        vec!["--format=json"],
    ] {
        let result = run(&project, &args);
        assert_eq!(result.status.code(), Some(0), "{args:?}");
        assert_eq!(stdout(&result), stdout(&shorthand), "{args:?}");
    }
    // and text is the default
    let explicit = run(&project, &["-f", "text"]);
    assert_eq!(stdout(&explicit), stdout(&run(&project, &[])));
}

#[test]
fn usage_errors_reach_stderr_with_empty_stdout() {
    let project = with_project("usage", &[]);
    for (args, expected) in [
        (vec!["--json=pretty"], "option --json does not take a value"),
        (
            vec!["-f", "yaml"],
            "invalid value for -f: \"yaml\" (expected \"text\" or \"json\")",
        ),
        (vec!["--format"], "missing value for --format"),
        (
            vec!["--json", "-v"],
            "-v/--verbose applies to the text format only",
        ),
        (
            vec!["--json", "--format", "text"],
            "the report format is already selected by --json",
        ),
        (
            vec!["--json", "--format", "json"],
            "the report format is already selected by --json",
        ),
        (
            vec!["--json", "--json"],
            "the report format is already selected by --json",
        ),
    ] {
        let result = run(&project, &args);
        assert_eq!(result.status.code(), Some(2), "{args:?}");
        assert_eq!(stdout(&result), "", "{args:?}");
        assert!(
            stderr(&result).contains(expected),
            "{args:?}: {}",
            stderr(&result)
        );
    }
}

// the CLI writes synchronously and lets the process end on its own, so a
// document far beyond any pipe buffer arrives whole
#[test]
fn a_report_larger_than_the_pipe_buffer_is_written_whole() {
    const BIG_ITEM_COUNT: usize = 400;
    let mut spec: Vec<String> = Vec::new();
    let mut impl_lines: Vec<String> = Vec::new();
    for i in 0..BIG_ITEM_COUNT {
        spec.push(format!("# Requirement number {i} of an oversized report"));
        spec.push(format!("`req:item-{i}#1`"));
        spec.push(String::new());
        spec.push(format!("Needs: impl:item-{i}#1"));
        spec.push(String::new());
        impl_lines.push(format!("// [impl:item-{i}#1]"));
    }
    let spec_refs: Vec<&str> = spec.iter().map(String::as_str).collect();
    let impl_refs: Vec<&str> = impl_lines.iter().map(String::as_str).collect();
    let project = with_project(
        "big",
        &[
            ("spec.md", spec_refs.as_slice()),
            ("impl.ts", impl_refs.as_slice()),
        ],
    );
    let result = run(&project, &["--json"]);
    assert_eq!(result.status.code(), Some(0));
    assert!(
        result.stdout.len() > 65536,
        "too small to exercise the pipe: {}",
        result.stdout.len()
    );
    let document: serde_json::Value = serde_json::from_str(&stdout(&result)).unwrap();
    assert_eq!(
        document["items"].as_array().unwrap().len(),
        BIG_ITEM_COUNT * 2
    );
}

#[test]
fn a_leading_byte_order_mark_is_ignored() {
    let project = with_project("bom", &[("login.ts", &["// [impl:login#1]"])]);
    std::fs::write(
        project.0.join("spec.md"),
        b"\xEF\xBB\xBF`req:login#1`\n\nNeeds: impl:login#1\n",
    )
    .unwrap();
    let result = run(&project, &["--json"]);
    assert_eq!(result.status.code(), Some(0), "{}", stderr(&result));
    let document: serde_json::Value = serde_json::from_str(&stdout(&result)).unwrap();
    let item = document["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "req:login#1")
        .expect("the item on the first line is defined");
    // the mark is no character of line 1: the ID's backtick is column 1
    assert_eq!(item["line"], 1);
    assert_eq!(item["character"], 1);
}

#[test]
fn undecodable_bytes_are_replaced_rather_than_failing_the_run() {
    let project = with_project(
        "invalid-utf8",
        &[("spec.md", &["`req:login#1`", "", "Needs: impl:login#1"])],
    );
    std::fs::write(project.0.join("login.ts"), b"// caf\xE9 [impl:login#1]\n").unwrap();
    let result = run(&project, &[]);
    assert_eq!(result.status.code(), Some(0), "{}", stdout(&result));
    assert!(stdout(&result).ends_with("ok\n"));
}

fn write_project_file(project: &Project, path: &str, content: &str) {
    let path = project.0.join(path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

// Isolate ambient Git configuration in the child,
// without changing the test process's environment or requiring Git.
fn isolated_scan(project: &Project, args: &[&str]) -> Output {
    let configuration = project.0.join("configuration");
    std::fs::create_dir_all(&configuration).unwrap();
    Command::new(env!("CARGO_BIN_EXE_flashtrace"))
        .args(args)
        .current_dir(project.0.join("repository"))
        .env("HOME", &configuration)
        .env("USERPROFILE", &configuration)
        .env("XDG_CONFIG_HOME", &configuration)
        .env("PATH", "")
        .output()
        .unwrap()
}

fn scanned_items(output: &Output) -> Vec<String> {
    assert_eq!(output.status.code(), Some(0), "{}", stderr(output));
    assert_eq!(stderr(output), "");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let mut identifiers: Vec<String> = report["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_string())
        .collect();
    identifiers.sort();
    identifiers
}

#[test]
fn nested_parent_and_ignore_rules_apply_without_git() {
    let project = with_project("nested-ignore", &[]);
    write_project_file(&project, ".gitignore", "parent.ts\n");
    write_project_file(
        &project,
        "repository/.gitignore",
        "*.md\n!keep.md\n!child/\n",
    );
    write_project_file(&project, "repository/.ignore", "!override.md\n");
    write_project_file(
        &project,
        "repository/child/.gitignore",
        "!nested.md\nparent.md\n",
    );
    for (path, identifier) in [
        ("keep.md", "keep"),
        ("drop.md", "drop"),
        ("override.md", "override"),
        ("child/nested.md", "nested"),
        ("child/parent.md", "parent"),
    ] {
        write_project_file(
            &project,
            &format!("repository/{path}"),
            &format!("`req:{identifier}#1`"),
        );
    }
    write_project_file(
        &project,
        "repository/child/parent.ts",
        "// [req:excluded#1]",
    );
    assert_eq!(
        scanned_items(&isolated_scan(&project, &["--json"])),
        ["req:keep#1", "req:nested#1", "req:override#1"]
    );
    assert_eq!(
        scanned_items(&isolated_scan(&project, &["--json", "child"])),
        ["req:nested#1"]
    );
}

#[test]
fn metadata_is_excluded_but_hidden_content_is_scanned_and_inputs_are_deduplicated() {
    let project = with_project("hidden-ignore", &[]);
    for (path, identifier) in [
        (".git/internal.md", "metadata"),
        ("nested/.git/internal.md", "nestedmetadata"),
        (".github/workflows/spec.md", "workflow"),
        (".hidden.md", "hidden"),
        ("visible.md", "visible"),
    ] {
        write_project_file(
            &project,
            &format!("repository/{path}"),
            &format!("`req:{identifier}#1`"),
        );
    }
    assert_eq!(
        scanned_items(&isolated_scan(
            &project,
            &["--json", ".", ".github", "visible.md"]
        )),
        ["req:hidden#1", "req:visible#1", "req:workflow#1"]
    );
    assert!(scanned_items(&isolated_scan(&project, &["--json", ".git"])).is_empty());
}

#[test]
fn local_and_global_git_excludes_apply_without_a_git_executable() {
    let project = with_project("global-ignore", &[]);
    write_project_file(&project, "repository/.git/info/exclude", "local.md\n");
    write_project_file(&project, "configuration/git/ignore", "global.md\n");
    for name in ["local", "global", "keep"] {
        write_project_file(
            &project,
            &format!("repository/{name}.md"),
            &format!("`req:{name}#1`"),
        );
    }
    assert_eq!(
        scanned_items(&isolated_scan(&project, &["--json"])),
        ["req:keep#1"]
    );

    write_project_file(&project, "configuration/custom-ignore", "keep.md\n");
    let ignore_path = project
        .0
        .join("configuration/custom-ignore")
        .to_string_lossy()
        .replace('\\', "/");
    write_project_file(
        &project,
        "configuration/.gitconfig",
        &format!("[core]\nexcludesFile = \"{ignore_path}\"\n"),
    );
    assert_eq!(
        scanned_items(&isolated_scan(&project, &["--json"])),
        ["req:global#1"]
    );
}

#[test]
fn explicit_files_bypass_ignore_rules_but_still_require_supported_extensions() {
    let project = with_project("explicit-ignore", &[]);
    write_project_file(&project, "repository/.gitignore", "*.md\n");
    write_project_file(&project, "repository/.ignore", "*.ts\n");
    write_project_file(
        &project,
        "repository/ignored.md",
        "`req:explicit#1`\n\nNeeds: req:code#1",
    );
    write_project_file(&project, "repository/ignored.ts", "// [req:code#1]");
    write_project_file(
        &project,
        "repository/ignored.unknown",
        "`req:unsupported#1`",
    );
    assert!(scanned_items(&isolated_scan(&project, &["--json"])).is_empty());
    assert_eq!(
        scanned_items(&isolated_scan(
            &project,
            &["--json", "ignored.md", "ignored.ts", "ignored.unknown"]
        )),
        ["req:code#1", "req:explicit#1"]
    );
}
