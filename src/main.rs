/*
 * flashtrace - lightweight requirement tracing for Markdown specs and source
 * code. The implementation lives in the library modules (see lib.rs); this
 * binary hands the process over to the command-line front end.
 *
 * Exit codes: 0 = clean trace, 1 = defects/problems found, 2 = usage error.
 */

use std::process::ExitCode;

fn main() -> ExitCode {
    flashtrace::cli::run_cli()
}
