/*
 * Comment grammars per file extension.
 *
 * A grammar is a comment vocabulary: zero or more line markers and zero or more
 * [open, close] block-comment pairs. `grammarFor(ext)` resolves a file extension
 * to its grammar; `CODE_EXT` is the set of every extension we know how to scan
 * and is the single source of truth for code-file collection.
 */

// Shared leaf grammars, reused across the extension map below.
const cLike = { line: ['//'], block: [['/*', '*/']] };
const hash = { line: ['#'], block: [] };
const powershell = { line: ['#'], block: [['<#', '#>']] };
const sql = { line: ['--'], block: [['/*', '*/']] };
const lua = { line: ['--'], block: [['--[[', ']]']] };
const haskell = { line: ['--'], block: [['{-', '-}']] };
const css = { line: [], block: [['/*', '*/']] };
const xml = { line: [], block: [['<!--', '-->']] };
// A Vue single-file component mixes HTML, JS and CSS comment styles; until the
// per-region model lands it is scanned as the union of those markers.
const vue = { line: ['//'], block: [['/*', '*/'], ['<!--', '-->']] };

const BY_EXT = {
  // C-family: // line, /* */ block
  '.ts': cLike, '.js': cLike, '.mjs': cLike, '.cjs': cLike,
  '.jsx': cLike, '.tsx': cLike, '.cts': cLike, '.mts': cLike,
  '.c': cLike, '.h': cLike, '.cpp': cLike, '.cc': cLike, '.hpp': cLike,
  '.cs': cLike, '.java': cLike, '.go': cLike, '.rs': cLike,
  '.swift': cLike, '.kt': cLike, '.kts': cLike, '.scala': cLike,
  '.dart': cLike, '.php': cLike, '.proto': cLike,
  '.scss': cLike, '.less': cLike,
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
  '.vue': vue,
};

export const CODE_EXT = new Set(Object.keys(BY_EXT));

// Grammar for a lowercased extension, or null when it is not a known code file.
export const grammarFor = (ext) => BY_EXT[ext] ?? null;
