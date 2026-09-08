/*
 * End-to-end suite: runs the built CLI over the example projects under
 * examples/ and compares full stdout byte-for-byte against the snapshot files
 * in tests/e2e-expect/. Each example is copied to a fresh temp directory first,
 * so the run is isolated from this repository's git metadata and file
 * collection uses the deterministic walk + sort path.
 *
 * Snapshots are generated from the actual CLI output, never written by hand:
 *   FLASHTRACE_UPDATE_SNAPSHOTS=1 cargo test --test e2e
 * then review the diff before committing.
 */

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;

use regex::Regex;

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

// one CLI run per row: example directory, arguments, expected exit code; the
// snapshot file is <example>.<variant>.txt
const CASES: &[(&str, &str, &[&str], i32)] = &[
    ("basic", "default", &[], 0),
    ("basic", "verbose", &["-v"], 0),
    ("basic", "json", &["--json"], 0),
    ("shortforms", "default", &[], 0),
    ("shortforms", "verbose", &["-v"], 0),
    ("shortforms", "json", &["--json"], 0),
    ("revisions-and-forwarding", "default", &[], 0),
    ("revisions-and-forwarding", "verbose", &["-v"], 0),
    ("revisions-and-forwarding", "json", &["--json"], 0),
    ("polyglot-web", "default", &[], 0),
    ("polyglot-web", "verbose", &["-v"], 0),
    ("polyglot-web", "tags", &["--tags", "web,data"], 0),
    ("polyglot-web", "json", &["--json"], 0),
    ("hyperglot", "default", &[], 0),
    ("hyperglot", "verbose", &["-v"], 0),
    ("hyperglot", "json", &["--json"], 0),
    ("multiplicity", "default", &[], 0),
    ("multiplicity", "verbose", &["-v"], 0),
    ("multiplicity", "json", &["--json"], 0),
    ("diagnostics", "default", &[], 1),
    ("diagnostics", "verbose", &["-v"], 1),
    ("diagnostics", "json", &["--json"], 1),
];

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

struct TempCopy(PathBuf);

impl Drop for TempCopy {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn temp_copy(example: &str) -> TempCopy {
    let process_id = std::process::id();
    let dir = std::env::temp_dir().join(format!("flashtrace-e2e-{example}-{process_id}"));
    let _ = std::fs::remove_dir_all(&dir);
    copy_tree(&repo_path("examples").join(example), &dir);
    TempCopy(dir)
}

// Windows runs print backslash paths (e.g. tests\store.test.ts); normalize so
// both platforms assert against the same snapshot files. The JSON report's
// `flashtrace` version is provenance only and bumps every release, so pin it
// to a placeholder rather than re-snapshot on each bump.
static VERSION_FIELD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)^(  "flashtrace": ")[^"]*""#).unwrap());

fn normalize(output: &str) -> String {
    VERSION_FIELD_RE
        .replace(&output.replace('\\', "/"), "${1}<version>\"")
        .into_owned()
}

fn first_difference(expected: &str, actual: &str) -> String {
    let expected_lines: Vec<&str> = expected.split('\n').collect();
    let actual_lines: Vec<&str> = actual.split('\n').collect();
    for i in 0..expected_lines.len().max(actual_lines.len()) {
        if expected_lines.get(i) != actual_lines.get(i) {
            let line = i + 1;
            let expected_line = expected_lines
                .get(i)
                .copied()
                .unwrap_or("<end of snapshot>");
            let actual_line = actual_lines.get(i).copied().unwrap_or("<end of output>");
            return format!(
                "first difference at line {line}:\n  expected: {expected_line:?}\n  actual:   {actual_line:?}"
            );
        }
    }
    "outputs are equal".to_string()
}

#[test]
fn every_example_output_matches_its_snapshot() {
    let update = std::env::var_os("FLASHTRACE_UPDATE_SNAPSHOTS").is_some_and(|value| value == "1");
    for (example, variant, args, status) in CASES {
        let copy = temp_copy(example);
        let output = Command::new(env!("CARGO_BIN_EXE_flashtrace"))
            .args(*args)
            .current_dir(&copy.0)
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert_eq!(
            stderr, "",
            "{example} ({variant}): unexpected stderr: {stderr}"
        );
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        assert_eq!(
            output.status.code(),
            Some(*status),
            "{example} ({variant}): exit code mismatch, stdout:\n{stdout}"
        );

        let actual = normalize(&stdout);
        let file = repo_path("tests/e2e-expect").join(format!("{example}.{variant}.txt"));
        if update {
            std::fs::write(&file, &actual).unwrap();
        }
        let expected = std::fs::read_to_string(&file).unwrap();
        assert_eq!(
            actual,
            expected,
            "{example} ({variant}): output does not match snapshot\n{}",
            first_difference(&expected, &actual)
        );
    }
}
