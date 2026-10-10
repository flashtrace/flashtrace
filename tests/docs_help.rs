/*
 * Docs drift guard: docs/command-line.md shows the help text, and that copy
 * must stay byte-identical to what `flashtrace --help` prints.
 *
 * The copy is the first fenced block below the "# Command line" heading, with
 * no other heading in between. Anything else - heading missing, block missing,
 * block unterminated - fails the test instead of passing vacuously.
 * .gitattributes forces LF for the file, so the comparison is byte-exact on
 * autocrlf checkouts too.
 */

use std::path::Path;
use std::process::Command;

const DOCS_FILE: &str = "docs/command-line.md";
const HEADING: &str = "# Command line";
const FENCE: &str = "```";

// The lines of the first fenced block below HEADING, as one LF-terminated text.
fn help_block(markdown: &str) -> String {
    let mut lines = markdown.split('\n');
    lines
        .by_ref()
        .find(|line| *line == HEADING)
        .unwrap_or_else(|| panic!("{DOCS_FILE}: heading {HEADING:?} not found"));
    for line in lines.by_ref() {
        if line == FENCE {
            break;
        }
        assert!(
            !line.starts_with('#'),
            "{DOCS_FILE}: no fenced block between {HEADING:?} and the next heading {line:?}"
        );
    }
    let mut block = String::new();
    for line in lines {
        if line == FENCE {
            return block;
        }
        block.push_str(line);
        block.push('\n');
    }
    panic!("{DOCS_FILE}: no fenced block below {HEADING:?}, or it is never closed");
}

#[test]
fn command_line_docs_show_the_help_text_verbatim() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(DOCS_FILE);
    let markdown = std::fs::read_to_string(&path).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_flashtrace"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert_eq!(
        help_block(&markdown),
        help,
        "{DOCS_FILE} must show `flashtrace --help` byte for byte; paste its output into the block"
    );
}
