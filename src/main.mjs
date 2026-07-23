#!/usr/bin/env node
/**
 * flashtrace - lightweight requirement tracing for Markdown specs and source code.
 *
 * Entry point for the bundled dist/flashtrace.mjs; the implementation lives in:
 *   src/ids.mjs            item ID format, parsing and item construction
 *   src/spec-items.mjs     item semantics shared by all specification formats
 *   src/files.mjs          gitignore-aware file collection
 *   src/parse-spec.mjs     spec parser per file extension
 *   src/parse-markdown.mjs Markdown item parser
 *   src/languages.mjs      comment grammar per file extension
 *   src/parse-code.mjs     comment-aware code tag scanner
 *   src/analyze.mjs        coverage analysis
 *   src/defects.mjs        the defects analysis can raise, one kind per condition
 *   src/report.mjs         terminal report
 *   src/cli.mjs            argument parsing and main flow
 *
 * Exit codes: 0 = clean trace, 1 = defects/problems found, 2 = usage error.
 */

import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runCli } from './cli.mjs';

export { UsageError } from './errors.mjs';
export { collectFiles } from './files.mjs';
export { parseMarkdown } from './parse-markdown.mjs';
export { parseCode } from './parse-code.mjs';
export { analyze } from './analyze.mjs';
export { DEFECT_KINDS } from './defects.mjs';
export { buildReportDocument, reportJson } from './report-json.mjs';

function runAsCli() {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    // Package managers (pnpm in particular) expose bins through symlinks, so
    // argv[1] may be a link while import.meta.url holds the real path (or the
    // link path under --preserve-symlinks-main). Realpath both sides.
    return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(argvPath).href;
  }
}

if (runAsCli()) runCli();
