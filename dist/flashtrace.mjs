#!/usr/bin/env node

// src/main.mjs
import { realpathSync } from "node:fs";
import process4 from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/cli.mjs
import { promises as fs2 } from "node:fs";
import path4 from "node:path";
import process3 from "node:process";

// src/errors.mjs
var UsageError = class extends Error {
};

// src/files.mjs
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// src/languages.mjs
var cLike = { line: ["//"], block: [["/*", "*/"]] };
var cLikeNested = { line: ["//"], block: [["/*", "*/", true]] };
var php = { line: ["//", "#"], block: [["/*", "*/"]] };
var hash = { line: ["#"], block: [] };
var powershell = { line: ["#"], block: [["<#", "#>"]] };
var sql = { line: ["--"], block: [["/*", "*/"]] };
var lua = { line: ["--"], block: [["--[[", "]]"]] };
var haskell = { line: ["--"], block: [["{-", "-}", true]] };
var css = { line: [], block: [["/*", "*/"]] };
var xml = { line: [], block: [["<!--", "-->"]] };
var none = { line: [], block: [] };
var semicolon = { line: [";"], block: [] };
var percent = { line: ["%"], block: [] };
var dashLine = { line: ["--"], block: [] };
var ml = { line: [], block: [["(*", "*)", true]] };
var fsharp = { line: ["//"], block: [["(*", "*)", true]] };
var pascal = { line: ["//"], block: [["{", "}"], ["(*", "*)"]] };
var hcl = { line: ["#", "//"], block: [["/*", "*/"]] };
function attrOf(tag, name) {
  const m = new RegExp(String.raw`\s${name}\s*=\s*["']?([^"'\s>]+)`, "i").exec(tag);
  return m ? m[1].toLowerCase() : "";
}
function scriptGrammar(tag) {
  const type = attrOf(tag, "type");
  if (/json|importmap/.test(type)) return none;
  if (/template|html/.test(type)) return xml;
  if (/coffee/.test(attrOf(tag, "lang"))) return hash;
  return cLike;
}
function styleGrammar(tag) {
  return /s[ac]ss|less|stylus|styl/.test(attrOf(tag, "lang")) ? cLike : css;
}
var html = {
  default: xml,
  regions: [
    { enter: /<script\b[^>]*>/gi, exit: /<\/script\s*>/gi, grammar: scriptGrammar },
    { enter: /<style\b[^>]*>/gi, exit: /<\/style\s*>/gi, grammar: styleGrammar }
  ]
};
var BY_EXT = {
  // C-family: // line, /* */ block
  ".ts": cLike,
  ".js": cLike,
  ".mjs": cLike,
  ".cjs": cLike,
  ".jsx": cLike,
  ".tsx": cLike,
  ".cts": cLike,
  ".mts": cLike,
  ".c": cLike,
  ".h": cLike,
  ".cpp": cLike,
  ".cc": cLike,
  ".hpp": cLike,
  ".cs": cLike,
  ".java": cLike,
  ".go": cLike,
  ".dart": cLike,
  ".php": php,
  ".proto": cLike,
  ".scss": cLike,
  ".less": cLike,
  // C-family with nested block comments
  ".rs": cLikeNested,
  ".swift": cLikeNested,
  ".kt": cLikeNested,
  ".kts": cLikeNested,
  ".scala": cLikeNested,
  // hash line comments
  ".py": hash,
  ".rb": hash,
  ".sh": hash,
  ".bash": hash,
  ".zsh": hash,
  ".yaml": hash,
  ".yml": hash,
  ".toml": hash,
  ".r": hash,
  ".pm": hash,
  ".ex": hash,
  ".exs": hash,
  ".tcl": hash,
  ".jl": hash,
  ".nim": hash,
  ".graphql": hash,
  ".gql": hash,
  ".coffee": hash,
  ".ps1": powershell,
  ".psm1": powershell,
  ".tf": hcl,
  ".tfvars": hcl,
  ".hcl": hcl,
  // semicolon (Lisp family)
  ".clj": semicolon,
  ".cljs": semicolon,
  ".cljc": semicolon,
  ".edn": semicolon,
  ".el": semicolon,
  ".lisp": semicolon,
  ".scm": semicolon,
  ".ss": semicolon,
  // percent (Erlang, LaTeX)
  ".erl": percent,
  ".hrl": percent,
  ".tex": percent,
  ".sty": percent,
  // dash line-only (Ada, VHDL)
  ".adb": dashLine,
  ".ads": dashLine,
  ".vhd": dashLine,
  ".vhdl": dashLine,
  // ML-family
  ".ml": ml,
  ".mli": ml,
  ".fs": fsharp,
  ".fsi": fsharp,
  ".fsx": fsharp,
  ".pas": pascal,
  ".dpr": pascal,
  // dashes and others
  ".sql": sql,
  ".lua": lua,
  ".hs": haskell,
  ".css": css,
  ".xml": xml,
  ".svg": xml,
  // composite: HTML markup with embedded <script>/<style> regions
  ".vue": html,
  ".html": html,
  ".htm": html,
  ".svelte": html
};
var CODE_EXT = new Set(Object.keys(BY_EXT));
var grammarFor = (ext) => BY_EXT[ext] ?? null;

// src/files.mjs
var MD_EXT = /* @__PURE__ */ new Set([".md", ".markdown"]);
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
    defects: [],
    forwardsTo: null
    // effective forwarding target, set by analyze
  };
}

// src/parse-markdown.mjs
var DEF_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
var HEADING_RE = /^(#{1,6})\s+(\S(?:.*\S)?)\s*$/;
var KEYWORD_RE = /^(Needs|Covers|Tags):\s*((?:\S.*)?)$/;
var BULLET_RE = /^\s*[-*+]\s+(\S(?:.*\S)?)\s*$/;
var DELIM_CELL_RE = /^:?-+:?$/;
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
function rowCells(line) {
  let s = line.trim();
  if (!s.includes("|")) return null;
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}
function takeKeywordTable(lines, j, item, file, problems) {
  const header = rowCells(lines[j]);
  if (!header) return null;
  const columns = [];
  header.forEach((cell, col) => {
    if (cell === "Needs" || cell === "Covers" || cell === "Tags") columns.push([col, cell]);
  });
  if (columns.length === 0) return null;
  const delim = j + 1 < lines.length ? rowCells(lines[j + 1]) : null;
  if (delim?.length !== header.length || !delim.every((c) => DELIM_CELL_RE.test(c))) return null;
  j++;
  while (j + 1 < lines.length && !isBoundary(lines[j + 1])) {
    const cells = rowCells(lines[j + 1]);
    if (!cells) break;
    j++;
    for (const [col, keyword] of columns) {
      if (cells[col]) applyKeyword(item, keyword, [cells[col]], file, j + 1, problems);
    }
  }
  return j;
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
    const tableEnd = kw ? null : takeKeywordTable(lines, j, item, file, problems);
    if (kw) {
      descDone = true;
      const collected = keywordEntries(lines, j, kw[2]);
      applyKeyword(item, kw[1], collected.entries, file, j + 1, problems);
      j = collected.j;
    } else if (tableEnd !== null) {
      descDone = true;
      j = tableEnd;
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
function activeLeaf(grammar, state) {
  if (state.region) return state.region.grammar;
  return grammar.regions ? grammar.default : grammar;
}
function matchAt(re, s, pos) {
  re.lastIndex = pos;
  return re.exec(s);
}
function* regionEvents(s, pos, grammar, state) {
  if (!grammar.regions) return;
  if (state.region) {
    const m = matchAt(state.region.exit, s, pos);
    if (m) yield { idx: m.index, kind: "exit", len: m[0].length };
    return;
  }
  for (const r of grammar.regions) {
    const m = matchAt(r.enter, s, pos);
    if (m) {
      const leaf = typeof r.grammar === "function" ? r.grammar(m[0]) : r.grammar;
      yield { idx: m.index, kind: "enter", len: m[0].length, region: { exit: r.exit, grammar: leaf } };
    }
  }
}
function nextEvent(s, pos, grammar, state) {
  const leaf = activeLeaf(grammar, state);
  let best = null;
  const consider = (idx, ev) => {
    if (idx === -1) return;
    if (best === null || idx < best.idx || idx === best.idx && ev.len > best.len) {
      best = { ...ev, idx };
    }
  };
  for (const marker of leaf.line) {
    consider(s.indexOf(marker, pos), { kind: "line", len: marker.length });
  }
  for (const [open, close, nestable] of leaf.block) {
    consider(s.indexOf(open, pos), {
      kind: "block",
      len: open.length,
      open,
      close,
      nestable: Boolean(nestable)
    });
  }
  for (const ev of regionEvents(s, pos, grammar, state)) consider(ev.idx, ev);
  return best;
}
function readBlockRest(s, pos, block, limit = s.length) {
  const { open, close, nestable } = block;
  const within = (idx) => idx !== -1 && idx < limit ? idx : -1;
  let i = pos;
  while (i < limit) {
    const closeIdx = within(s.indexOf(close, i));
    const openIdx = within(nestable ? s.indexOf(open, i) : -1);
    if (closeIdx === -1 && openIdx === -1) break;
    if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
      block.depth++;
      i = openIdx + open.length;
      continue;
    }
    block.depth--;
    i = closeIdx + close.length;
    if (block.depth === 0) return { text: s.slice(pos, closeIdx) + " ", pos: i, closed: true };
  }
  return { text: s.slice(pos, limit) + " ", pos: limit, closed: false };
}
function regionExitAt(s, pos, region) {
  const m = matchAt(region.exit, s, pos);
  return m ? { idx: m.index, len: m[0].length } : null;
}
function consumeBlock(s, pos, state, exit) {
  const rest = readBlockRest(s, pos, state.block, exit ? exit.idx : s.length);
  if (rest.closed) {
    state.block = null;
    return { text: rest.text, pos: rest.pos };
  }
  if (exit) {
    state.block = null;
    state.region = null;
    return { text: rest.text, pos: exit.idx + exit.len };
  }
  return { text: rest.text, pos: rest.pos };
}
function consumeLine(s, pos, state, exit) {
  if (exit) {
    state.region = null;
    return { text: s.slice(pos, exit.idx) + " ", pos: exit.idx + exit.len, done: false };
  }
  return { text: s.slice(pos) + " ", pos: s.length, done: true };
}
function commentText(s, state, grammar) {
  let comment = "";
  let pos = 0;
  while (pos < s.length) {
    const exit = state.region ? regionExitAt(s, pos, state.region) : null;
    if (state.block) {
      const r = consumeBlock(s, pos, state, exit);
      comment += r.text;
      pos = r.pos;
      continue;
    }
    const ev = nextEvent(s, pos, grammar, state);
    if (!ev) break;
    pos = ev.idx + ev.len;
    if (ev.kind === "line") {
      const r = consumeLine(s, pos, state, exit);
      comment += r.text;
      pos = r.pos;
      if (r.done) break;
    } else if (ev.kind === "block") {
      state.block = { open: ev.open, close: ev.close, nestable: ev.nestable, depth: 1 };
    } else if (ev.kind === "enter") {
      state.region = ev.region;
    } else {
      state.region = null;
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
  const grammar = grammarFor(ext) ?? cLike;
  const lines = text.split(/\r?\n/);
  const items = [];
  const state = { last: null, byId: /* @__PURE__ */ new Map(), block: null, region: null };
  for (let i = 0; i < lines.length; i++) {
    const comment = commentText(lines[i], state, grammar);
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
function buildResolver(items) {
  const byId = /* @__PURE__ */ new Map();
  for (const it of items) (byId.get(it.id) ?? byId.set(it.id, []).get(it.id)).push(it);
  const idsByKey = groupIdsByKey(byId);
  const matchesOf = (ref) => (idsByKey.get(keyOf(ref)) ?? []).filter((id) => idMatches(ref, id));
  return { byId, matchesOf };
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
  const { byId, matchesOf } = buildResolver(items);
  const revsByKey = /* @__PURE__ */ new Map();
  for (const it of items)
    (revsByKey.get(it.key) ?? revsByKey.set(it.key, /* @__PURE__ */ new Set()).get(it.key)).add(it.revision);
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
  for (const it of items) {
    it.forwardsTo = fwdTarget.get(it.id) ?? null;
    checkItemReferences(it, byId, matchesOf, isNeeded, revHint, fwdTarget);
  }
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
function statusOf(it, c) {
  if (it.defects.length > 0) return { mark: c.red("\u2718"), tag: c.red("[defective]") };
  if (!it.deepCovered) return { mark: c.yellow("~"), tag: c.yellow("[shallow-covered]") };
  return { mark: c.green("\u2714"), tag: c.green("[deep-covered]") };
}
function buildWantedBy(items, byId, matchesOf) {
  const wantedBy = /* @__PURE__ */ new Map();
  for (const it of items)
    for (const n of it.needs)
      for (const id of matchesOf(n))
        for (const m of byId.get(id))
          (wantedBy.get(m) ?? wantedBy.set(m, /* @__PURE__ */ new Set()).get(m)).add(it);
  return wantedBy;
}
function byFileLine(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}
function forwardEdge(it, byId, c, dimLoc) {
  const target = byId.get(it.forwardsTo)?.[0];
  if (!target) return `    ${c.cyan("\u2192")} ${it.forwardsTo}  ${c.red("\u2718 missing")}`;
  return `    ${c.cyan("\u2192")} ${it.forwardsTo}  ${statusOf(target, c).mark} ${dimLoc(target.file, target.line)}`;
}
function needEdges(it, byId, matchesOf, c, dimLoc) {
  const lines = [];
  for (const n of it.needs) {
    const ids = matchesOf(n);
    if (ids.length === 0) {
      lines.push(`    ${c.dim("needs")} ${n}  ${c.red("\u2718 missing")}`);
      continue;
    }
    const wild = isWildcardRev(revOf(n));
    for (const id of ids) {
      const m = byId.get(id)[0];
      const arrow = c.dim(`(\u2192 ${id})`);
      const ref = wild ? `${n} ${arrow}` : n;
      lines.push(`    ${c.dim("needs")} ${ref}  ${statusOf(m, c).mark} ${dimLoc(m.file, m.line)}`);
    }
  }
  return lines;
}
function coverEdges(it, byId, c, dimLoc) {
  const lines = [];
  for (const cv of it.covers) {
    const target = byId.get(cv)?.[0];
    if (!target) lines.push(`    ${c.dim("covers")} ${cv}  ${c.red("\u2718 missing")}`);
    else lines.push(`    ${c.dim("covers")} ${cv}  ${c.green("\u2714")} ${dimLoc(target.file, target.line)}`);
  }
  return lines;
}
function edgeLines(it, byId, matchesOf, wantedBy, c, dimLoc) {
  const lines = [];
  if (it.forwardsTo !== null) lines.push(forwardEdge(it, byId, c, dimLoc));
  else if (it.origin === "markdown") lines.push(...needEdges(it, byId, matchesOf, c, dimLoc));
  lines.push(...coverEdges(it, byId, c, dimLoc));
  for (const w of wantedBy.get(it) ?? [])
    lines.push(`    ${c.dim("wanted by")} ${w.id}  ${dimLoc(w.file, w.line)}`);
  return lines;
}
function renderVerbose(items, out, c, dimLoc) {
  const { byId, matchesOf } = buildResolver(items);
  const wantedBy = buildWantedBy(items, byId, matchesOf);
  const sorted = [...items].sort(byFileLine);
  let prevFile = null;
  for (const it of sorted) {
    if (prevFile !== null && it.file !== prevFile) out.push("");
    prevFile = it.file;
    const { mark, tag } = statusOf(it, c);
    const title = it.title ? " " + c.dim(`"${it.title}"`) : "";
    out.push(
      `${mark} ${c.bold(it.id)}${title}  ${dimLoc(it.file, it.line)}  ${tag}`,
      ...edgeLines(it, byId, matchesOf, wantedBy, c, dimLoc)
    );
    for (const d of it.defects) out.push(`    ${c.red("\u2022")} ${d}`);
  }
  if (sorted.length) out.push("");
}
function renderDefective(defective, out, c, dimLoc) {
  for (const it of defective) {
    const title = it.title ? " " + c.dim(`"${it.title}"`) : "";
    out.push(
      `${statusOf(it, c).mark} ${c.bold(it.id)}${title}  ${dimLoc(it.file, it.line)}`
    );
    for (const d of it.defects) out.push(`    ${c.red("\u2022")} ${d}`);
    out.push("");
  }
}
function renderSummary(items, defective, problems, out, c) {
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
}
function report(items, problems, cwd, opts = {}) {
  const { verbose = false } = opts;
  const c = makeStyler();
  const rel = (f) => path3.relative(cwd, f) || f;
  const dimLoc = (file, line) => c.dim(`${rel(file)}:${line}`);
  const defective = items.filter((it) => it.defects.length > 0);
  const out = [];
  if (verbose) renderVerbose(items, out, c, dimLoc);
  else renderDefective(defective, out, c, dimLoc);
  for (const p of problems) {
    out.push(`${c.yellow("\u26A0")} ${p.message}  ${dimLoc(p.file, p.line)}`);
  }
  if (problems.length) out.push("");
  renderSummary(items, defective, problems, out, c);
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
  -v, --verbose            list every item with its coverage status and trace
                           edges, not only the defective ones
  -V, --version            print the version number
  -h, --help               show this help

Exit codes: 0 clean, 1 defects or problems found, 2 usage error`;
function parseArgs(argv, version) {
  const opts = { dirs: [], tags: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      console.log(HELP);
      process3.exit(0);
    } else if (a === "-v" || a === "--verbose") {
      opts.verbose = true;
    } else if (a === "-V" || a === "--version") {
      console.log(version());
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
async function main(version) {
  const opts = parseArgs(process3.argv.slice(2), version);
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
  const clean = report(items, problems, process3.cwd(), { verbose: opts.verbose });
  process3.exit(clean ? 0 : 1);
}
function runCli({ version }) {
  main(version).catch((err) => {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}

${HELP}`);
      process3.exit(2);
    }
    console.error(err);
    process3.exit(2);
  });
}

// src/version.mjs
import { readFileSync } from "node:fs";
function packageVersion() {
  const pkg = new URL("../package.json", import.meta.url);
  return JSON.parse(readFileSync(pkg, "utf8")).version;
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
if (runAsCli()) runCli({ version: packageVersion });
export {
  UsageError,
  analyze,
  collectFiles,
  parseCode,
  parseMarkdown
};
