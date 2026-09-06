/*
 * Argument parsing, help text and the main flow.
 *
 * Exit behavior: --help, --version and the usage-error path write their
 * fixed strings, flush, and exit right away; the success path computes the
 * exit code and lets the process end on its own after everything is written
 * (print_line writes synchronously, so nothing can be left behind in a
 * pipe). A file that cannot be read ends the run with exit code 2 and the
 * error on stderr.
 *
 * Input files are UTF-8: a leading byte-order mark is ignored, and bytes
 * that do not decode become U+FFFD rather than failing the run - IDs are
 * ASCII, so a damaged line still traces where it can.
 */

use std::collections::HashMap;
use std::io::Write;
use std::process::ExitCode;

use crate::analyze::analyze;
use crate::errors::UsageError;
use crate::files::collect_files;
use crate::ids::{Forward, Item};
use crate::parse_code::parse_code;
use crate::parse_spec::spec_parser_for;
use crate::paths::extension_of;
use crate::report::report;
use crate::report_json::report_json;

const HELP: &str = "Usage: flashtrace [options] [directory-or-file ...]

Traces requirement coverage between Markdown specifications and source code
(.ts, .js, .mjs, .sql, .vue). Defaults to the current directory. Files ignored
by git are excluded.

Options:
  -t, --tags <t1,t2,...>   only import spec items carrying one of these
                           tags; add \"_\" to also include untagged items
  -f, --format <format>    report format: \"text\" (default) or \"json\"; --json
                           is shorthand for --format json
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones; text format only
  -V, --version            print the version number
  -h, --help               show this help

Long options also accept \"=\"-attached values, e.g. --tags=a,b.
The report format and the tag filter may each be selected only once.

Exit codes: 0 clean, 1 defects or problems found, 2 usage error";

// Both of these end the run mid-parse, which is what stops the parser from
// reading the rest of the arguments. Exiting here is safe where it is not at
// the end of the main flow: each prints a fixed string far below the buffer
// of any pipe, so there is nothing left buffered to lose.
fn print_help_and_exit() -> ! {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(HELP.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
    std::process::exit(0)
}

fn print_version_and_exit() -> ! {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(env!("CARGO_PKG_VERSION").as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
    std::process::exit(0)
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Format {
    Text,
    Json,
}

#[derive(Debug)]
struct Options {
    dirs: Vec<String>,
    tags: Option<Vec<String>>,
    verbose: bool,
    format: Format,
    // A setting is selected at most once, whichever spelling does it.
    // Rejecting a second selection outright - rather than letting the last
    // one win, or comparing the two values - keeps one rule to state and to
    // rely on: a command line that names the same setting twice is a mistake
    // worth surfacing, and the error names the option to drop. selected_by
    // remembers the option that made each selection, so the second one can
    // name the first.
    selected_by: HashMap<&'static str, String>,
}

fn select_once(
    options: &mut Options,
    raw: &str,
    setting: &'static str,
    subject: &str,
) -> Result<(), UsageError> {
    if let Some(selected_by) = options.selected_by.get(setting) {
        return Err(UsageError(format!(
            "{subject} is already selected by {selected_by}"
        )));
    }
    options.selected_by.insert(setting, raw.to_string());
    Ok(())
}

fn select_format(options: &mut Options, raw: &str, format: Format) -> Result<(), UsageError> {
    select_once(options, raw, "format", "the report format")?;
    options.format = format;
    Ok(())
}

fn report_format(raw: &str, value: &str) -> Result<Format, UsageError> {
    match value {
        "text" => Ok(Format::Text),
        "json" => Ok(Format::Json),
        _ => Err(UsageError(format!(
            "invalid value for {raw}: \"{value}\" (expected \"text\" or \"json\")"
        ))),
    }
}

// short option to its long spelling, so the parser compares one name per option
fn long_alias(raw: &str) -> &str {
    match raw {
        "-h" => "--help",
        "-v" => "--verbose",
        "-V" => "--version",
        "-t" => "--tags",
        "-f" => "--format",
        _ => raw,
    }
}

// a long option splits at the first "=" into name and attached value; short
// options keep POSIX semantics and never carry one
fn split_long_option(token: &str) -> (&str, Option<&str>) {
    if token.starts_with("--")
        && let Some(equals_index) = token.find('=')
    {
        return (&token[..equals_index], Some(&token[equals_index + 1..]));
    }
    (token, None)
}

fn reject_value(name: &str, inline: Option<&str>) -> Result<(), UsageError> {
    if inline.is_some() {
        return Err(UsageError(format!("option {name} does not take a value")));
    }
    Ok(())
}

fn parse_args(argv: &[String]) -> Result<Options, UsageError> {
    let mut options = Options {
        dirs: Vec::new(),
        tags: None,
        verbose: false,
        format: Format::Text,
        selected_by: HashMap::new(),
    };
    let mut i = 0;
    while i < argv.len() {
        let (raw, inline) = split_long_option(&argv[i]);
        let name = long_alias(raw);
        match name {
            "--help" => {
                reject_value(raw, inline)?;
                print_help_and_exit();
            }
            "--version" => {
                reject_value(raw, inline)?;
                print_version_and_exit();
            }
            "--verbose" => {
                reject_value(raw, inline)?;
                options.verbose = true;
            }
            "--json" => {
                reject_value(raw, inline)?;
                select_format(&mut options, raw, Format::Json)?;
            }
            "--format" | "--tags" => {
                let value = match inline {
                    Some(inline) => inline.to_string(),
                    None => {
                        i += 1;
                        argv.get(i).cloned().unwrap_or_default()
                    }
                };
                if value.is_empty() {
                    return Err(UsageError(format!("missing value for {raw}")));
                }
                if name == "--format" {
                    let format = report_format(raw, &value)?;
                    select_format(&mut options, raw, format)?;
                } else {
                    select_once(&mut options, raw, "tags", "the tag filter")?;
                    options.tags = Some(
                        value
                            .split(',')
                            .map(str::trim)
                            .filter(|tag| !tag.is_empty())
                            .map(str::to_string)
                            .collect(),
                    );
                }
            }
            _ if raw.starts_with('-') => {
                return Err(UsageError(format!("unknown option: {raw}")));
            }
            _ => {
                options.dirs.push(raw.to_string());
            }
        }
        i += 1;
    }
    // -v selects which items the plain-text report lists; the JSON document
    // always carries them all, leaving it nothing to act on
    if options.format == Format::Json && options.verbose {
        return Err(UsageError(
            "-v/--verbose applies to the text format only".to_string(),
        ));
    }
    if options.dirs.is_empty() {
        options.dirs.push(".".to_string());
    }
    Ok(options)
}

// the text of an input file: UTF-8 decoded leniently (undecodable bytes
// become U+FFFD), with a leading byte-order mark dropped so line 1 starts at
// its first real character
fn decode(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.strip_prefix('\u{feff}').unwrap_or(&text).to_string()
}

fn main_flow(options: &Options) -> Result<bool, UsageError> {
    let files = collect_files(&options.dirs)?;
    let mut problems = Vec::new();
    let mut forwards: Vec<Forward> = Vec::new();
    let mut items: Vec<Item> = Vec::new();

    for file in &files {
        let bytes = std::fs::read(file)
            .map_err(|error| UsageError(format!("cannot read {file}: {error}")))?;
        let text = decode(&bytes);
        let ext = extension_of(file);
        // a file has one role: its spec parser when the format has one, the
        // code tag scanner otherwise
        let parse = spec_parser_for(&ext).unwrap_or(parse_code as _);
        items.extend(parse(file, &text, &mut problems, &mut forwards));
    }

    if let Some(tags) = &options.tags {
        let want_untagged = tags.iter().any(|tag| tag == "_");
        items.retain(|item| {
            item.origin == crate::ids::Origin::Code
                || item.tags.iter().any(|tag| tags.contains(tag))
                || (want_untagged && item.tags.is_empty())
        });
    }

    analyze(&mut items, &mut forwards, &mut problems);
    let cwd = std::env::current_dir().expect("the process has a working directory");
    let clean = match options.format {
        Format::Json => report_json(
            &items,
            &forwards,
            &problems,
            &cwd,
            env!("CARGO_PKG_VERSION"),
        ),
        Format::Text => report(&items, &problems, &cwd, options.verbose),
    };
    Ok(clean)
}

/// Run the CLI: parse, trace, report. Returns the process exit code; a usage
/// error prints `error: <message>` and the help text to stderr and exits 2
/// right here.
pub fn run_cli() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let result = parse_args(&argv).and_then(|options| main_flow(&options));
    match result {
        Ok(clean) => {
            // Set the code and let the process end on its own: everything is
            // already written synchronously, so nothing is left to lose.
            if clean {
                ExitCode::from(0)
            } else {
                ExitCode::from(1)
            }
        }
        Err(usage_error) => {
            let mut err = std::io::stderr().lock();
            let _ = write!(err, "error: {usage_error}\n\n{HELP}\n");
            let _ = err.flush();
            std::process::exit(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|argument| argument.to_string()).collect()
    }

    #[test]
    fn defaults_to_the_current_directory_and_the_text_format() {
        let options = parse_args(&args(&[])).unwrap();
        assert_eq!(options.dirs, ["."]);
        assert_eq!(options.format, Format::Text);
        assert!(!options.verbose);
        assert_eq!(options.tags, None);
    }

    #[test]
    fn positional_arguments_become_input_paths() {
        let options = parse_args(&args(&["docs", "src"])).unwrap();
        assert_eq!(options.dirs, ["docs", "src"]);
    }

    #[test]
    fn the_tag_filter_splits_trims_and_drops_empty_segments() {
        let options = parse_args(&args(&["--tags", "Auth , _,,B,"])).unwrap();
        assert_eq!(options.tags.unwrap(), ["Auth", "_", "B"]);
    }

    #[test]
    fn an_equals_attached_value_splits_at_the_first_equals_only() {
        let options = parse_args(&args(&["--tags=a=b"])).unwrap();
        assert_eq!(options.tags.unwrap(), ["a=b"]);
    }

    #[test]
    fn an_empty_value_is_missing_in_either_spelling() {
        for list in [vec!["--tags="], vec!["--tags"], vec!["--format"]] {
            let error = parse_args(&args(&list)).unwrap_err();
            assert!(
                error.0.starts_with("missing value for "),
                "{list:?}: {error}"
            );
        }
    }

    #[test]
    fn selecting_a_setting_twice_names_the_first_spelling() {
        let cases: [(&[&str], &str); 5] = [
            (
                &["-t", "a", "-t", "b"],
                "the tag filter is already selected by -t",
            ),
            (
                &["--tags", "a", "-t", "b"],
                "the tag filter is already selected by --tags",
            ),
            (
                &["--json", "--format", "text"],
                "the report format is already selected by --json",
            ),
            (
                &["--format", "text", "--json"],
                "the report format is already selected by --format",
            ),
            (
                &["-f", "json", "--format=text"],
                "the report format is already selected by -f",
            ),
        ];
        for (list, expected) in cases {
            let error = parse_args(&args(list)).unwrap_err();
            assert_eq!(error.0, expected, "{list:?}");
        }
    }

    #[test]
    fn a_valueless_option_rejects_an_equals_attached_value() {
        let error = parse_args(&args(&["--verbose=1"])).unwrap_err();
        assert_eq!(error.0, "option --verbose does not take a value");
        let error = parse_args(&args(&["--json=pretty"])).unwrap_err();
        assert_eq!(error.0, "option --json does not take a value");
    }

    #[test]
    fn unknown_options_are_reported_by_name_without_the_value() {
        let error = parse_args(&args(&["--frobnicate=x"])).unwrap_err();
        assert_eq!(error.0, "unknown option: --frobnicate");
        // short options never carry "=", so the whole token is unknown
        let error = parse_args(&args(&["-t=a,b"])).unwrap_err();
        assert_eq!(error.0, "unknown option: -t=a,b");
    }

    #[test]
    fn an_unknown_format_names_the_selecting_spelling() {
        let error = parse_args(&args(&["-f", "yaml"])).unwrap_err();
        assert_eq!(
            error.0,
            "invalid value for -f: \"yaml\" (expected \"text\" or \"json\")"
        );
    }

    #[test]
    fn verbose_is_rejected_for_the_json_format_whichever_spelling_selects_it() {
        for list in [
            vec!["--json", "-v"],
            vec!["-v", "--json"],
            vec!["-f", "json", "--verbose"],
        ] {
            let error = parse_args(&args(&list)).unwrap_err();
            assert_eq!(
                error.0, "-v/--verbose applies to the text format only",
                "{list:?}"
            );
        }
    }

    #[test]
    fn the_format_may_still_be_selected_once_in_any_spelling() {
        for list in [
            vec!["--json"],
            vec!["-f", "json"],
            vec!["--format", "json"],
            vec!["--format=json"],
        ] {
            let options = parse_args(&args(&list)).unwrap();
            assert_eq!(options.format, Format::Json, "{list:?}");
        }
    }
}
