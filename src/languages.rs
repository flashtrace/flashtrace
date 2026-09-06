/*
 * Comment grammars per file extension.
 *
 * A leaf grammar is a comment vocabulary: zero or more line markers and zero
 * or more open/close block-comment pairs. A block pair may be marked nestable,
 * for languages whose block comments nest (Rust, Swift, Kotlin, Scala). A
 * composite grammar layers region rules on top of a default leaf grammar, so
 * a single file can switch comment style by region - e.g. an HTML/Vue file is
 * HTML by default but uses JS comments inside <script> and CSS comments
 * inside <style>. A region's grammar may be a resolver picking the leaf from
 * the opening tag when the embedded language depends on its attributes (e.g.
 * `<script type="application/json">`).
 *
 * `grammar_for(ext)` resolves a file extension to its grammar; `CODE_EXT` is
 * the set of every extension we know how to scan and is the single source of
 * truth for code-file collection. Both are views of the one `BY_EXT` table.
 * Extensions are spelled lowercased and without their leading dot, as
 * `std::path::Path::extension` yields them.
 */

use std::sync::LazyLock;

use regex::Regex;

#[derive(Debug, PartialEq, Eq)]
pub struct BlockPair {
    pub open: &'static str,
    pub close: &'static str,
    pub nestable: bool,
}

const fn pair(open: &'static str, close: &'static str) -> BlockPair {
    BlockPair {
        open,
        close,
        nestable: false,
    }
}

const fn nesting_pair(open: &'static str, close: &'static str) -> BlockPair {
    BlockPair {
        open,
        close,
        nestable: true,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Leaf {
    pub line: &'static [&'static str],
    pub block: &'static [BlockPair],
}

// Shared leaf grammars, reused across the extension table below. C_LIKE is
// also the fallback grammar for unknown extensions (see parse_code.rs).
pub static C_LIKE: Leaf = Leaf {
    line: &["//"],
    block: &[pair("/*", "*/")],
};
// Like C_LIKE, but /* */ nests (Rust, Swift, Kotlin, Scala).
static C_LIKE_NESTED: Leaf = Leaf {
    line: &["//"],
    block: &[nesting_pair("/*", "*/")],
};
// PHP accepts // and # line comments plus /* */.
static PHP: Leaf = Leaf {
    line: &["//", "#"],
    block: &[pair("/*", "*/")],
};
static HASH: Leaf = Leaf {
    line: &["#"],
    block: &[],
};
// Hash line comments plus the language's own block pair. Julia's #= =# and
// Nim's #[ ]# nest per their specs; CoffeeScript's ### ### does not.
// CoffeeScript's ### opens a block only when no further # follows, so `#### x`
// and `##########` are line comments. The #### line marker outranks the ###
// opener by the longest-match tie-break, which degrades every run of four or
// more to a line comment while a bare ### still opens a block.
static COFFEE: Leaf = Leaf {
    line: &["#", "####"],
    block: &[pair("###", "###")],
};
static JULIA: Leaf = Leaf {
    line: &["#"],
    block: &[nesting_pair("#=", "=#")],
};
// Nim also has ##[ ]## doc blocks; the longer opener wins the tie against both
// # and #[ at the same position, so doc blocks are recognized as such.
static NIM: Leaf = Leaf {
    line: &["#"],
    block: &[nesting_pair("#[", "]#"), nesting_pair("##[", "]##")],
};
// CMake bracket comments: #[[ opens, ]] closes, and they do not nest. Like Lua
// we recognize the base level, not the equal-signed #[=[ ... ]=] variants.
static CMAKE: Leaf = Leaf {
    line: &["#"],
    block: &[pair("#[[", "]]")],
};
static POWERSHELL: Leaf = Leaf {
    line: &["#"],
    block: &[pair("<#", "#>")],
};
static SQL: Leaf = Leaf {
    line: &["--"],
    block: &[pair("/*", "*/")],
};
static LUA: Leaf = Leaf {
    line: &["--"],
    block: &[pair("--[[", "]]")],
};
static HASKELL: Leaf = Leaf {
    line: &["--"],
    block: &[nesting_pair("{-", "-}")],
};
static CSS: Leaf = Leaf {
    line: &[],
    block: &[pair("/*", "*/")],
};
static XML: Leaf = Leaf {
    line: &[],
    block: &[pair("<!--", "-->")],
};
// A comment-less grammar, for embedded content that has no comments (JSON).
static NONE: Leaf = Leaf {
    line: &[],
    block: &[],
};
static SEMICOLON: Leaf = Leaf {
    line: &[";"],
    block: &[],
};
// Scheme and Racket add nestable #| |# block comments on top of ; lines.
static SCHEME: Leaf = Leaf {
    line: &[";"],
    block: &[nesting_pair("#|", "|#")],
};
static PERCENT: Leaf = Leaf {
    line: &["%"],
    block: &[],
};
static DASH_LINE: Leaf = Leaf {
    line: &["--"],
    block: &[],
};
// OCaml/F# (* *) nest per spec; Pascal's (* *) does not, so it keeps a plain pair.
static ML: Leaf = Leaf {
    line: &[],
    block: &[nesting_pair("(*", "*)")],
};
static FSHARP: Leaf = Leaf {
    line: &["//"],
    block: &[nesting_pair("(*", "*)")],
};
static PASCAL: Leaf = Leaf {
    line: &["//"],
    block: &[pair("{", "}"), pair("(*", "*)")],
};
static HCL: Leaf = Leaf {
    line: &["#", "//"],
    block: &[pair("/*", "*/")],
};

// value of a `name="..."` attribute in an opening tag, lowercased, or ''. The
// leading whitespace keeps `type=` from matching inside e.g. `data-type=`.
fn attribute_regex(name: &str) -> Regex {
    Regex::new(&format!(r#"(?i)\s{name}\s*=\s*["']?([^"'\s>]+)"#)).unwrap()
}

static TYPE_ATTRIBUTE_RE: LazyLock<Regex> = LazyLock::new(|| attribute_regex("type"));
static LANG_ATTRIBUTE_RE: LazyLock<Regex> = LazyLock::new(|| attribute_regex("lang"));

fn attribute_of(tag: &str, re: &Regex) -> String {
    re.captures(tag)
        .map(|m| m.get(1).unwrap().as_str().to_lowercase())
        .unwrap_or_default()
}

// <script>/<style> embed different languages depending on type/lang; pick the
// comment grammar from the opening tag rather than always assuming C-like/CSS.
fn script_grammar(tag: &str) -> &'static Leaf {
    let type_attribute = attribute_of(tag, &TYPE_ATTRIBUTE_RE);
    if type_attribute.contains("json") || type_attribute.contains("importmap") {
        return &NONE; // JSON / import maps: no comments
    }
    if type_attribute.contains("template") || type_attribute.contains("html") {
        return &XML; // inline HTML templates
    }
    if attribute_of(tag, &LANG_ATTRIBUTE_RE).contains("coffee") {
        return &COFFEE; // CoffeeScript
    }
    &C_LIKE // JS / TS / JSX / module / ...
}

fn style_grammar(tag: &str) -> &'static Leaf {
    // SCSS, Sass and Less add `//` line comments on top of CSS `/* */`;
    // "styl" also covers "stylus"
    let lang = attribute_of(tag, &LANG_ATTRIBUTE_RE);
    if ["sass", "scss", "less", "styl"]
        .iter()
        .any(|name| lang.contains(name))
    {
        &C_LIKE
    } else {
        &CSS
    }
}

/// how a composite region picks its leaf grammar: fixed, or resolved from the
/// opening tag's attributes
pub enum RegionGrammar {
    Fixed(&'static Leaf),
    Resolver(fn(&str) -> &'static Leaf),
}

pub struct Region {
    pub enter: Regex,
    pub exit: Regex,
    pub grammar: RegionGrammar,
}

pub struct Composite {
    pub default: &'static Leaf,
    pub regions: Vec<Region>,
}

// HTML-family files: HTML comments in markup, but JS comments inside <script>
// and CSS comments inside <style>.
static HTML: LazyLock<Composite> = LazyLock::new(|| Composite {
    default: &XML,
    regions: vec![
        Region {
            enter: Regex::new(r"(?i)<script\b[^>]*>").unwrap(),
            exit: Regex::new(r"(?i)</script\s*>").unwrap(),
            grammar: RegionGrammar::Resolver(script_grammar),
        },
        Region {
            enter: Regex::new(r"(?i)<style\b[^>]*>").unwrap(),
            exit: Regex::new(r"(?i)</style\s*>").unwrap(),
            grammar: RegionGrammar::Resolver(style_grammar),
        },
    ],
});

/// a file's comment grammar: a plain leaf, or a composite with regions
#[derive(Clone, Copy)]
pub enum Grammar {
    Leaf(&'static Leaf),
    Composite(&'static Composite),
}

impl Grammar {
    /// a stable identity for grouping extensions by shared grammar: two
    /// extensions share a grammar exactly when they resolve to the same
    /// static grammar value
    pub fn identity(self) -> usize {
        match self {
            Grammar::Leaf(leaf) => std::ptr::from_ref(leaf) as usize,
            Grammar::Composite(composite) => std::ptr::from_ref(composite) as usize,
        }
    }
}

static BY_EXT: LazyLock<Vec<(&'static str, Grammar)>> = LazyLock::new(|| {
    let leaf = |ext: &'static str, leaf: &'static Leaf| (ext, Grammar::Leaf(leaf));
    let html = |ext: &'static str| (ext, Grammar::Composite(&HTML));
    vec![
        // C-family: // line, /* */ block
        leaf("ts", &C_LIKE),
        leaf("js", &C_LIKE),
        leaf("mjs", &C_LIKE),
        leaf("cjs", &C_LIKE),
        leaf("jsx", &C_LIKE),
        leaf("tsx", &C_LIKE),
        leaf("cts", &C_LIKE),
        leaf("mts", &C_LIKE),
        leaf("c", &C_LIKE),
        leaf("h", &C_LIKE),
        leaf("cpp", &C_LIKE),
        leaf("cc", &C_LIKE),
        leaf("hpp", &C_LIKE),
        leaf("cxx", &C_LIKE),
        leaf("hxx", &C_LIKE),
        leaf("ino", &C_LIKE),
        leaf("inl", &C_LIKE),
        leaf("tpp", &C_LIKE),
        leaf("cs", &C_LIKE),
        leaf("java", &C_LIKE),
        leaf("go", &C_LIKE),
        leaf("groovy", &C_LIKE),
        leaf("gradle", &C_LIKE),
        leaf("sol", &C_LIKE),
        leaf("dart", &C_LIKE),
        leaf("php", &PHP),
        leaf("proto", &C_LIKE),
        leaf("scss", &C_LIKE),
        leaf("less", &C_LIKE),
        // C-family with nested block comments
        leaf("rs", &C_LIKE_NESTED),
        leaf("swift", &C_LIKE_NESTED),
        leaf("kt", &C_LIKE_NESTED),
        leaf("kts", &C_LIKE_NESTED),
        leaf("scala", &C_LIKE_NESTED),
        // hash line comments
        leaf("py", &HASH),
        leaf("rb", &HASH),
        leaf("sh", &HASH),
        leaf("bash", &HASH),
        leaf("zsh", &HASH),
        leaf("yaml", &HASH),
        leaf("yml", &HASH),
        leaf("toml", &HASH),
        leaf("r", &HASH),
        leaf("pm", &HASH),
        leaf("ex", &HASH),
        leaf("exs", &HASH),
        leaf("tcl", &HASH),
        leaf("cr", &HASH),
        leaf("gd", &HASH),
        leaf("awk", &HASH),
        leaf("graphql", &HASH),
        leaf("gql", &HASH),
        // hash line comments plus a block pair of their own
        leaf("jl", &JULIA),
        leaf("nim", &NIM),
        leaf("coffee", &COFFEE),
        leaf("cmake", &CMAKE),
        leaf("ps1", &POWERSHELL),
        leaf("psm1", &POWERSHELL),
        leaf("tf", &HCL),
        leaf("tfvars", &HCL),
        leaf("hcl", &HCL),
        // semicolon (Lisp family)
        leaf("clj", &SEMICOLON),
        leaf("cljs", &SEMICOLON),
        leaf("cljc", &SEMICOLON),
        leaf("edn", &SEMICOLON),
        leaf("el", &SEMICOLON),
        leaf("lisp", &SEMICOLON),
        // Scheme/Racket: ; lines plus nestable #| |# blocks
        leaf("scm", &SCHEME),
        leaf("ss", &SCHEME),
        leaf("rkt", &SCHEME),
        // percent (Erlang, LaTeX)
        leaf("erl", &PERCENT),
        leaf("hrl", &PERCENT),
        leaf("tex", &PERCENT),
        leaf("sty", &PERCENT),
        // dash line-only (Ada, VHDL)
        leaf("adb", &DASH_LINE),
        leaf("ads", &DASH_LINE),
        leaf("vhd", &DASH_LINE),
        leaf("vhdl", &DASH_LINE),
        // ML-family
        leaf("ml", &ML),
        leaf("mli", &ML),
        leaf("fs", &FSHARP),
        leaf("fsi", &FSHARP),
        leaf("fsx", &FSHARP),
        leaf("pas", &PASCAL),
        leaf("dpr", &PASCAL),
        // dashes and others
        leaf("sql", &SQL),
        leaf("lua", &LUA),
        leaf("hs", &HASKELL),
        leaf("elm", &HASKELL),
        leaf("purs", &HASKELL),
        leaf("css", &CSS),
        leaf("xml", &XML),
        leaf("svg", &XML),
        // composite: HTML markup with embedded <script>/<style> regions
        html("vue"),
        html("html"),
        html("htm"),
        html("svelte"),
    ]
});

/// every extension the scanner knows, in the table's order
pub static CODE_EXT: LazyLock<Vec<&'static str>> =
    LazyLock::new(|| BY_EXT.iter().map(|(ext, _)| *ext).collect());

/// Grammar for a lowercased extension, or None when it is not a known code file.
pub fn grammar_for(ext: &str) -> Option<Grammar> {
    BY_EXT
        .iter()
        .find(|(known, _)| *known == ext)
        .map(|(_, grammar)| *grammar)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_ext_and_the_grammar_table_are_two_views_of_one_map() {
        assert_eq!(CODE_EXT.len(), BY_EXT.len());
        for ext in CODE_EXT.iter() {
            assert!(grammar_for(ext).is_some(), "{ext}");
        }
        assert!(grammar_for("md").is_none());
        assert!(grammar_for("unknown").is_none());
        assert!(grammar_for("").is_none());
        // the table speaks Path::extension's dotless spelling only
        assert!(grammar_for(".ts").is_none());
    }

    #[test]
    fn no_extension_is_listed_twice() {
        let unique: std::collections::HashSet<&str> = CODE_EXT.iter().copied().collect();
        assert_eq!(unique.len(), CODE_EXT.len());
    }

    #[test]
    fn script_grammar_resolves_from_the_opening_tag() {
        assert!(std::ptr::eq(script_grammar("<script>"), &C_LIKE));
        assert!(std::ptr::eq(
            script_grammar("<script setup lang=\"ts\">"),
            &C_LIKE
        ));
        assert!(std::ptr::eq(
            script_grammar("<script type=\"application/json\">"),
            &NONE
        ));
        assert!(std::ptr::eq(
            script_grammar("<script type=\"importmap\">"),
            &NONE
        ));
        assert!(std::ptr::eq(
            script_grammar("<script type=\"text/x-template\">"),
            &XML
        ));
        assert!(std::ptr::eq(
            script_grammar("<script lang=\"coffee\">"),
            &COFFEE
        ));
        // the leading-whitespace guard: data-type is not type
        assert!(std::ptr::eq(
            script_grammar("<script data-type=\"json\">"),
            &C_LIKE
        ));
    }

    #[test]
    fn style_grammar_resolves_from_the_opening_tag() {
        assert!(std::ptr::eq(style_grammar("<style>"), &CSS));
        assert!(std::ptr::eq(style_grammar("<style scoped>"), &CSS));
        for lang in ["scss", "sass", "less", "stylus", "styl"] {
            assert!(
                std::ptr::eq(style_grammar(&format!("<style lang=\"{lang}\">")), &C_LIKE),
                "{lang}"
            );
        }
    }
}
