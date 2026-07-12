/*
 * Comment grammars per file extension.
 *
 * A leaf grammar is a comment vocabulary: zero or more line markers and zero or
 * more [open, close] block-comment pairs. A block pair may carry a third truthy
 * element to mark it nestable (`[open, close, true]`), for languages whose block
 * comments nest (Rust, Swift, Kotlin, Scala). A composite grammar layers region
 * rules on top of a default leaf grammar, so a single file can switch comment
 * style by region - e.g. an HTML/Vue file is HTML by default but uses JS
 * comments inside <script> and CSS comments inside <style>. A region's `grammar`
 * may be a resolver `(openingTag) => leaf` when the embedded language depends on
 * the tag's attributes (e.g. `<script type="application/json">`).
 *
 * `grammarFor(ext)` resolves a file extension to its grammar; `CODE_EXT` is the
 * set of every extension we know how to scan and is the single source of truth
 * for code-file collection.
 */

// Shared leaf grammars, reused across the extension map below. cLike is also the
// fallback grammar for unknown extensions (see parse-code.mjs).
export const cLike = { line: ['//'], block: [['/*', '*/']] };
// Like cLike, but /* */ nests (Rust, Swift, Kotlin, Scala).
const cLikeNested = { line: ['//'], block: [['/*', '*/', true]] };
// PHP accepts // and # line comments plus /* */.
const php = { line: ['//', '#'], block: [['/*', '*/']] };
const hash = { line: ['#'], block: [] };
// Hash line comments plus the language's own block pair. Julia's #= =# and
// Nim's #[ ]# nest per their specs; CoffeeScript's ### ### does not.
const coffee = { line: ['#'], block: [['###', '###']] };
const julia = { line: ['#'], block: [['#=', '=#', true]] };
const nim = { line: ['#'], block: [['#[', ']#', true]] };
const powershell = { line: ['#'], block: [['<#', '#>']] };
const sql = { line: ['--'], block: [['/*', '*/']] };
const lua = { line: ['--'], block: [['--[[', ']]']] };
const haskell = { line: ['--'], block: [['{-', '-}', true]] };
const css = { line: [], block: [['/*', '*/']] };
const xml = { line: [], block: [['<!--', '-->']] };
// A comment-less grammar, for embedded content that has no comments (JSON).
const none = { line: [], block: [] };
const semicolon = { line: [';'], block: [] };
// Scheme adds nestable #| |# datum-style block comments on top of ; lines.
const scheme = { line: [';'], block: [['#|', '|#', true]] };
const percent = { line: ['%'], block: [] };
const dashLine = { line: ['--'], block: [] };
// OCaml/F# (* *) nest per spec; Pascal's (* *) does not, so it keeps a plain pair.
const ml = { line: [], block: [['(*', '*)', true]] };
const fsharp = { line: ['//'], block: [['(*', '*)', true]] };
const pascal = { line: ['//'], block: [['{', '}'], ['(*', '*)']] };
const hcl = { line: ['#', '//'], block: [['/*', '*/']] };

// value of a `name="..."` attribute in an opening tag, lowercased, or ''. The
// leading whitespace keeps `type=` from matching inside e.g. `data-type=`.
function attrOf(tag, name) {
  const m = new RegExp(String.raw`\s${name}\s*=\s*["']?([^"'\s>]+)`, 'i').exec(tag);
  return m ? m[1].toLowerCase() : '';
}

// <script>/<style> embed different languages depending on type/lang; pick the
// comment grammar from the opening tag rather than always assuming C-like/CSS.
function scriptGrammar(tag) {
  const type = attrOf(tag, 'type');
  if (/json|importmap/.test(type)) return none; // JSON / import maps: no comments
  if (/template|html/.test(type)) return xml; // inline HTML templates
  if (/coffee/.test(attrOf(tag, 'lang'))) return coffee; // CoffeeScript
  return cLike; // JS / TS / JSX / module / ...
}
function styleGrammar(tag) {
  // SCSS, Sass and Less add `//` line comments on top of CSS `/* */`.
  return /s[ac]ss|less|stylus|styl/.test(attrOf(tag, 'lang')) ? cLike : css;
}

// HTML-family files: HTML comments in markup, but JS comments inside <script>
// and CSS comments inside <style>. Region enter/exit patterns are global so the
// scanner can resume matching from an arbitrary offset (see parse-code.mjs).
const html = {
  default: xml,
  regions: [
    { enter: /<script\b[^>]*>/gi, exit: /<\/script\s*>/gi, grammar: scriptGrammar },
    { enter: /<style\b[^>]*>/gi, exit: /<\/style\s*>/gi, grammar: styleGrammar },
  ],
};

const BY_EXT = {
  // C-family: // line, /* */ block
  '.ts': cLike, '.js': cLike, '.mjs': cLike, '.cjs': cLike,
  '.jsx': cLike, '.tsx': cLike, '.cts': cLike, '.mts': cLike,
  '.c': cLike, '.h': cLike, '.cpp': cLike, '.cc': cLike, '.hpp': cLike,
  '.cs': cLike, '.java': cLike, '.go': cLike,
  '.dart': cLike, '.php': php, '.proto': cLike,
  '.scss': cLike, '.less': cLike,
  // C-family with nested block comments
  '.rs': cLikeNested, '.swift': cLikeNested,
  '.kt': cLikeNested, '.kts': cLikeNested, '.scala': cLikeNested,
  // hash line comments
  '.py': hash, '.rb': hash, '.sh': hash, '.bash': hash, '.zsh': hash,
  '.yaml': hash, '.yml': hash, '.toml': hash, '.r': hash, '.pm': hash,
  '.ex': hash, '.exs': hash, '.tcl': hash,
  '.graphql': hash, '.gql': hash,
  // hash line comments plus a block pair of their own
  '.jl': julia, '.nim': nim, '.coffee': coffee,
  '.ps1': powershell, '.psm1': powershell,
  '.tf': hcl, '.tfvars': hcl, '.hcl': hcl,
  // semicolon (Lisp family)
  '.clj': semicolon, '.cljs': semicolon, '.cljc': semicolon, '.edn': semicolon,
  '.el': semicolon, '.lisp': semicolon,
  // Scheme: ; lines plus nestable #| |# blocks
  '.scm': scheme, '.ss': scheme,
  // percent (Erlang, LaTeX)
  '.erl': percent, '.hrl': percent, '.tex': percent, '.sty': percent,
  // dash line-only (Ada, VHDL)
  '.adb': dashLine, '.ads': dashLine, '.vhd': dashLine, '.vhdl': dashLine,
  // ML-family
  '.ml': ml, '.mli': ml, '.fs': fsharp, '.fsi': fsharp, '.fsx': fsharp,
  '.pas': pascal, '.dpr': pascal,
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
