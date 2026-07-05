#!/usr/bin/env node
/**
 * flashtrace - lightweight requirement tracing for Markdown specs and source code.
 *
 * Entry point for the bundled dist/flashtrace.mjs; the implementation lives in:
 *   src/ids.mjs            item ID format, parsing and item construction
 *   src/files.mjs          gitignore-aware file collection
 *   src/parse-markdown.mjs Markdown item parser
 *   src/parse-code.mjs     comment-aware code tag scanner
 *   src/analyze.mjs        coverage analysis
 *   src/report.mjs         terminal report
 *   src/cli.mjs            argument parsing and main flow
 *
 * Exit codes: 0 = clean trace, 1 = defects/problems found, 2 = usage error.
 */

import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { runCli } from './cli.mjs';

export { UsageError } from './errors.mjs';
export { collectFiles } from './files.mjs';
export { parseMarkdown } from './parse-markdown.mjs';
export { parseCode } from './parse-code.mjs';
export { analyze } from './analyze.mjs';

const runAsCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsCli) runCli();
