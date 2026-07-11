import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { UsageError } from './errors.mjs';
import { MD_EXT, collectFiles } from './files.mjs';
import { parseMarkdown } from './parse-markdown.mjs';
import { parseCode } from './parse-code.mjs';
import { analyze } from './analyze.mjs';
import { report } from './report.mjs';

const HELP = `Usage: flashtrace [options] [directory-or-file ...]

Traces requirement coverage between Markdown specifications and source code
(.ts, .js, .mjs, .sql, .vue). Defaults to the current directory. Files ignored
by git are excluded.

Options:
  -t, --tags <t1,t2,...>   only import markdown items carrying one of these
                           tags; add "_" to also include untagged items
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones
  -V, --version            print the version number
  -h, --help               show this help

Exit codes: 0 clean, 1 defects or problems found, 2 usage error`;

// The version lives only in package.json: the release workflow bumps it there
// after dist/ is built, so it must be read at runtime rather than baked into
// the bundle (which would also let esbuild inline it). Both src/cli.mjs and
// dist/flashtrace.mjs sit one level below the package root.
function packageVersion() {
  const pkg = new URL('../package.json', import.meta.url);
  return JSON.parse(readFileSync(pkg, 'utf8')).version;
}

function parseArgs(argv) {
  const opts = { dirs: [], tags: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '-v' || a === '--verbose') {
      opts.verbose = true;
    } else if (a === '-V' || a === '--version') {
      console.log(packageVersion());
      process.exit(0);
    } else if (a === '-t' || a === '--tags') {
      const v = argv[++i];
      if (!v) throw new UsageError(`missing value for ${a}`);
      opts.tags = v.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('-')) {
      throw new UsageError(`unknown option: ${a}`);
    } else {
      opts.dirs.push(a);
    }
  }
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
      ...(MD_EXT.has(ext)
        ? parseMarkdown(file, text, problems, forwards)
        : parseCode(file, text, problems, forwards)),
    );
  }

  if (opts.tags) {
    const wantUntagged = opts.tags.includes('_');
    items = items.filter(
      (it) =>
        it.origin === 'code' ||
        it.tags.some((t) => opts.tags.includes(t)) ||
        (wantUntagged && it.tags.length === 0),
    );
  }

  analyze(items, forwards, problems);
  const clean = report(items, problems, process.cwd(), { verbose: opts.verbose });
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
