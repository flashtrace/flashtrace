import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { UsageError } from './errors.mjs';
import { SPEC_EXT, collectFiles } from './files.mjs';
import { parseMarkdown } from './parse-markdown.mjs';
import { parseCode } from './parse-code.mjs';
import { analyze } from './analyze.mjs';
import { report } from './report.mjs';
import { reportJson } from './report-json.mjs';

const HELP = `Usage: flashtrace [options] [directory-or-file ...]

Traces requirement coverage between Markdown specifications and source code
(.ts, .js, .mjs, .sql, .vue). Defaults to the current directory. Files ignored
by git are excluded.

Options:
  -t, --tags <t1,t2,...>   only import spec items carrying one of these
                           tags; add "_" to also include untagged items
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones
      --json[=<mode>]      print the report as a JSON document; <mode> selects
                           "base" (default) or "rich" detail
  -V, --version            print the version number
  -h, --help               show this help

Long options also accept "="-attached values, e.g. --tags=a,b.

Exit codes: 0 clean, 1 defects or problems found, 2 usage error`;

// The version lives only in package.json: the release workflow bumps it there
// after dist/ is built, so it must be read at runtime rather than baked into
// the bundle (which would also let esbuild inline it). Both src/cli.mjs and
// dist/flashtrace.mjs sit one level below the package root.
function packageVersion() {
  const pkg = new URL('../package.json', import.meta.url);
  return JSON.parse(readFileSync(pkg, 'utf8')).version;
}

// a long option splits at the first "=" into name and attached value; short
// options keep POSIX semantics and never carry one
function splitLongOption(token) {
  const eqIndex = token.startsWith('--') ? token.indexOf('=') : -1;
  return eqIndex === -1 ? [token, undefined] : [token.slice(0, eqIndex), token.slice(eqIndex + 1)];
}

function rejectValue(name, inline) {
  if (inline !== undefined) throw new UsageError(`option ${name} does not take a value`);
}

// --json is shorthand for --json=base; detail is chosen by mode, not verbosity
function jsonMode(mode = 'base') {
  if (mode !== 'base' && mode !== 'rich')
    throw new UsageError(`invalid mode for --json: "${mode}" (expected "base" or "rich")`);
  return mode;
}

// short option to its long spelling, so the parser compares one name per option
const LONG_ALIAS = { '-h': '--help', '-v': '--verbose', '-V': '--version', '-t': '--tags' };

function parseArgs(argv) {
  const opts = { dirs: [], tags: null, verbose: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    const [raw, inline] = splitLongOption(argv[i]);
    const name = LONG_ALIAS[raw] ?? raw;
    if (name === '--help') {
      rejectValue(raw, inline);
      console.log(HELP);
      process.exit(0);
    } else if (name === '--version') {
      rejectValue(raw, inline);
      console.log(packageVersion());
      process.exit(0);
    } else if (name === '--verbose') {
      rejectValue(raw, inline);
      opts.verbose = true;
    } else if (name === '--json') {
      opts.json = jsonMode(inline);
    } else if (name === '--tags') {
      const value = inline ?? argv[++i];
      if (!value) throw new UsageError(`missing value for ${raw}`);
      opts.tags = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (raw.startsWith('-')) {
      throw new UsageError(`unknown option: ${raw}`);
    } else {
      opts.dirs.push(raw);
    }
  }
  // JSON detail is selected by mode, not by verbosity, so the two are exclusive
  if (opts.json && opts.verbose)
    throw new UsageError('--json cannot be combined with -v/--verbose');
  if (opts.dirs.length === 0) opts.dirs.push('.');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = await collectFiles(opts.dirs);
  const problems = [];
  const forwards = [];
  let items = [];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const ext = path.extname(file).toLowerCase();
    items.push(
      ...(SPEC_EXT.has(ext)
        ? parseMarkdown(file, text, problems, forwards)
        : parseCode(file, text, problems, forwards)),
    );
  }

  if (opts.tags) {
    const wantUntagged = opts.tags.includes('_');
    items = items.filter(
      (item) =>
        item.origin === 'code' ||
        item.tags.some((tag) => opts.tags.includes(tag)) ||
        (wantUntagged && item.tags.length === 0),
    );
  }

  analyze(items, forwards, problems);
  const clean = opts.json
    ? reportJson(items, forwards, problems, process.cwd(), { mode: opts.json, version: packageVersion() })
    : report(items, problems, process.cwd(), { verbose: opts.verbose });
  process.exit(clean ? 0 : 1);
}

export function runCli() {
  main().catch((err) => {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}\n\n${HELP}`);
      process.exit(2);
    }
    console.error(err);
    process.exit(2);
  });
}
