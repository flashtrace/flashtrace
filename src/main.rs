/*
 * flashtrace - lightweight requirement tracing for Markdown specs and source
 * code. The implementation lives in the library modules (see lib.rs); this
 * binary hands the process over to the command-line front end.
 *
 * Exit codes: 0 = clean trace, 1 = defects/problems found, 2 = usage error.
 */

use std::process::ExitCode;

// The Linux binaries are built for musl, whose allocator serializes all
// threads on one lock and is slower than glibc's even on a single thread;
// mimalloc brings them to glibc speed and lets parallel work scale.
#[cfg(target_env = "musl")]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> ExitCode {
    flashtrace::cli::run_cli()
}
