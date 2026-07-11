/*
 * Comment grammars per file extension.
 *
 * A leaf grammar is a comment vocabulary: zero or more line markers and zero or
 * more [open, close] block-comment pairs. A block pair may carry a third truthy
 * element to mark it nestable (`[open, close, true]`), for languages whose block
 * comments nest (Rust, Swift, Kotlin, Scala). A composite grammar layers region
 * rules on top of a default leaf grammar, so a single file can switch comment
 * style by region - e.g. an HTML/Vue file is HTML by default but uses JS
 * comments inside <script> and CSS comments inside <style>.
 *
 * `grammarFor(ext)` resolves a file extension to its grammar; `CODE_EXT` is the
 * set of every extension we know how to scan and is the single source of truth
 * for code-file collection.
 */

// Shared leaf grammars, reused across the extension map below.
const cLike = { line: ['//'], block: [['/*', '*/']] };
// Like cLike, but /* */ nests (Rust, Swift, Kotlin, Scala).
const cLikeNested = { line: ['//'], block: [['/*', '*/', true]] };
const hash = { line: ['#'], block: [] };
const powershell = { line: ['#'], block: [['<#', '#>']] };
const sql = { line: ['--'], block: [['/*', '*/']] };
const lua = { line: ['--'], block: [['--[[', ']]']] };
const haskell = { line: ['--'], block: [['{-', '-}']] };
const css = { line: [], block: [['/*', '*/']] };
const xml = { line: [], block: [['<!--', '-->']] };

// HTML-family files: HTML comments in markup, but JS comments inside <script>
// and CSS comments inside <style>. Region enter/exit patterns are global so the
// scanner can resume matching from an arbitrary offset (see parse-code.mjs).
const html = {
  default: xml,
  regions: [
    { enter: /<script\b[^>]*>/gi, exit: /<\/script\s*>/gi, grammar: cLike },
    { enter: /<style\b[^>]*>/gi, exit: /<\/style\s*>/gi, grammar: css },
  ],
};

const BY_EXT = {
  // C-family: // line, /* */ block
  '.ts': cLike, '.js': cLike, '.mjs': cLike, '.cjs': cLike,
  '.jsx': cLike, '.tsx': cLike, '.cts': cLike, '.mts': cLike,
  '.c': cLike, '.h': cLike, '.cpp': cLike, '.cc': cLike, '.hpp': cLike,
  '.cs': cLike, '.java': cLike, '.go': cLike,
  '.dart': cLike, '.php': cLike, '.proto': cLike,
  '.scss': cLike, '.less': cLike,
  // C-family with nested block comments
  '.rs': cLikeNested, '.swift': cLikeNested,
  '.kt': cLikeNested, '.kts': cLikeNested, '.scala': cLikeNested,
  // hash line comments
  '.py': hash, '.rb': hash, '.sh': hash, '.bash': hash, '.zsh': hash,
  '.yaml': hash, '.yml': hash, '.toml': hash, '.r': hash, '.pl': hash, '.pm': hash,
  '.ps1': powershell, '.psm1': powershell,
  // dashes and others
  '.sql': sql,
  '.lua': lua,
  '.hs': haskell,
  '.css': css,
  '.xml': xml, '.svg': xml,
  // composite: HTML markup with embedded <script>/<style> regions
  '.vue': html, '.html': html, '.htm': html, '.svelte': html,
};

export const CODE_EXT = new Set(Object.keys(BY_EXT));

// Grammar for a lowercased extension, or null when it is not a known code file.
export const grammarFor = (ext) => BY_EXT[ext] ?? null;
