#!/usr/bin/env node
/**
 * flashtrace - lightweight requirement tracing for Markdown specs and source code.
 *
 * Item ID format:  <type>:[<group>/]<name>#<revision>
 *   e.g.  req:auth/login#1   impl:whatever-other-name#2
 *
 * Markdown (.md, .markdown):
 *   - An item is defined by a line containing only its ID in backticks: `req:auth/login#1`
 *   - Title: the heading (#...) directly above the ID (only blank lines in between).
 *   - Description: the lines following the ID (one blank line directly under the
 *     ID is allowed) up to the next blank line.
 *   - Keywords "Needs:", "Covers:", "Tags:" — inline comma-separated or as a
 *     bullet list on the following lines. Needs/Covers list full, explicit IDs.
 *
 * Code (.ts, .js, .mjs, .sql, .vue):
 *   - `[<id>]` inside a comment defines a coverage item with that ID.
 *   - `[>><id>]` inside a comment attaches a need to the nearest preceding
 *     item tag in the same file (error if there is none).
 *
 * Files ignored by git are excluded (via `git ls-files`; plain directory walk
 * as fallback outside a git repository).
 *
 * Exit codes: 0 = clean trace, 1 = defects/problems found, 2 = usage error.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

/* ------------------------------------------------------------------ */
/* Constants & regexes                                                  */
/* ------------------------------------------------------------------ */

const MD_EXT = new Set(['.md', '.markdown']);
const CODE_EXT = new Set(['.ts', '.js', '.mjs', '.sql', '.vue']);

const ID_SRC =
  String.raw`([A-Za-z]+):(?:([A-Za-z][A-Za-z0-9_.-]*)\/)?([A-Za-z][A-Za-z0-9_.-]*)#(\d+)`;
const ID_RE = new RegExp(`^${ID_SRC}$`);
const DEF_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const KEYWORD_RE = /^(Needs|Covers|Tags):\s*(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*\S)\s*$/;
const TAG_RE = new RegExp(String.raw`\[(>>)?\s*${ID_SRC}\s*\]`, 'g');

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

const mkId = (type, group, name, rev) =>
  `${type}:${group ? group + '/' : ''}${name}#${rev}`;
const keyOf = (id) => id.slice(0, id.lastIndexOf('#'));
const revOf = (id) => Number(id.slice(id.lastIndexOf('#') + 1));

function parseIdEntry(raw) {
  const cleaned = raw.replace(/`/g, '').trim();
  const m = cleaned.match(ID_RE);
  return m ? mkId(m[1], m[2], m[3], m[4]) : null;
}

function newItem(id, origin, file, line) {
  return {
    id,
    key: keyOf(id),
    revision: revOf(id),
    origin, // 'markdown' | 'code'
    file,
    line,
    title: null,
    description: [],
    needs: [],
    covers: [],
    tags: [],
    defects: [],
  };
}

/* ------------------------------------------------------------------ */
/* File collection (gitignore-aware)                                    */
/* ------------------------------------------------------------------ */

async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

async function collectFiles(dirs) {
  const files = new Set();
  for (const dir of dirs) {
    const abs = path.resolve(dir);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new UsageError(`input path does not exist: ${dir}`);
    if (st.isFile()) {
      files.add(abs);
      continue;
    }
    let list = null;
    try {
      const out = execFileSync(
        'git',
        ['-C', abs, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      list = out.split('\0').filter(Boolean).map((f) => path.join(abs, f));
    } catch {
      list = await walk(abs, []); // not a git repo (or git missing)
    }
    for (const f of list) files.add(f);
  }
  return [...files]
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return MD_EXT.has(ext) || CODE_EXT.has(ext);
    })
    .sort();
}

/* ------------------------------------------------------------------ */
/* Markdown parser                                                      */
/* ------------------------------------------------------------------ */

function titleAbove(lines, defIndex) {
  for (let k = defIndex - 1; k >= 0; k--) {
    const l = lines[k];
    if (l.trim() === '') continue; // blank lines between heading and ID are fine
    const h = l.match(HEADING_RE);
    return h ? h[2] : null; // any other text directly above -> no title
  }
  return null;
}

function parseMarkdown(file, text, problems) {
  const lines = text.split(/\r?\n/);
  const items = [];
  const isBoundary = (l) => DEF_RE.test(l) || HEADING_RE.test(l);

  for (let i = 0; i < lines.length; i++) {
    const def = lines[i].match(DEF_RE);
    if (!def) continue;

    const item = newItem(mkId(def[1], def[2], def[3], def[4]), 'markdown', file, i + 1);
    item.title = titleAbove(lines, i);

    let j = i + 1;
    let descDone = false;
    while (j < lines.length && !isBoundary(lines[j])) {
      const line = lines[j];
      const kw = line.match(KEYWORD_RE);
      if (kw) {
        descDone = true;
        const kwLine = j + 1;
        const entries = [];
        if (kw[2].trim() !== '') {
          // one-line, comma-separated
          entries.push(...kw[2].split(',').map((s) => s.trim()).filter(Boolean));
        } else {
          // bullet list on the following lines
          while (j + 1 < lines.length) {
            const b = lines[j + 1].match(BULLET_RE);
            if (!b) break;
            entries.push(b[1].trim());
            j++;
          }
        }
        if (kw[1] === 'Tags') {
          item.tags.push(...entries);
        } else {
          for (const e of entries) {
            const id = parseIdEntry(e);
            if (id) item[kw[1] === 'Needs' ? 'needs' : 'covers'].push(id);
            else
              problems.push({
                file,
                line: kwLine,
                message: `invalid ID "${e}" in ${kw[1]}: list of ${item.id}`,
              });
          }
        }
      } else if (line.trim() === '') {
        if (item.description.length > 0) descDone = true;
        // a blank line directly under the ID (before the description) is allowed
      } else if (!descDone) {
        item.description.push(line.trim());
      }
      // anything after the description's terminating blank line is informative text
      j++;
    }
    items.push(item);
    i = j - 1;
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Code parser (comment-aware tag scanner)                              */
/* ------------------------------------------------------------------ */

function parseCode(file, text, problems) {
  const ext = path.extname(file).toLowerCase();
  const lines = text.split(/\r?\n/);
  const items = [];
  let last = null; // nearest preceding item tag in this file
  let block = null; // 'c' (/* */) | 'html' (<!-- -->)
  const lineMarkers = ext === '.sql' ? ['--'] : ['//'];
  const htmlBlocks = ext === '.vue';

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    let comment = '';
    let pos = 0;
    while (pos < s.length) {
      if (block === 'c' || block === 'html') {
        const closer = block === 'c' ? '*/' : '-->';
        const end = s.indexOf(closer, pos);
        if (end === -1) {
          comment += s.slice(pos) + ' ';
          pos = s.length;
        } else {
          comment += s.slice(pos, end) + ' ';
          pos = end + closer.length;
          block = null;
        }
      } else {
        let best = -1;
        let kind = null;
        let len = 0;
        for (const m of lineMarkers) {
          const idx = s.indexOf(m, pos);
          if (idx !== -1 && (best === -1 || idx < best)) {
            best = idx;
            kind = 'line';
            len = m.length;
          }
        }
        const cb = s.indexOf('/*', pos);
        if (cb !== -1 && (best === -1 || cb < best)) {
          best = cb;
          kind = 'c';
          len = 2;
        }
        if (htmlBlocks) {
          const hb = s.indexOf('<!--', pos);
          if (hb !== -1 && (best === -1 || hb < best)) {
            best = hb;
            kind = 'html';
            len = 4;
          }
        }
        if (best === -1) break;
        pos = best + len;
        if (kind === 'line') {
          comment += s.slice(pos) + ' ';
          pos = s.length;
        } else {
          block = kind;
        }
      }
    }

    for (const m of comment.matchAll(TAG_RE)) {
      const id = mkId(m[2], m[3], m[4], m[5]);
      if (m[1]) {
        // [>>...] need tag
        if (!last)
          problems.push({
            file,
            line: i + 1,
            message: `need tag [>>${id}] has no preceding item tag in this file`,
          });
        else last.needs.push(id);
      } else {
        last = newItem(id, 'code', file, i + 1);
        items.push(last);
      }
    }
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                             */
/* ------------------------------------------------------------------ */

function analyze(items) {
  const byId = new Map();
  const revsByKey = new Map();
  for (const it of items) {
    (byId.get(it.id) ?? byId.set(it.id, []).get(it.id)).push(it);
    (revsByKey.get(it.key) ?? revsByKey.set(it.key, new Set()).get(it.key)).add(it.revision);
  }
  const neededIds = new Set(items.flatMap((it) => it.needs));

  for (const [id, group] of byId) {
    if (group.length > 1)
      for (const it of group) it.defects.push(`duplicate: ID ${id} is defined ${group.length} times`);
  }

  const revHint = (id) => {
    const revs = revsByKey.get(keyOf(id));
    return revs ? ` (revision mismatch: existing revision(s) of ${keyOf(id)}: ${[...revs].sort((a, b) => a - b).join(', ')})` : '';
  };

  for (const it of items) {
    for (const n of it.needs) {
      if (!byId.has(n)) it.defects.push(`uncovered: needs ${n}, which does not exist${revHint(n)}`);
    }
    for (const c of it.covers) {
      const targets = byId.get(c);
      if (!targets) {
        it.defects.push(`orphaned: covers ${c}, which does not exist${revHint(c)}`);
      } else if (!targets.some((t) => t.needs.includes(it.id))) {
        it.defects.push(`unwanted: covers ${c}, but ${c} does not need ${it.id}`);
      }
    }
    if (it.origin === 'code' && !neededIds.has(it.id)) {
      it.defects.push(`unwanted: no item needs ${it.id}`);
    }
  }

  // deep coverage: all needs exist and are themselves deep-covered (cycle-safe)
  const memo = new Map();
  const deep = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, true); // cycle guard
    const group = byId.get(id);
    if (!group) {
      memo.set(id, false);
      return false;
    }
    let ok = true;
    for (const it of group) for (const n of it.needs) if (!deep(n)) ok = false;
    memo.set(id, ok);
    return ok;
  };
  for (const it of items) it.deepCovered = deep(it.id);
}

/* ------------------------------------------------------------------ */
/* Report                                                               */
/* ------------------------------------------------------------------ */

function makeStyler() {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (code) => (s) => (on ? `\u001b[${code}m${s}\u001b[0m` : s);
  return {
    red: wrap('31'),
    green: wrap('32'),
    yellow: wrap('33'),
    cyan: wrap('36'),
    dim: wrap('2'),
    bold: wrap('1'),
  };
}

function report(items, problems, cwd) {
  const c = makeStyler();
  const rel = (f) => path.relative(cwd, f) || f;
  const defective = items.filter((it) => it.defects.length > 0);
  const out = [];

  for (const it of defective) {
    const title = it.title ? ` ${c.dim(`"${it.title}"`)}` : '';
    out.push(
      `${c.red('✘')} ${c.bold(it.id)}${title}  ${c.dim(`${rel(it.file)}:${it.line}`)}`,
    );
    for (const d of it.defects) out.push(`    ${c.red('•')} ${d}`);
    out.push('');
  }
  for (const p of problems) {
    out.push(`${c.yellow('⚠')} ${p.message}  ${c.dim(`${rel(p.file)}:${p.line}`)}`);
  }
  if (problems.length) out.push('');

  const okCount = items.length - defective.length;
  const notDeep = items.filter((it) => it.defects.length === 0 && !it.deepCovered).length;
  const md = items.filter((i) => i.origin === 'markdown').length;

  out.push(c.bold('Summary'));
  out.push(`  items       ${items.length}  ${c.dim(`(${md} from markdown, ${items.length - md} from code)`)}`);
  out.push(`  ok          ${c.green(String(okCount))}`);
  out.push(`  defective   ${defective.length ? c.red(String(defective.length)) : '0'}`);
  if (notDeep) out.push(`  ${c.dim(`of the ok items, ${notDeep} are only shallow-covered (a needed item is itself defective)`)}`);
  if (problems.length) out.push(`  problems    ${c.yellow(String(problems.length))}`);
  out.push('');

  const clean = defective.length === 0 && problems.length === 0;
  out.push(clean ? c.green(c.bold('ok')) : c.red(c.bold('not ok')));
  console.log(out.join('\n'));
  return clean;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

class UsageError extends Error {}

const HELP = `Usage: flashtrace [options] [directory-or-file ...]

Traces requirement coverage between Markdown specifications and source code
(.ts, .js, .mjs, .sql, .vue). Defaults to the current directory. Files ignored
by git are excluded.

Options:
  -t, --tags <t1,t2,...>   only import markdown items carrying one of these
                           tags; add "_" to also include untagged items
  -h, --help               show this help

Exit codes: 0 clean, 1 defects or problems found, 2 usage error`;

function parseArgs(argv) {
  const opts = { dirs: [], tags: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
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
  let items = [];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const ext = path.extname(file).toLowerCase();
    items.push(
      ...(MD_EXT.has(ext) ? parseMarkdown(file, text, problems) : parseCode(file, text, problems)),
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

  analyze(items);
  const clean = report(items, problems, process.cwd());
  process.exit(clean ? 0 : 1);
}

main().catch((err) => {
  if (err instanceof UsageError) {
    console.error(`error: ${err.message}\n\n${HELP}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(2);
});
