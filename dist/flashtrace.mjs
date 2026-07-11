#!/usr/bin/env node

// src/main.mjs
import { realpathSync } from "node:fs";
import process4 from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/cli.mjs
import { promises as fs2, readFileSync } from "node:fs";
import path4 from "node:path";
import process3 from "node:process";

// src/errors.mjs
var UsageError = class extends Error {
};

// src/files.mjs
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
var MD_EXT = /* @__PURE__ */ new Set([".md", ".markdown"]);
var CODE_EXT = /* @__PURE__ */ new Set([".ts", ".js", ".mjs", ".sql", ".vue"]);
var GIT_LOCATIONS = process.platform === "win32" ? [
  String.raw`C:\Program Files\Git\cmd\git.exe`,
  String.raw`C:\Program Files (x86)\Git\cmd\git.exe`
] : ["/usr/bin/git", "/bin/git"];
var gitBin;
function findGit() {
  if (gitBin === void 0) {
    gitBin = GIT_LOCATIONS.find((p) => existsSync(p)) ?? null;
  }
  return gitBin;
}
function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}
async function collectFiles(dirs) {
  const files = /* @__PURE__ */ new Set();
  for (const dir of dirs) {
    const abs = path.resolve(dir);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new UsageError(`input path does not exist: ${dir}`);
    if (st.isFile()) {
      files.add(abs);
      continue;
    }
    let list = null;
    const git = findGit();
    try {
      if (!git) throw new Error("git not found");
      const out = execFileSync(
        git,
        ["-C", abs, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      list = out.split("\0").filter(Boolean).map((f) => path.join(abs, f));
    } catch {
      list = await walk(abs, []);
    }
    for (const f of list) files.add(f);
  }
  return [...files].filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return MD_EXT.has(ext) || CODE_EXT.has(ext);
  }).sort(compareStrings);
}

// src/ids.mjs
var SEG_SRC = "[A-Za-z][A-Za-z0-9_.-]*";
var REV_SRC = String.raw`\d+(?:\.\d+){0,2}`;
var WILD_SRC = String.raw`(?:\d+\.\d+\.x|\d+\.x\.y|x\.y\.z|\d+\.x|x\.y|x)`;
var REVREF_SRC = `(?:${WILD_SRC}|${REV_SRC})`;
var ID_SRC = String.raw`([A-Za-z]+):(?:((?:${SEG_SRC}\/)*${SEG_SRC})\/)?(${SEG_SRC})#(${REV_SRC})`;
var ID_RE = new RegExp(`^${ID_SRC}$`);
var NEED_ID_SRC = String.raw`([A-Za-z]+):(?:((?:${SEG_SRC}\/)*${SEG_SRC})\/)?(${SEG_SRC})#(${REVREF_SRC})`;
var NEED_ID_RE = new RegExp(`^${NEED_ID_SRC}$`);
var FORWARD_SRC = String.raw`\[\s*${ID_SRC}\s*-->\s*${ID_SRC}\s*\]`;
var mkId = (type, group, name, rev) => `${type}:${group ? group + "/" : ""}${name}#${rev}`;
var mkForward = (m, base, file, line) => ({
  from: mkId(m[base], m[base + 1], m[base + 2], m[base + 3]),
  to: mkId(m[base + 4], m[base + 5], m[base + 6], m[base + 7]),
  file,
  line
});
var keyOf = (id) => id.slice(0, id.lastIndexOf("#"));
var revOf = (id) => id.slice(id.lastIndexOf("#") + 1);
function compareRev(a, b) {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (i >= pa.length) return -1;
    if (i >= pb.length) return 1;
    if (pa[i] !== pb[i]) return Number(pa[i]) - Number(pb[i]);
  }
  return 0;
}
var WILD_LAYER = /* @__PURE__ */ new Set(["x", "y", "z"]);
var isWildcardRev = (rev) => /[xyz]/.test(rev);
function revMatches(pattern, concrete) {
  const pp = pattern.split(".");
  const cp = concrete.split(".");
  if (pp.length !== cp.length) return false;
  for (let i = 0; i < pp.length; i++) {
    if (WILD_LAYER.has(pp[i])) continue;
    if (pp[i] !== cp[i]) return false;
  }
  return true;
}
var idMatches = (need, id) => keyOf(need) === keyOf(id) && revMatches(revOf(need), revOf(id));
function parseIdEntry(raw) {
  const cleaned = raw.replaceAll("`", "").trim();
  const m = cleaned.match(ID_RE);
  return m ? mkId(m[1], m[2], m[3], m[4]) : null;
}
function parseNeedEntry(raw) {
  const cleaned = raw.replaceAll("`", "").trim();
  const m = cleaned.match(NEED_ID_RE);
  return m ? mkId(m[1], m[2], m[3], m[4]) : null;
}
function newItem(id, origin, file, line) {
  return {
    id,
    key: keyOf(id),
    revision: revOf(id),
    origin,
    // 'markdown' | 'code'
    file,
    line,
    title: null,
    description: [],
    needs: [],
    covers: [],
    tags: [],
    defects: []
  };
}

// src/parse-markdown.mjs
var DEF_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
var HEADING_RE = /^(#{1,6})\s+(\S(?:.*\S)?)\s*$/;
var KEYWORD_RE = /^(Needs|Covers|Tags):\s*((?:\S.*)?)$/;
var BULLET_RE = /^\s*[-*+]\s+(\S(?:.*\S)?)\s*$/;
var FORWARD_LINE_RE = new RegExp(String.raw`^\s*(\`?)${FORWARD_SRC}\1\s*$`);
var isBoundary = (l) => DEF_RE.test(l) || HEADING_RE.test(l);
function takeForward(line, file, n, forwards) {
  const f = line.match(FORWARD_LINE_RE);
  if (f) forwards.push(mkForward(f, 2, file, n + 1));
  return !!f;
}
function titleAbove(lines, defIndex) {
  for (let k = defIndex - 1; k >= 0; k--) {
    const l = lines[k];
    if (l.trim() === "") continue;
    const h = l.match(HEADING_RE);
    return h ? h[2] : null;
  }
  return null;
}
function keywordEntries(lines, j, inline) {
  if (inline.trim() !== "") {
    return { entries: inline.split(",").map((s) => s.trim()).filter(Boolean), j };
  }
  const entries = [];
  while (j + 1 < lines.length) {
    const b = lines[j + 1].match(BULLET_RE);
    if (!b) break;
    entries.push(b[1].trim());
    j++;
  }
  return { entries, j };
}
function applyKeyword(item, keyword, entries, file, kwLine, problems) {
  if (keyword === "Tags") {
    item.tags.push(...entries);
    return;
  }
  const target = keyword === "Needs" ? "needs" : "covers";
  const parse = keyword === "Needs" ? parseNeedEntry : parseIdEntry;
  for (const e of entries) {
    const id = parse(e);
    if (id) item[target].push(id);
    else
      problems.push({
        file,
        line: kwLine,
        message: `invalid ID "${e}" in ${keyword}: list of ${item.id}`
      });
  }
}
function parseItemBody(lines, start, item, file, problems, forwards) {
  let j = start;
  let descDone = false;
  while (j < lines.length && !isBoundary(lines[j])) {
    const line = lines[j];
    if (takeForward(line, file, j, forwards)) {
      j++;
      continue;
    }
    const kw = line.match(KEYWORD_RE);
    if (kw) {
      descDone = true;
      const collected = keywordEntries(lines, j, kw[2]);
      applyKeyword(item, kw[1], collected.entries, file, j + 1, problems);
      j = collected.j;
    } else if (line.trim() === "") {
      if (item.description.length > 0) descDone = true;
    } else if (!descDone) {
      item.description.push(line.trim());
    }
    j++;
  }
  return j;
}
function parseMarkdown(file, text, problems, forwards = []) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let i = 0;
  while (i < lines.length) {
    if (takeForward(lines[i], file, i, forwards)) {
      i++;
      continue;
    }
    const def = lines[i].match(DEF_RE);
    if (!def) {
      i++;
      continue;
    }
    const item = newItem(mkId(def[1], def[2], def[3], def[4]), "markdown", file, i + 1);
    item.title = titleAbove(lines, i);
    i = parseItemBody(lines, i + 1, item, file, problems, forwards);
    items.push(item);
  }
  return items;
}

// src/parse-code.mjs
import path2 from "node:path";
var TAG_RE = new RegExp(
  String.raw`\[(?:\s*${ID_SRC}\s*)?>>\s*${NEED_ID_SRC}\s*\]|\[\s*${ID_SRC}\s*\]`,
  "g"
);
var FORWARD_RE = new RegExp(FORWARD_SRC, "g");
var BLOCK_CLOSERS = { c: "*/", html: "-->" };
function findCommentStart(s, pos, lineMarkers, htmlBlocks) {
  const candidates = lineMarkers.map((m) => ({ idx: s.indexOf(m, pos), kind: "line", len: m.length }));
  candidates.push({ idx: s.indexOf("/*", pos), kind: "c", len: 2 });
  if (htmlBlocks) candidates.push({ idx: s.indexOf("<!--", pos), kind: "html", len: 4 });
  let best = null;
  for (const cand of candidates) {
    if (cand.idx !== -1 && (best === null || cand.idx < best.idx)) best = cand;
  }
  return best;
}
function readBlockRest(s, pos, closer) {
  const end = s.indexOf(closer, pos);
  if (end === -1) return { text: s.slice(pos) + " ", pos: s.length, closed: false };
  return { text: s.slice(pos, end) + " ", pos: end + closer.length, closed: true };
}
function commentText(s, state, lineMarkers, htmlBlocks) {
  let comment = "";
  let pos = 0;
  while (pos < s.length) {
    if (state.block) {
      const rest = readBlockRest(s, pos, BLOCK_CLOSERS[state.block]);
      comment += rest.text;
      pos = rest.pos;
      if (rest.closed) state.block = null;
    } else {
      const start = findCommentStart(s, pos, lineMarkers, htmlBlocks);
      if (!start) break;
      pos = start.idx + start.len;
      if (start.kind === "line") {
        comment += s.slice(pos) + " ";
        pos = s.length;
      } else {
        state.block = start.kind;
      }
    }
  }
  return comment;
}
function collectTags(comment, file, line, state, items, problems) {
  for (const m of comment.matchAll(TAG_RE)) {
    if (m[9]) {
      const item = newItem(mkId(m[9], m[10], m[11], m[12]), "code", file, line);
      state.last = item;
      state.byId.set(item.id, item);
      items.push(item);
      continue;
    }
    const id = mkId(m[5], m[6], m[7], m[8]);
    if (m[1]) {
      const source = mkId(m[1], m[2], m[3], m[4]);
      const anchor = state.byId.get(source);
      if (anchor) {
        anchor.needs.push(id);
      } else {
        problems.push({
          file,
          line,
          message: `need tag [${source} >> ${id}] has no preceding item tag [${source}] in this file`
        });
      }
    } else if (state.last) {
      state.last.needs.push(id);
    } else {
      problems.push({
        file,
        line,
        message: `need tag [>>${id}] has no preceding item tag in this file`
      });
    }
  }
}
function parseCode(file, text, problems, forwards = []) {
  const ext = path2.extname(file).toLowerCase();
  const lines = text.split(/\r?\n/);
  const items = [];
  const lineMarkers = ext === ".sql" ? ["--"] : ["//"];
  const htmlBlocks = ext === ".vue";
  const state = { last: null, byId: /* @__PURE__ */ new Map(), block: null };
  for (let i = 0; i < lines.length; i++) {
    const comment = commentText(lines[i], state, lineMarkers, htmlBlocks);
    for (const m of comment.matchAll(FORWARD_RE)) {
      forwards.push(mkForward(m, 1, file, i + 1));
    }
    collectTags(comment, file, i + 1, state, items, problems);
  }
  return items;
}

// src/analyze.mjs
function checkItemReferences(it, byId, matchesOf, isNeeded, revHint, fwdTarget) {
  const fwd = fwdTarget.get(it.id);
  if (fwd !== void 0) {
    if (!byId.has(fwd))
      it.defects.push(`uncovered: forwards to ${fwd}, which does not exist${revHint(fwd)}`);
  } else {
    for (const n of it.needs) {
      if (matchesOf(n).length === 0)
        it.defects.push(`uncovered: needs ${n}, which does not exist${revHint(n)}`);
    }
  }
  for (const c of it.covers) {
    const targets = byId.get(c);
    if (!targets) {
      it.defects.push(`orphaned: covers ${c}, which does not exist${revHint(c)}`);
    } else if (!targets.some((t) => t.needs.some((n) => idMatches(n, it.id)))) {
      it.defects.push(`unwanted: covers ${c}, but ${c} does not need ${it.id}`);
    }
  }
  if (it.origin === "code" && !isNeeded(it.id)) {
    it.defects.push(`unwanted: no item needs ${it.id}`);
  }
}
function dropCyclicForwards(fwdTarget, declBySource, problems) {
  const done = /* @__PURE__ */ new Set();
  for (const start of fwdTarget.keys()) {
    if (done.has(start)) continue;
    const seen = /* @__PURE__ */ new Map();
    const path5 = [];
    let cur = start;
    while (fwdTarget.has(cur) && !done.has(cur) && !seen.has(cur)) {
      seen.set(cur, path5.length);
      path5.push(cur);
      cur = fwdTarget.get(cur);
    }
    if (seen.has(cur)) {
      const cycle = path5.slice(seen.get(cur));
      const chain = [...cycle, cur].join(" --> ");
      for (const id of cycle) {
        const f = declBySource.get(id);
        problems.push({ file: f.file, line: f.line, message: `cyclic forwarding: ${chain}` });
        fwdTarget.delete(id);
      }
    }
    for (const id of path5) done.add(id);
  }
}
function buildForwardMap(forwards, byId, neededIds, revHint, problems) {
  const fwdTarget = /* @__PURE__ */ new Map();
  const declBySource = /* @__PURE__ */ new Map();
  const fwdBySource = /* @__PURE__ */ new Map();
  for (const f of forwards) {
    (fwdBySource.get(f.from) ?? fwdBySource.set(f.from, []).get(f.from)).push(f);
  }
  for (const [from, group] of fwdBySource) {
    const sources = byId.get(from);
    if (!sources) {
      for (const f of group)
        problems.push({
          file: f.file,
          line: f.line,
          message: `forwarding from ${from}, which does not exist${revHint(from)}`
        });
      continue;
    }
    if (group.length > 1)
      for (const it of sources)
        it.defects.push(`duplicate: forwarding for ${from} is declared ${group.length} times`);
    fwdTarget.set(from, group[0].to);
    declBySource.set(from, group[0]);
  }
  dropCyclicForwards(fwdTarget, declBySource, problems);
  for (const to of fwdTarget.values()) neededIds.add(to);
  return fwdTarget;
}
function markDeepCoverage(items, byId, matchesOf, fwdTarget) {
  const memo = /* @__PURE__ */ new Map();
  const deep = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, true);
    const group = byId.get(id);
    if (!group) {
      memo.set(id, false);
      return false;
    }
    const fwd = fwdTarget.get(id);
    let ok = true;
    if (fwd !== void 0) {
      ok = deep(fwd);
    } else {
      for (const it of group) for (const n of it.needs) if (!needDeep(n)) ok = false;
    }
    memo.set(id, ok);
    return ok;
  };
  const needDeep = (n) => matchesOf(n).some((id) => deep(id));
  for (const it of items) it.deepCovered = deep(it.id);
}
function groupIdsByKey(byId) {
  const idsByKey = /* @__PURE__ */ new Map();
  for (const id of byId.keys())
    (idsByKey.get(keyOf(id)) ?? idsByKey.set(keyOf(id), []).get(keyOf(id))).push(id);
  return idsByKey;
}
function splitNeeds(items) {
  const exact = /* @__PURE__ */ new Set();
  const wildcard = [];
  for (const it of items)
    for (const n of it.needs) {
      if (isWildcardRev(revOf(n))) wildcard.push(n);
      else exact.add(n);
    }
  return { exact, wildcard };
}
function analyze(items, forwards = [], problems = []) {
  const byId = /* @__PURE__ */ new Map();
  const revsByKey = /* @__PURE__ */ new Map();
  for (const it of items) {
    (byId.get(it.id) ?? byId.set(it.id, []).get(it.id)).push(it);
    (revsByKey.get(it.key) ?? revsByKey.set(it.key, /* @__PURE__ */ new Set()).get(it.key)).add(it.revision);
  }
  const idsByKey = groupIdsByKey(byId);
  const matchesOf = (ref) => (idsByKey.get(keyOf(ref)) ?? []).filter((id) => idMatches(ref, id));
  const { exact: exactNeeds, wildcard: wildcardNeeds } = splitNeeds(items);
  const isNeeded = (id) => exactNeeds.has(id) || wildcardNeeds.some((w) => idMatches(w, id));
  for (const [id, group] of byId) {
    if (group.length > 1)
      for (const it of group) it.defects.push(`duplicate: ID ${id} is defined ${group.length} times`);
  }
  const revHint = (id) => {
    const revs = revsByKey.get(keyOf(id));
    return revs ? ` (revision mismatch: existing revision(s) of ${keyOf(id)}: ${[...revs].sort(compareRev).join(", ")})` : "";
  };
  const fwdTarget = buildForwardMap(forwards, byId, exactNeeds, revHint, problems);
  for (const it of items) checkItemReferences(it, byId, matchesOf, isNeeded, revHint, fwdTarget);
  markDeepCoverage(items, byId, matchesOf, fwdTarget);
}

// src/report.mjs
import path3 from "node:path";
import process2 from "node:process";
function makeStyler() {
  const on = process2.stdout.isTTY && !process2.env.NO_COLOR;
  const wrap = (code) => (s) => on ? `\x1B[${code}m${s}\x1B[0m` : s;
  return {
    red: wrap("31"),
    green: wrap("32"),
    yellow: wrap("33"),
    cyan: wrap("36"),
    dim: wrap("2"),
    bold: wrap("1")
  };
}
function report(items, problems, cwd) {
  const c = makeStyler();
  const rel = (f) => path3.relative(cwd, f) || f;
  const dimLoc = (file, line) => c.dim(`${rel(file)}:${line}`);
  const defective = items.filter((it) => it.defects.length > 0);
  const out = [];
  for (const it of defective) {
    const title = it.title ? " " + c.dim(`"${it.title}"`) : "";
    out.push(
      `${c.red("\u2718")} ${c.bold(it.id)}${title}  ${dimLoc(it.file, it.line)}`
    );
    for (const d of it.defects) out.push(`    ${c.red("\u2022")} ${d}`);
    out.push("");
  }
  for (const p of problems) {
    out.push(`${c.yellow("\u26A0")} ${p.message}  ${dimLoc(p.file, p.line)}`);
  }
  if (problems.length) out.push("");
  const okCount = items.length - defective.length;
  const notDeep = items.filter((it) => it.defects.length === 0 && !it.deepCovered).length;
  const md = items.filter((i) => i.origin === "markdown").length;
  const originBreakdown = c.dim(`(${md} from markdown, ${items.length - md} from code)`);
  out.push(
    c.bold("Summary"),
    `  items       ${items.length}  ${originBreakdown}`,
    `  ok          ${c.green(String(okCount))}`,
    `  defective   ${defective.length ? c.red(String(defective.length)) : "0"}`
  );
  if (notDeep) out.push("  " + c.dim(`of the ok items, ${notDeep} are only shallow-covered (an item further down the tracing chain is defective)`));
  if (problems.length) out.push(`  problems    ${c.yellow(String(problems.length))}`);
  out.push("");
  const clean = defective.length === 0 && problems.length === 0;
  out.push(clean ? c.green(c.bold("ok")) : c.red(c.bold("not ok")));
  console.log(out.join("\n"));
  return clean;
}

// src/cli.mjs
var HELP = `Usage: flashtrace [options] [directory-or-file ...]

Traces requirement coverage between Markdown specifications and source code
(.ts, .js, .mjs, .sql, .vue). Defaults to the current directory. Files ignored
by git are excluded.

Options:
  -t, --tags <t1,t2,...>   only import markdown items carrying one of these
                           tags; add "_" to also include untagged items
  -h, --help               show this help
  -v, --version            print the version number

Exit codes: 0 clean, 1 defects or problems found, 2 usage error`;
function packageVersion() {
  const pkg = new URL("../package.json", import.meta.url);
  return JSON.parse(readFileSync(pkg, "utf8")).version;
}
function parseArgs(argv) {
  const opts = { dirs: [], tags: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      console.log(HELP);
      process3.exit(0);
    } else if (a === "-v" || a === "--version") {
      console.log(packageVersion());
      process3.exit(0);
    } else if (a === "-t" || a === "--tags") {
      const v = argv[++i];
      if (!v) throw new UsageError(`missing value for ${a}`);
      opts.tags = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("-")) {
      throw new UsageError(`unknown option: ${a}`);
    } else {
      opts.dirs.push(a);
    }
  }
  if (opts.dirs.length === 0) opts.dirs.push(".");
  return opts;
}
async function main() {
  const opts = parseArgs(process3.argv.slice(2));
  const files = await collectFiles(opts.dirs);
  const problems = [];
  const forwards = [];
  let items = [];
  for (const file of files) {
    const text = await fs2.readFile(file, "utf8");
    const ext = path4.extname(file).toLowerCase();
    items.push(
      ...MD_EXT.has(ext) ? parseMarkdown(file, text, problems, forwards) : parseCode(file, text, problems, forwards)
    );
  }
  if (opts.tags) {
    const wantUntagged = opts.tags.includes("_");
    items = items.filter(
      (it) => it.origin === "code" || it.tags.some((t) => opts.tags.includes(t)) || wantUntagged && it.tags.length === 0
    );
  }
  analyze(items, forwards, problems);
  const clean = report(items, problems, process3.cwd());
  process3.exit(clean ? 0 : 1);
}
function runCli() {
  main().catch((err) => {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}

${HELP}`);
      process3.exit(2);
    }
    console.error(err);
    process3.exit(2);
  });
}

// src/main.mjs
function runAsCli() {
  const argvPath = process4.argv[1];
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(argvPath).href;
  }
}
if (runAsCli()) runCli();
export {
  UsageError,
  analyze,
  collectFiles,
  parseCode,
  parseMarkdown
};
