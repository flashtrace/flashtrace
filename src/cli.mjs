import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { UsageError } from './errors.mjs';
import { collectFiles } from './files.mjs';
import { specParserFor } from './parse-spec.mjs';
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
  -f, --format <format>    report format: "text" (default) or "json"; --json
                           is shorthand for --format json
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones; text format only
  -V, --version            print the version number
  -h, --help               show this help

Long options also accept "="-attached values, e.g. --tags=a,b.
The report format and the tag filter may each be selected only once.

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

// A setting is selected at most once, whichever spelling does it. Rejecting a
// second selection outright - rather than letting the last one win, or
// comparing the two values - keeps one rule to state and to rely on: a command
// line that names the same setting twice is a mistake worth surfacing, and the
// error names the option to drop. opts.selectedBy remembers the option that
// made each selection, so the second one can name the first.
function selectOnce(opts, raw, setting, subject) {
  const selectedBy = opts.selectedBy.get(setting);
  if (selectedBy !== undefined)
    throw new UsageError(`${subject} is already selected by ${selectedBy}`);
  opts.selectedBy.set(setting, raw);
}

function selectFormat(opts, raw, format) {
  selectOnce(opts, raw, 'format', 'the report format');
  opts.format = format;
}

function reportFormat(raw, value) {
  if (value !== 'text' && value !== 'json')
    throw new UsageError(`invalid value for ${raw}: "${value}" (expected "text" or "json")`);
  return value;
}

// short option to its long spelling, so the parser compares one name per option
const LONG_ALIAS = {
  '-h': '--help',
  '-v': '--verbose',
  '-V': '--version',
  '-t': '--tags',
  '-f': '--format',
};

function printHelp() {
  console.log(HELP);
  process.exit(0);
}

function printVersion() {
  console.log(packageVersion());
  process.exit(0);
}

function enableVerbose(opts) {
  opts.verbose = true;
}

function selectJsonFormat(opts, raw) {
  selectFormat(opts, raw, 'json');
}

// every option that never carries a value, mapped to the effect it has on the
// parsed options; the printing ones end the process instead of returning
const VALUELESS_OPTIONS = new Map([
  ['--help', printHelp],
  ['--version', printVersion],
  ['--verbose', enableVerbose],
  ['--json', selectJsonFormat],
]);

function setFormat(opts, raw, value) {
  selectFormat(opts, raw, reportFormat(raw, value));
}

function setTags(opts, raw, value) {
  selectOnce(opts, raw, 'tags', 'the tag filter');
  opts.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

// every option that carries a value, either "="-attached or as the next
// argument, mapped to the effect it has on the parsed options
const VALUED_OPTIONS = new Map([
  ['--format', setFormat],
  ['--tags', setTags],
]);

function parseArgs(argv) {
  const opts = { dirs: [], tags: null, verbose: false, format: 'text', selectedBy: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const [raw, inline] = splitLongOption(argv[i]);
    const name = LONG_ALIAS[raw] ?? raw;
    const applyValuelessOption = VALUELESS_OPTIONS.get(name);
    const applyValuedOption = VALUED_OPTIONS.get(name);
    if (applyValuelessOption) {
      rejectValue(raw, inline);
      applyValuelessOption(opts, raw);
    } else if (applyValuedOption) {
      const value = inline ?? argv[++i];
      if (!value) throw new UsageError(`missing value for ${raw}`);
      applyValuedOption(opts, raw, value);
    } else if (raw.startsWith('-')) {
      throw new UsageError(`unknown option: ${raw}`);
    } else {
      opts.dirs.push(raw);
    }
  }
  // -v selects which items the plain-text report lists; the JSON document
  // always carries them all, leaving it nothing to act on
  if (opts.format === 'json' && opts.verbose)
    throw new UsageError('-v/--verbose applies to the text format only');
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
    // a file has one role: its spec parser when the format has one, the code
    // tag scanner otherwise
    const parse = specParserFor(ext) ?? parseCode;
    items.push(...parse(file, text, problems, forwards));
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
  const clean = opts.format === 'json'
    ? reportJson(items, forwards, problems, process.cwd(), { version: packageVersion() })
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
