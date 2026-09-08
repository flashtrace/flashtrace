/*
 * Process-level CLI suite: every case spawns the built binary in a temp
 * project and asserts stdout, stderr and the exit code.
 */

use std::path::PathBuf;
use std::process::{Command, Output};

use flashtrace::files::find_git;

struct Project(PathBuf);

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn with_project(name: &str, files: &[(&str, &[&str])]) -> Project {
    let process_id = std::process::id();
    let dir = std::env::temp_dir().join(format!("flashtrace-cli-{name}-{process_id}"));
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
    let result = run(&project, &["-t", "Auth", "--tags=Other"]);
    assert_eq!(result.status.code(), Some(2));
    assert_eq!(stdout(&result), "");
    assert!(stderr(&result).contains("the tag filter is already selected by -t"));
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

#[test]
fn verbose_renders_forwarding_covers_and_shallow_marks() {
    let project = with_project(
        "verbose-edges",
        &[(
            "spec.md",
            &[
                "`req:a#1`",
                "",
                "Needs: req:b#1",
                "",
                "`req:b#1`",
                "",
                "Needs: impl:missing#1",
            ],
        )],
    );
    let result = run(&project, &["-v"]);
    assert_eq!(result.status.code(), Some(1));
    let text = stdout(&result);
    assert!(text.contains("~ req:a#1  spec.md:1  [shallow-covered]"));
    // the need edge carries a's obligation, so it shows b's own (defective)
    // mark - the broken chain is diagnosable without scanning the whole report
    assert!(text.contains("needs req:b#1  \u{2718} spec.md:5"));
    assert!(text.contains("\u{2718} req:b#1  spec.md:5  [defective]"));
    assert!(text.contains("ok          1  (0 deep-covered, 1 only shallow-covered)"));
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
fn git_ignored_files_are_excluded_from_the_scan() {
    let Some(git) = find_git() else {
        eprintln!("skipped: git not available in a fixed install location");
        return;
    };
    let project = with_project(
        "gitignore",
        &[
            (".gitignore", &["ignored.md"]),
            ("tracked.md", &["`req:good#1`"]),
            ("ignored.md", &["`req:bad#1`", "", "Needs: impl:missing#1"]),
        ],
    );
    let init = Command::new(git)
        .args(["init", "-q"])
        .current_dir(&project.0)
        .status()
        .unwrap();
    assert!(init.success());
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
    let forwards = document["forwards"].as_array().unwrap();
    assert_eq!(forwards.len(), 1);
    assert_eq!(forwards[0]["effective"], serde_json::Value::Bool(true));
    for item in document["items"].as_array().unwrap() {
        assert!(item.get("wantedBy").is_some());
    }
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
