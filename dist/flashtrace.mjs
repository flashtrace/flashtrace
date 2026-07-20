#!/usr/bin/env node

// src/main.mjs
import { realpathSync } from "node:fs";
import process4 from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/cli.mjs
import { promises as fs2, readFileSync } from "node:fs";
import path5 from "node:path";
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
var coffee = { line: ["#"], block: [["###", "###"]] };
var julia = { line: ["#"], block: [["#=", "=#", true]] };
var nim = { line: ["#"], block: [["#[", "]#", true], ["##[", "]##", true]] };
var powershell = { line: ["#"], block: [["<#", "#>"]] };
var sql = { line: ["--"], block: [["/*", "*/"]] };
var lua = { line: ["--"], block: [["--[[", "]]"]] };
var haskell = { line: ["--"], block: [["{-", "-}", true]] };
var css = { line: [], block: [["/*", "*/"]] };
var xml = { line: [], block: [["<!--", "-->"]] };
var none = { line: [], block: [] };
var semicolon = { line: [";"], block: [] };
var scheme = { line: [";"], block: [["#|", "|#", true]] };
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
  if (/coffee/.test(attrOf(tag, "lang"))) return coffee;
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
  ".graphql": hash,
  ".gql": hash,
  // hash line comments plus a block pair of their own
  ".jl": julia,
  ".nim": nim,
  ".coffee": coffee,
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
  // Scheme/Racket: ; lines plus nestable #| |# blocks
  ".scm": scheme,
  ".ss": scheme,
  ".rkt": scheme,
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
var SPEC_EXT = /* @__PURE__ */ new Set([".md", ".markdown"]);
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
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(entryPath, out);
    else if (entry.isFile()) out.push(entryPath);
  }
  return out;
}
async function collectFiles(dirs) {
  const files = /* @__PURE__ */ new Set();
  for (const dir of dirs) {
    const abs = path.resolve(dir);
    const stats = await fs.stat(abs).catch(() => null);
    if (!stats) throw new UsageError(`input path does not exist: ${dir}`);
    if (stats.isFile()) {
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
    for (const file of list) files.add(file);
  }
  return [...files].filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return SPEC_EXT.has(ext) || CODE_EXT.has(ext);
  }).sort(compareStrings);
}

// src/ids.mjs
var SEGMENT_SRC = "[A-Za-z][A-Za-z0-9_.-]*";
var REV_SRC = String.raw`\d+(?:\.\d+){0,2}`;
var WILDCARD_SRC = String.raw`(?:\d+\.\d+\.x|\d+\.x\.y|x\.y\.z|\d+\.x|x\.y|x)`;
var REV_REF_SRC = `(?:${WILDCARD_SRC}|${REV_SRC})`;
var ID_SRC = String.raw`([A-Za-z]+):(?:((?:${SEGMENT_SRC}\/)*${SEGMENT_SRC})\/)?(${SEGMENT_SRC})#(${REV_SRC})`;
var ID_RE = new RegExp(`^${ID_SRC}$`);
var PATH_SRC = String.raw`(?:${SEGMENT_SRC}\/)*${SEGMENT_SRC}`;
var REF_SRC = `([A-Za-z]+)(?::(${PATH_SRC}))?(?:#(${REV_REF_SRC}))?`;
var REF_RE = new RegExp(`^${REF_SRC}$`);
var COVER_REF_RE = new RegExp(`^([A-Za-z]+)(?::(${PATH_SRC}))?(?:#(${REV_SRC}))?$`);
var FORWARD_SRC = String.raw`\[\s*${ID_SRC}\s*-->\s*${ID_SRC}\s*\]`;
var makeId = (type, group, name, rev) => `${type}:${group ? group + "/" : ""}${name}#${rev}`;
var makeForward = (m, base, file, line, character) => ({
  from: makeId(m[base], m[base + 1], m[base + 2], m[base + 3]),
  to: makeId(m[base + 4], m[base + 5], m[base + 6], m[base + 7]),
  file,
  line,
  character
});
var keyOf = (id) => id.slice(0, id.lastIndexOf("#"));
var revOf = (id) => id.slice(id.lastIndexOf("#") + 1);
var pathOf = (id) => id.slice(id.indexOf(":") + 1, id.lastIndexOf("#"));
var resolveRef = (type, path6, rev, ownerId) => `${type}:${path6 ?? pathOf(ownerId)}#${rev ?? revOf(ownerId)}`;
function compareRev(a, b) {
  const partsA = a.split(".");
  const partsB = b.split(".");
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    if (i >= partsA.length) return -1;
    if (i >= partsB.length) return 1;
    if (partsA[i] !== partsB[i]) return Number(partsA[i]) - Number(partsB[i]);
  }
  return 0;
}
var WILDCARD_LAYERS = /* @__PURE__ */ new Set(["x", "y", "z"]);
var isWildcardRev = (rev) => /[xyz]/.test(rev);
function revMatches(pattern, concrete) {
  const patternParts = pattern.split(".");
  const concreteParts = concrete.split(".");
  if (patternParts.length !== concreteParts.length) return false;
  for (let i = 0; i < patternParts.length; i++) {
    if (WILDCARD_LAYERS.has(patternParts[i])) continue;
    if (patternParts[i] !== concreteParts[i]) return false;
  }
  return true;
}
var idMatches = (need, id) => keyOf(need) === keyOf(id) && revMatches(revOf(need), revOf(id));
function parseNeedEntry(raw, ownerId) {
  const cleaned = raw.replaceAll("`", "").trim();
  const m = cleaned.match(REF_RE);
  return m ? resolveRef(m[1], m[2], m[3], ownerId) : null;
}
function parseCoverEntry(raw, ownerId) {
  const cleaned = raw.replaceAll("`", "").trim();
  const m = cleaned.match(COVER_REF_RE);
  return m ? resolveRef(m[1], m[2], m[3], ownerId) : null;
}
function newItem(id, origin, file, line, character) {
  return {
    id,
    key: keyOf(id),
    revision: revOf(id),
    origin,
    // 'spec' | 'code'
    file,
    line,
    character,
    // 1-based column of the first character of the defining construct
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
var DEFINITION_RE = new RegExp(String.raw`^\s*\`${ID_SRC}\`\s*$`);
var HEADING_RE = /^(#{1,6})\s+(\S(?:.*\S)?)\s*$/;
var SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
var THEMATIC_BREAK_RE = /^ {0,3}-{3,}[ \t]*$/;
var KEYWORD_RE = /^(Needs|Covers|Tags):\s*((?:\S.*)?)$/;
var BULLET_RE = /^\s*[-*+]\s+(\S(?:.*\S)?)\s*$/;
var DELIMITER_CELL_RE = /^:?-+:?$/;
var FORWARD_LINE_RE = new RegExp(String.raw`^\s*(\`?)${FORWARD_SRC}\1\s*$`);
var firstNonBlankColumn = (line) => line.search(/\S/) + 1;
function takeForward(line, file, lineIndex, forwards) {
  const forward = line.match(FORWARD_LINE_RE);
  if (forward) forwards.push(makeForward(forward, 2, file, lineIndex + 1, firstNonBlankColumn(line)));
  return !!forward;
}
function isParagraphLine(line) {
  return line.trim() !== "" && !HEADING_RE.test(line) && !BULLET_RE.test(line) && !SETEXT_UNDERLINE_RE.test(line);
}
var isParagraphAt = (lines, inTable, j) => !inTable[j] && isParagraphLine(lines[j]);
var isSetextHeading = (lines, inTable, titleIndex) => titleIndex + 1 < lines.length && SETEXT_UNDERLINE_RE.test(lines[titleIndex + 1]) && isParagraphAt(lines, inTable, titleIndex);
function scanSetextHeadings(lines, inTable) {
  const opensHeading = new Array(lines.length).fill(false);
  let j = 0;
  while (j < lines.length) {
    if (!isParagraphAt(lines, inTable, j)) {
      j++;
      continue;
    }
    const start = j;
    while (j + 1 < lines.length && isParagraphAt(lines, inTable, j + 1)) j++;
    if (isSetextHeading(lines, inTable, j)) opensHeading.fill(true, start, j + 1);
    j++;
  }
  return opensHeading;
}
var isBoundary = (lines, inTable, opensHeading, j) => !inTable[j] && DEFINITION_RE.test(lines[j]) || HEADING_RE.test(lines[j]) || opensHeading[j];
function foldSetextTitle(lines, inTable, lastIndex) {
  let first = lastIndex;
  while (first > 0 && isParagraphAt(lines, inTable, first - 1)) first--;
  let title = "";
  for (let k = first; k <= lastIndex; k++) {
    title += lines[k].trim();
    if (k < lastIndex) title += / {2}$/.test(lines[k]) ? "\n" : " ";
  }
  return title;
}
function titleAbove(lines, inTable, definitionIndex) {
  for (let k = definitionIndex - 1; k >= 0; k--) {
    const line = lines[k];
    if (line.trim() === "") continue;
    const heading = line.match(HEADING_RE);
    if (heading) return heading[2];
    if (k > 0 && isSetextHeading(lines, inTable, k - 1)) {
      return foldSetextTitle(lines, inTable, k - 1);
    }
    return null;
  }
  return null;
}
function keywordEntries(lines, j, inline) {
  if (inline.trim() !== "") {
    const inlineStart = lines[j].length - inline.length;
    const entries2 = [];
    let pos = 0;
    for (const part of inline.split(",")) {
      const value = part.trim();
      if (value) {
        const leading = part.length - part.trimStart().length;
        entries2.push({ value, line: j + 1, character: inlineStart + pos + leading + 1 });
      }
      pos += part.length + 1;
    }
    return { entries: entries2, j };
  }
  const entries = [];
  while (j + 1 < lines.length) {
    const bullet = lines[j + 1].match(BULLET_RE);
    if (!bullet) break;
    entries.push({ value: bullet[1].trim(), line: j + 2, character: lines[j + 1].indexOf(bullet[1]) + 1 });
    j++;
  }
  return { entries, j };
}
function rowCells(line) {
  let row = line.trim();
  if (!row.includes("|")) return null;
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}
function rowCellColumns(line) {
  if (rowCells(line) === null) return [firstNonBlankColumn(line)];
  let base = line.length - line.trimStart().length;
  const trimmed = line.trim();
  let body = trimmed;
  if (body.startsWith("|")) {
    body = body.slice(1);
    base += 1;
  }
  if (body.endsWith("|")) body = body.slice(0, -1);
  const columns = [];
  let pos = 0;
  for (const part of body.split("|")) {
    const value = part.trim();
    const leading = value ? part.length - part.trimStart().length : 0;
    columns.push(base + pos + leading + 1);
    pos += part.length + 1;
  }
  return columns;
}
function tableStartsAt(lines, j) {
  const header = rowCells(lines[j]);
  if (!header) return false;
  const delimiter = j + 1 < lines.length ? rowCells(lines[j + 1]) : null;
  return delimiter?.length === header.length && delimiter.every((cell) => DELIMITER_CELL_RE.test(cell));
}
var continuesTable = (line) => line.trim() !== "" && !HEADING_RE.test(line) && !THEMATIC_BREAK_RE.test(line) && (line.includes("|") || SETEXT_UNDERLINE_RE.test(line) || DEFINITION_RE.test(line));
var rowCellsInTable = (line) => rowCells(line) ?? [line.trim()];
var isKeywordCell = (cell) => cell === "Needs" || cell === "Covers" || cell === "Tags";
function scanTables(lines, file, problems) {
  const inTable = new Array(lines.length).fill(false);
  let j = 0;
  while (j < lines.length) {
    if (!tableStartsAt(lines, j)) {
      j++;
      continue;
    }
    const keywordColumns = /* @__PURE__ */ new Set();
    rowCells(lines[j]).forEach((cell, col) => {
      if (isKeywordCell(cell)) keywordColumns.add(col);
    });
    const start = j;
    let end = j + 1;
    while (end + 1 < lines.length && continuesTable(lines[end + 1])) end++;
    for (let k = start; k <= end; k++) {
      inTable[k] = true;
      if (k === start + 1) continue;
      const columns = rowCellColumns(lines[k]);
      rowCellsInTable(lines[k]).forEach((cell, col) => {
        const definition = keywordColumns.has(col) ? null : cell.match(DEFINITION_RE);
        if (definition)
          problems.push({
            file,
            line: k + 1,
            character: columns[col],
            message: `item ${makeId(definition[1], definition[2], definition[3], definition[4])} defined inside a table; a table cell is not an item definition`
          });
      });
    }
    j = end + 1;
  }
  return inTable;
}
function takeKeywordTable(lines, inTable, j, item, file, problems) {
  if (!inTable[j] || j > 0 && inTable[j - 1]) return null;
  const columns = [];
  rowCells(lines[j]).forEach((cell, col) => {
    if (isKeywordCell(cell)) columns.push([col, cell]);
  });
  if (columns.length === 0) return null;
  j++;
  while (j + 1 < lines.length && inTable[j + 1]) {
    j++;
    const cells = rowCellsInTable(lines[j]);
    const cellColumns = rowCellColumns(lines[j]);
    for (const [col, keyword] of columns) {
      if (cells[col])
        applyKeyword(
          item,
          keyword,
          [{ value: cells[col], line: j + 1, character: cellColumns[col] }],
          file,
          problems,
          `the ${keyword} column of ${item.id}`
        );
    }
  }
  return j;
}
function applyKeyword(item, keyword, entries, file, problems, source) {
  if (keyword === "Tags") {
    for (const entry of entries) item.tags.push(entry.value);
    return;
  }
  const target = keyword === "Needs" ? "needs" : "covers";
  const parse = keyword === "Needs" ? parseNeedEntry : parseCoverEntry;
  for (const entry of entries) {
    const id = parse(entry.value, item.id);
    if (id) item[target].push(id);
    else
      problems.push({
        file,
        line: entry.line,
        character: entry.character,
        message: `invalid ID "${entry.value}" in ${source}`
      });
  }
}
function parseItemBody(lines, boundary, start, item, file, problems, forwards) {
  const { inTable, opensHeading } = boundary;
  let j = start;
  let descriptionDone = false;
  while (j < lines.length && !isBoundary(lines, inTable, opensHeading, j)) {
    const line = lines[j];
    if (takeForward(line, file, j, forwards)) {
      j++;
      continue;
    }
    const keywordMatch = line.match(KEYWORD_RE);
    const tableEnd = keywordMatch ? null : takeKeywordTable(lines, inTable, j, item, file, problems);
    if (keywordMatch) {
      descriptionDone = true;
      const collected = keywordEntries(lines, j, keywordMatch[2]);
      applyKeyword(
        item,
        keywordMatch[1],
        collected.entries,
        file,
        problems,
        `${keywordMatch[1]}: list of ${item.id}`
      );
      j = collected.j;
    } else if (tableEnd !== null) {
      descriptionDone = true;
      j = tableEnd;
    } else if (line.trim() === "") {
      if (item.description.length > 0) descriptionDone = true;
    } else if (!descriptionDone) {
      item.description.push(line.trim());
    }
    j++;
  }
  return j;
}
function parseMarkdown(file, text, problems, forwards = []) {
  const lines = text.split(/\r?\n/);
  const inTable = scanTables(lines, file, problems);
  const opensHeading = scanSetextHeadings(lines, inTable);
  const boundary = { inTable, opensHeading };
  const items = [];
  let i = 0;
  while (i < lines.length) {
    const startsHeading = opensHeading[i];
    if (!startsHeading && takeForward(lines[i], file, i, forwards)) {
      i++;
      continue;
    }
    const definition = inTable[i] ? null : lines[i].match(DEFINITION_RE);
    if (definition && startsHeading) {
      problems.push({
        file,
        line: i + 1,
        character: firstNonBlankColumn(lines[i]),
        message: `item ${makeId(definition[1], definition[2], definition[3], definition[4])} defined inside a setext heading; a heading is not an item definition`
      });
      i++;
      continue;
    }
    if (!definition) {
      i++;
      continue;
    }
    const item = newItem(makeId(definition[1], definition[2], definition[3], definition[4]), "spec", file, i + 1, firstNonBlankColumn(lines[i]));
    item.title = titleAbove(lines, inTable, i);
    i = parseItemBody(lines, boundary, i + 1, item, file, problems, forwards);
    items.push(item);
  }
  return items;
}

// src/parse-code.mjs
import path2 from "node:path";
var TAG_RE = new RegExp(
  String.raw`\[(?:\s*${ID_SRC}\s*)?>>\s*${REF_SRC}\s*\]|\[\s*${ID_SRC}\s*\]`,
  "g"
);
var FORWARD_RE = new RegExp(FORWARD_SRC, "g");
var URL_RE = /[A-Za-z][A-Za-z0-9+.-]{0,63}:\/\/[^\s"'`<>[\]]*/g;
function urlSpans(line) {
  if (!line.includes("://")) return [];
  return [...line.matchAll(URL_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}
function markerIndex(line, marker, pos, spans) {
  let idx = line.indexOf(marker, pos);
  for (const span of spans) {
    if (idx === -1 || idx < span.start) break;
    if (idx < span.end) idx = line.indexOf(marker, span.end);
  }
  return idx;
}
function activeLeaf(grammar, state) {
  if (state.region) return state.region.grammar;
  return grammar.regions ? grammar.default : grammar;
}
function matchAt(re, line, pos) {
  re.lastIndex = pos;
  return re.exec(line);
}
function* regionEvents(line, pos, grammar, state) {
  if (!grammar.regions) return;
  if (state.region) {
    const m = matchAt(state.region.exit, line, pos);
    if (m) yield { idx: m.index, kind: "exit", len: m[0].length };
    return;
  }
  for (const region of grammar.regions) {
    const m = matchAt(region.enter, line, pos);
    if (m) {
      const leaf = typeof region.grammar === "function" ? region.grammar(m[0]) : region.grammar;
      yield { idx: m.index, kind: "enter", len: m[0].length, region: { exit: region.exit, grammar: leaf } };
    }
  }
}
function nextEvent(line, pos, grammar, state, spans) {
  const leaf = activeLeaf(grammar, state);
  let best = null;
  const consider = (idx, event) => {
    if (idx === -1) return;
    if (best === null || idx < best.idx || idx === best.idx && event.len > best.len) {
      best = { ...event, idx };
    }
  };
  for (const marker of leaf.line) {
    consider(markerIndex(line, marker, pos, spans), { kind: "line", len: marker.length });
  }
  for (const [open, close, nestable] of leaf.block) {
    consider(markerIndex(line, open, pos, spans), {
      kind: "block",
      len: open.length,
      open,
      close,
      nestable: Boolean(nestable)
    });
  }
  for (const event of regionEvents(line, pos, grammar, state)) consider(event.idx, event);
  return best;
}
function readBlockRest(line, pos, block, limit = line.length) {
  const { open, close, nestable } = block;
  const within = (idx) => idx !== -1 && idx < limit ? idx : -1;
  let i = pos;
  while (i < limit) {
    const closeIdx = within(line.indexOf(close, i));
    const openIdx = within(nestable ? line.indexOf(open, i) : -1);
    if (closeIdx === -1 && openIdx === -1) break;
    if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
      block.depth++;
      i = openIdx + open.length;
      continue;
    }
    block.depth--;
    i = closeIdx + close.length;
    if (block.depth === 0) return { end: closeIdx, pos: i, closed: true };
  }
  return { end: limit, pos: limit, closed: false };
}
function regionExitAt(line, pos, region) {
  const m = matchAt(region.exit, line, pos);
  return m ? { idx: m.index, len: m[0].length } : null;
}
function consumeBlock(line, pos, state, exit) {
  const rest = readBlockRest(line, pos, state.block, exit ? exit.idx : line.length);
  if (rest.closed) {
    state.block = null;
    return { end: rest.end, pos: rest.pos };
  }
  if (exit) {
    state.block = null;
    state.region = null;
    return { end: rest.end, pos: exit.idx + exit.len };
  }
  return { end: rest.end, pos: rest.pos };
}
function consumeLine(line, pos, state, exit) {
  if (exit) {
    state.region = null;
    return { end: exit.idx, pos: exit.idx + exit.len, done: false };
  }
  return { end: line.length, pos: line.length, done: true };
}
function commentText(line, state, grammar) {
  const spans = urlSpans(line);
  const buffer = new Array(line.length).fill(" ");
  const keep = (from, to) => {
    for (let k = from; k < to; k++) buffer[k] = line[k];
  };
  let pos = 0;
  while (pos < line.length) {
    const exit = state.region ? regionExitAt(line, pos, state.region) : null;
    if (state.block) {
      const consumed = consumeBlock(line, pos, state, exit);
      keep(pos, consumed.end);
      pos = consumed.pos;
      continue;
    }
    const event = nextEvent(line, pos, grammar, state, spans);
    if (!event) break;
    pos = event.idx + event.len;
    if (event.kind === "line") {
      const consumed = consumeLine(line, pos, state, exit);
      keep(pos, consumed.end);
      pos = consumed.pos;
      if (consumed.done) break;
    } else if (event.kind === "block") {
      state.block = { open: event.open, close: event.close, nestable: event.nestable, depth: 1 };
    } else if (event.kind === "enter") {
      state.region = event.region;
    } else {
      state.region = null;
    }
  }
  return buffer.join("");
}
function attachNeed(m, file, line, character, state, problems) {
  const source = m[1] ? makeId(m[1], m[2], m[3], m[4]) : null;
  const anchor = source ? state.byId.get(source) : state.lastItem;
  if (!anchor) {
    const written = m[5] + (m[6] ? `:${m[6]}` : "") + (m[7] ? `#${m[7]}` : "");
    problems.push({
      file,
      line,
      character,
      message: source ? `need tag [${source} >> ${written}] has no preceding item tag [${source}] in this file` : `need tag [>>${written}] has no preceding item tag in this file`
    });
    return;
  }
  anchor.needs.push(resolveRef(m[5], m[6], m[7], anchor.id));
}
function collectTags(comment, file, line, state, items, problems) {
  for (const m of comment.matchAll(TAG_RE)) {
    const character = m.index + 1;
    if (m[8]) {
      const item = newItem(makeId(m[8], m[9], m[10], m[11]), "code", file, line, character);
      state.lastItem = item;
      state.byId.set(item.id, item);
      items.push(item);
    } else {
      attachNeed(m, file, line, character, state, problems);
    }
  }
}
function parseCode(file, text, problems, forwards = []) {
  const ext = path2.extname(file).toLowerCase();
  const grammar = grammarFor(ext) ?? cLike;
  const lines = text.split(/\r?\n/);
  const items = [];
  const state = { lastItem: null, byId: /* @__PURE__ */ new Map(), block: null, region: null };
  for (let i = 0; i < lines.length; i++) {
    const comment = commentText(lines[i], state, grammar);
    for (const m of comment.matchAll(FORWARD_RE)) {
      forwards.push(makeForward(m, 1, file, i + 1, m.index + 1));
    }
    collectTags(comment, file, i + 1, state, items, problems);
  }
  return items;
}

// src/defects.mjs
var DEFECT_KINDS = Object.freeze([
  "uncovered-need",
  "uncovered-forward",
  "orphaned-cover",
  "unwanted-cover",
  "unwanted-item",
  "duplicate-id",
  "duplicate-forwarding"
]);
var uncoveredNeed = (need) => ({
  kind: "uncovered-need",
  ref: need,
  message: `uncovered: needs ${need}, which does not exist`
});
var uncoveredForward = (target) => ({
  kind: "uncovered-forward",
  ref: target,
  message: `uncovered: forwards to ${target}, which does not exist`
});
var orphanedCover = (coverId) => ({
  kind: "orphaned-cover",
  ref: coverId,
  message: `orphaned: covers ${coverId}, which does not exist`
});
var unwantedCover = (coverId, itemId) => ({
  kind: "unwanted-cover",
  ref: coverId,
  message: `unwanted: covers ${coverId}, but ${coverId} does not need ${itemId}`
});
var unwantedItem = (itemId) => ({
  kind: "unwanted-item",
  ref: itemId,
  message: `unwanted: no item needs ${itemId}`
});
var duplicateId = (id, count) => ({
  kind: "duplicate-id",
  ref: id,
  message: `duplicate: ID ${id} is defined ${count} times`
});
var duplicateForwarding = (from, count) => ({
  kind: "duplicate-forwarding",
  ref: from,
  message: `duplicate: forwarding for ${from} is declared ${count} times`
});

// src/analyze.mjs
function checkItemReferences(item, byId, matchesOf, isNeeded, withRevisions, forwardTargets) {
  const forwardTarget = forwardTargets.get(item.id);
  if (forwardTarget !== void 0) {
    if (!byId.has(forwardTarget))
      item.defects.push(withRevisions(uncoveredForward(forwardTarget)));
  } else {
    for (const need of item.needs) {
      if (matchesOf(need).length === 0)
        item.defects.push(withRevisions(uncoveredNeed(need)));
    }
  }
  for (const coverId of item.covers) {
    const targets = byId.get(coverId);
    if (!targets) {
      item.defects.push(withRevisions(orphanedCover(coverId)));
    } else if (!targets.some((target) => target.needs.some((need) => idMatches(need, item.id)))) {
      item.defects.push(unwantedCover(coverId, item.id));
    }
  }
  if (item.origin === "code" && !isNeeded(item.id)) {
    item.defects.push(unwantedItem(item.id));
  }
}
function dropCyclicForwards(forwardTargets, declarationBySource, problems) {
  const done = /* @__PURE__ */ new Set();
  for (const start of forwardTargets.keys()) {
    if (done.has(start)) continue;
    const seen = /* @__PURE__ */ new Map();
    const path6 = [];
    let current = start;
    while (forwardTargets.has(current) && !done.has(current) && !seen.has(current)) {
      seen.set(current, path6.length);
      path6.push(current);
      current = forwardTargets.get(current);
    }
    if (seen.has(current)) {
      const cycle = path6.slice(seen.get(current));
      const chain = [...cycle, current].join(" --> ");
      for (const id of cycle) {
        const declaration = declarationBySource.get(id);
        declaration.effective = false;
        declaration.voidedBy = "cycle";
        problems.push({
          file: declaration.file,
          line: declaration.line,
          character: declaration.character,
          message: `cyclic forwarding: ${chain}`
        });
        forwardTargets.delete(id);
      }
    }
    for (const id of path6) done.add(id);
  }
}
function buildForwardMap(forwards, byId, neededIds, revHint, problems) {
  const forwardTargets = /* @__PURE__ */ new Map();
  const declarationBySource = /* @__PURE__ */ new Map();
  const forwardsBySource = /* @__PURE__ */ new Map();
  for (const forward of forwards) {
    (forwardsBySource.get(forward.from) ?? forwardsBySource.set(forward.from, []).get(forward.from)).push(forward);
  }
  for (const [from, group] of forwardsBySource) {
    const sources = byId.get(from);
    if (!sources) {
      for (const forward of group) {
        forward.effective = false;
        forward.voidedBy = "missing-source";
        problems.push({
          file: forward.file,
          line: forward.line,
          character: forward.character,
          message: `forwarding from ${from}, which does not exist${revHint(from)}`
        });
      }
      continue;
    }
    if (group.length > 1)
      for (const item of sources) item.defects.push(duplicateForwarding(from, group.length));
    group[0].effective = true;
    for (let i = 1; i < group.length; i++) {
      group[i].effective = false;
      group[i].voidedBy = "duplicate";
    }
    forwardTargets.set(from, group[0].to);
    declarationBySource.set(from, group[0]);
  }
  dropCyclicForwards(forwardTargets, declarationBySource, problems);
  for (const to of forwardTargets.values()) neededIds.add(to);
  return forwardTargets;
}
function markDeepCoverage(items, byId, matchesOf, forwardTargets) {
  const memo = /* @__PURE__ */ new Map();
  const deep = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, true);
    const group = byId.get(id);
    if (!group) {
      memo.set(id, false);
      return false;
    }
    const forwardTarget = forwardTargets.get(id);
    let ok = true;
    if (forwardTarget !== void 0) {
      ok = deep(forwardTarget);
    } else {
      for (const item of group) for (const need of item.needs) if (!needDeep(need)) ok = false;
    }
    memo.set(id, ok);
    return ok;
  };
  const needDeep = (need) => matchesOf(need).some((id) => deep(id));
  for (const item of items) item.deepCovered = deep(item.id);
}
function groupIdsByKey(byId) {
  const idsByKey = /* @__PURE__ */ new Map();
  for (const id of byId.keys())
    (idsByKey.get(keyOf(id)) ?? idsByKey.set(keyOf(id), []).get(keyOf(id))).push(id);
  return idsByKey;
}
function buildWantedBy(items, byId, matchesOf) {
  const wantedBy = /* @__PURE__ */ new Map();
  for (const item of items)
    for (const need of item.needs)
      for (const id of matchesOf(need))
        for (const provider of byId.get(id))
          (wantedBy.get(provider) ?? wantedBy.set(provider, /* @__PURE__ */ new Set()).get(provider)).add(item);
  return wantedBy;
}
function buildResolver(items) {
  const byId = /* @__PURE__ */ new Map();
  for (const item of items) (byId.get(item.id) ?? byId.set(item.id, []).get(item.id)).push(item);
  const idsByKey = groupIdsByKey(byId);
  const matchesOf = (ref) => (idsByKey.get(keyOf(ref)) ?? []).filter((id) => idMatches(ref, id));
  let wantedBy = null;
  return {
    byId,
    matchesOf,
    get wantedBy() {
      wantedBy ??= buildWantedBy(items, byId, matchesOf);
      return wantedBy;
    }
  };
}
function summarize(items, problems) {
  const specItems = items.filter((item) => item.origin === "spec").length;
  const defectiveItems = items.filter((item) => item.defects.length > 0).length;
  const shallowCoveredItems = items.filter(
    (item) => item.defects.length === 0 && !item.deepCovered
  ).length;
  return {
    items: items.length,
    specItems,
    codeItems: items.length - specItems,
    okItems: items.length - defectiveItems,
    defectiveItems,
    shallowCoveredItems,
    problems: problems.length
  };
}
var isClean = (summary) => summary.defectiveItems === 0 && summary.problems === 0;
function splitNeeds(items) {
  const exact = /* @__PURE__ */ new Set();
  const wildcard = [];
  for (const item of items)
    for (const need of item.needs) {
      if (isWildcardRev(revOf(need))) wildcard.push(need);
      else exact.add(need);
    }
  return { exact, wildcard };
}
function analyze(items, forwards = [], problems = []) {
  const { byId, matchesOf } = buildResolver(items);
  const revsByKey = /* @__PURE__ */ new Map();
  for (const item of items)
    (revsByKey.get(item.key) ?? revsByKey.set(item.key, /* @__PURE__ */ new Set()).get(item.key)).add(item.revision);
  const { exact: exactNeeds, wildcard: wildcardNeeds } = splitNeeds(items);
  const isNeeded = (id) => exactNeeds.has(id) || wildcardNeeds.some((wildcard) => idMatches(wildcard, id));
  for (const [id, group] of byId) {
    if (group.length > 1) for (const item of group) item.defects.push(duplicateId(id, group.length));
  }
  const existingRevisionsOf = (id) => {
    const revs = revsByKey.get(keyOf(id));
    return revs ? [...revs].sort(compareRev) : null;
  };
  const revHint = (id) => {
    const revs = existingRevisionsOf(id);
    return revs ? ` (revision mismatch: existing revision(s) of ${keyOf(id)}: ${revs.join(", ")})` : "";
  };
  const withRevisions = (defect) => {
    const existingRevisions = existingRevisionsOf(defect.ref);
    if (!existingRevisions) return defect;
    return {
      kind: defect.kind,
      ref: defect.ref,
      existingRevisions,
      message: `${defect.message} (revision mismatch: existing revision(s) of ${keyOf(defect.ref)}: ${existingRevisions.join(", ")})`
    };
  };
  const forwardTargets = buildForwardMap(forwards, byId, exactNeeds, revHint, problems);
  for (const item of items) {
    item.forwardsTo = forwardTargets.get(item.id) ?? null;
    checkItemReferences(item, byId, matchesOf, isNeeded, withRevisions, forwardTargets);
  }
  markDeepCoverage(items, byId, matchesOf, forwardTargets);
}

// src/report.mjs
import path3 from "node:path";
import process2 from "node:process";
function makeStyler() {
  const on = process2.stdout.isTTY && !process2.env.NO_COLOR;
  const wrap = (code) => (text) => on ? `\x1B[${code}m${text}\x1B[0m` : text;
  return {
    red: wrap("31"),
    green: wrap("32"),
    yellow: wrap("33"),
    cyan: wrap("36"),
    dim: wrap("2"),
    bold: wrap("1")
  };
}
function statusOf(item, style) {
  if (item.defects.length > 0) return { mark: style.red("\u2718"), tag: style.red("[defective]") };
  if (!item.deepCovered) return { mark: style.yellow("~"), tag: style.yellow("[shallow-covered]") };
  return { mark: style.green("\u2714"), tag: style.green("[deep-covered]") };
}
function byFileLine(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}
function forwardEdge(item, byId, style, dimLocation) {
  const target = byId.get(item.forwardsTo)?.[0];
  if (!target) return `    ${style.cyan("\u2192")} ${item.forwardsTo}  ${style.red("\u2718 missing")}`;
  return `    ${style.cyan("\u2192")} ${item.forwardsTo}  ${statusOf(target, style).mark} ${dimLocation(target.file, target.line)}`;
}
function needEdges(item, byId, matchesOf, style, dimLocation) {
  const lines = [];
  for (const need of item.needs) {
    const ids = matchesOf(need);
    if (ids.length === 0) {
      lines.push(`    ${style.dim("needs")} ${need}  ${style.red("\u2718 missing")}`);
      continue;
    }
    const wildcard = isWildcardRev(revOf(need));
    for (const id of ids) {
      const covering = byId.get(id)[0];
      const arrow = style.dim(`(\u2192 ${id})`);
      const ref = wildcard ? `${need} ${arrow}` : need;
      lines.push(`    ${style.dim("needs")} ${ref}  ${statusOf(covering, style).mark} ${dimLocation(covering.file, covering.line)}`);
    }
  }
  return lines;
}
function coverEdges(item, byId, style, dimLocation) {
  const lines = [];
  for (const coverId of item.covers) {
    const target = byId.get(coverId)?.[0];
    if (!target) lines.push(`    ${style.dim("covers")} ${coverId}  ${style.red("\u2718 missing")}`);
    else lines.push(`    ${style.dim("covers")} ${coverId}  ${style.green("\u2714")} ${dimLocation(target.file, target.line)}`);
  }
  return lines;
}
function edgeLines(item, byId, matchesOf, wantedBy, style, dimLocation) {
  const lines = [];
  if (item.forwardsTo !== null) lines.push(forwardEdge(item, byId, style, dimLocation));
  else if (item.origin === "spec") lines.push(...needEdges(item, byId, matchesOf, style, dimLocation));
  lines.push(...coverEdges(item, byId, style, dimLocation));
  for (const wanting of wantedBy.get(item) ?? [])
    lines.push(`    ${style.dim("wanted by")} ${wanting.id}  ${dimLocation(wanting.file, wanting.line)}`);
  return lines;
}
function renderVerbose(items, out, style, dimLocation) {
  const { byId, matchesOf, wantedBy } = buildResolver(items);
  const sorted = [...items].sort(byFileLine);
  let prevFile = null;
  for (const item of sorted) {
    if (prevFile !== null && item.file !== prevFile) out.push("");
    prevFile = item.file;
    const { mark, tag } = statusOf(item, style);
    const title = item.title ? " " + style.dim(`"${item.title}"`) : "";
    out.push(
      `${mark} ${style.bold(item.id)}${title}  ${dimLocation(item.file, item.line)}  ${tag}`,
      ...edgeLines(item, byId, matchesOf, wantedBy, style, dimLocation)
    );
    for (const defect of item.defects) out.push(`    ${style.red("\u2022")} ${defect.message}`);
  }
  if (sorted.length) out.push("");
}
function renderDefective(defective, out, style, dimLocation) {
  for (const item of defective) {
    const title = item.title ? " " + style.dim(`"${item.title}"`) : "";
    out.push(
      `${statusOf(item, style).mark} ${style.bold(item.id)}${title}  ${dimLocation(item.file, item.line)}`
    );
    for (const defect of item.defects) out.push(`    ${style.red("\u2022")} ${defect.message}`);
    out.push("");
  }
}
function renderSummary(summary, out, style) {
  const originBreakdown = style.dim(`(${summary.specItems} from specs, ${summary.codeItems} from code)`);
  out.push(
    style.bold("Summary"),
    `  items       ${summary.items}  ${originBreakdown}`,
    `  ok          ${style.green(String(summary.okItems))}`,
    `  defective   ${summary.defectiveItems ? style.red(String(summary.defectiveItems)) : "0"}`
  );
  if (summary.shallowCoveredItems) out.push("  " + style.dim(`of the ok items, ${summary.shallowCoveredItems} are only shallow-covered (an item further down the tracing chain is defective)`));
  if (summary.problems) out.push(`  problems    ${style.yellow(String(summary.problems))}`);
  out.push("");
}
function report(items, problems, cwd, opts = {}) {
  const { verbose = false } = opts;
  const style = makeStyler();
  const relativePath = (file) => path3.relative(cwd, file) || file;
  const dimLocation = (file, line) => style.dim(`${relativePath(file)}:${line}`);
  const summary = summarize(items, problems);
  const out = [];
  if (verbose) renderVerbose(items, out, style, dimLocation);
  else renderDefective(items.filter((item) => item.defects.length > 0), out, style, dimLocation);
  for (const problem of problems) {
    out.push(`${style.yellow("\u26A0")} ${problem.message}  ${dimLocation(problem.file, problem.line)}`);
  }
  if (problems.length) out.push("");
  renderSummary(summary, out, style);
  const clean = isClean(summary);
  out.push(clean ? style.green(style.bold("ok")) : style.red(style.bold("not ok")));
  console.log(out.join("\n"));
  return clean;
}

// src/report-json.mjs
import path4 from "node:path";
var SCHEMA_VERSION = 0;
function statusOf2(item) {
  if (item.defects.length > 0) return "defective";
  return item.deepCovered ? "deep-covered" : "shallow-covered";
}
function coverStatusOf(item) {
  const status = /* @__PURE__ */ new Map();
  for (const defect of item.defects) {
    if (defect.kind === "orphaned-cover") status.set(defect.ref, "orphaned");
    else if (defect.kind === "unwanted-cover") status.set(defect.ref, "unwanted");
  }
  return (ref) => status.get(ref) ?? "valid";
}
function defectDocument(defect) {
  const out = { kind: defect.kind, ref: defect.ref };
  if (defect.existingRevisions) out.existingRevisions = defect.existingRevisions;
  out.message = defect.message;
  return out;
}
function buildReportDocument(items, forwards, problems, cwd, opts = {}) {
  const { version } = opts;
  const relative = (file) => (path4.relative(cwd, file) || file).replaceAll("\\", "/");
  const location = (x) => ({ file: relative(x.file), line: x.line, character: x.character });
  const byLocation = (a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.character - b.character;
  };
  const { matchesOf, wantedBy } = buildResolver(items);
  const resolvedTo = (ref) => matchesOf(ref).slice().sort((a, b) => compareRev(revOf(a), revOf(b)));
  const wantedByDocument = (item) => [...wantedBy.get(item) ?? []].map((wanter) => ({ id: wanter.id, ...location(wanter) })).sort(byLocation);
  const itemDocument = (item) => {
    const coverStatus = coverStatusOf(item);
    return {
      id: item.id,
      title: item.title,
      origin: item.origin,
      tags: item.tags,
      ...location(item),
      status: statusOf2(item),
      defective: item.defects.length > 0,
      deepCovered: item.deepCovered,
      needs: item.needs.map((ref) => ({ ref, resolvedTo: resolvedTo(ref) })),
      covers: item.covers.map((ref) => ({ ref, status: coverStatus(ref) })),
      forwardsTo: item.forwardsTo,
      defects: item.defects.map(defectDocument),
      wantedBy: wantedByDocument(item)
    };
  };
  const forwardDocument = (forward) => {
    const document = { from: forward.from, to: forward.to, ...location(forward), effective: forward.effective };
    if (!forward.effective) document.voidedBy = forward.voidedBy;
    return document;
  };
  const itemDocuments = items.map(itemDocument).sort(byLocation);
  const problemDocuments = problems.map((problem) => ({ ...location(problem), message: problem.message })).sort(byLocation);
  const summary = summarize(items, problems);
  return {
    schemaVersion: SCHEMA_VERSION,
    flashtrace: version,
    ok: isClean(summary),
    items: itemDocuments,
    forwards: forwards.map(forwardDocument).sort(byLocation),
    problems: problemDocuments,
    summary
  };
}
function reportJson(items, forwards, problems, cwd, opts = {}) {
  const document = buildReportDocument(items, forwards, problems, cwd, opts);
  console.log(JSON.stringify(document, null, 2));
  return document.ok;
}

// src/cli.mjs
var HELP = `Usage: flashtrace [options] [directory-or-file ...]

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

Exit codes: 0 clean, 1 defects or problems found, 2 usage error`;
function packageVersion() {
  const pkg = new URL("../package.json", import.meta.url);
  return JSON.parse(readFileSync(pkg, "utf8")).version;
}
function splitLongOption(token) {
  const eqIndex = token.startsWith("--") ? token.indexOf("=") : -1;
  return eqIndex === -1 ? [token, void 0] : [token.slice(0, eqIndex), token.slice(eqIndex + 1)];
}
function rejectValue(name, inline) {
  if (inline !== void 0) throw new UsageError(`option ${name} does not take a value`);
}
function reportFormat(raw, value) {
  if (value !== "text" && value !== "json")
    throw new UsageError(`invalid value for ${raw}: "${value}" (expected "text" or "json")`);
  return value;
}
var LONG_ALIAS = {
  "-h": "--help",
  "-v": "--verbose",
  "-V": "--version",
  "-t": "--tags",
  "-f": "--format"
};
function printHelp() {
  console.log(HELP);
  process3.exit(0);
}
function printVersion() {
  console.log(packageVersion());
  process3.exit(0);
}
function enableVerbose(opts) {
  opts.verbose = true;
}
function selectJsonFormat(opts) {
  opts.format = "json";
}
var VALUELESS_OPTIONS = /* @__PURE__ */ new Map([
  ["--help", printHelp],
  ["--version", printVersion],
  ["--verbose", enableVerbose],
  ["--json", selectJsonFormat]
]);
function setFormat(opts, raw, value) {
  opts.format = reportFormat(raw, value);
}
function setTags(opts, raw, value) {
  opts.tags = value.split(",").map((tag) => tag.trim()).filter(Boolean);
}
var VALUED_OPTIONS = /* @__PURE__ */ new Map([
  ["--format", setFormat],
  ["--tags", setTags]
]);
function parseArgs(argv) {
  const opts = { dirs: [], tags: null, verbose: false, format: "text" };
  for (let i = 0; i < argv.length; i++) {
    const [raw, inline] = splitLongOption(argv[i]);
    const name = LONG_ALIAS[raw] ?? raw;
    const applyValuelessOption = VALUELESS_OPTIONS.get(name);
    const applyValuedOption = VALUED_OPTIONS.get(name);
    if (applyValuelessOption) {
      rejectValue(raw, inline);
      applyValuelessOption(opts);
    } else if (applyValuedOption) {
      const value = inline ?? argv[++i];
      if (!value) throw new UsageError(`missing value for ${raw}`);
      applyValuedOption(opts, raw, value);
    } else if (raw.startsWith("-")) {
      throw new UsageError(`unknown option: ${raw}`);
    } else {
      opts.dirs.push(raw);
    }
  }
  if (opts.format === "json" && opts.verbose)
    throw new UsageError("-v/--verbose applies to the text format only");
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
    const ext = path5.extname(file).toLowerCase();
    items.push(
      ...SPEC_EXT.has(ext) ? parseMarkdown(file, text, problems, forwards) : parseCode(file, text, problems, forwards)
    );
  }
  if (opts.tags) {
    const wantUntagged = opts.tags.includes("_");
    items = items.filter(
      (item) => item.origin === "code" || item.tags.some((tag) => opts.tags.includes(tag)) || wantUntagged && item.tags.length === 0
    );
  }
  analyze(items, forwards, problems);
  const clean = opts.format === "json" ? reportJson(items, forwards, problems, process3.cwd(), { version: packageVersion() }) : report(items, problems, process3.cwd(), { verbose: opts.verbose });
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
  DEFECT_KINDS,
  UsageError,
  analyze,
  buildReportDocument,
  collectFiles,
  parseCode,
  parseMarkdown,
  reportJson
};
