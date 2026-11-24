/*
 * Comment and string grammars per file extension.
 *
 * A leaf grammar pairs a comment family with a string family. A comment
 * family is a comment vocabulary: zero or more line markers and zero or more
 * open/close block-comment pairs. A block pair may be marked nestable, for
 * languages whose block comments nest (Rust, Swift, Kotlin, Scala). A string
 * family lists the literal forms that hide comment markers from the scanner:
 * quoted strings, character literals and prefixed character literals, each
 * recognized on a single line only (see StringForm). Comment families are
 * shared by many languages that disagree on strings, so the two are kept
 * apart and combined per extension in the table below. A
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

/// a comment family: line markers and block-comment pairs
#[derive(Debug, PartialEq, Eq)]
pub struct Comments {
    pub line: &'static [&'static str],
    pub block: &'static [BlockPair],
}

/// One literal form that hides comment markers. Every form ends at the end of
/// its line at the latest: multi-line literals (triple quotes, raw strings,
/// heredocs) are out of scope, so a literal still open at a line end is
/// treated as closed there, and a misread quote costs at most one line.
#[derive(Debug, PartialEq, Eq)]
pub enum StringForm {
    /// `quote … quote`; the escape character, if any, makes the character
    /// after it part of the literal. A language that escapes its quote by
    /// doubling it (`'it''s'`) needs no escape: a doubled quote closes the
    /// literal and immediately reopens it, which hides the same text.
    Quoted { quote: char, escape: Option<char> },
    /// `'c'` or `'\…'`: an apostrophe, one character or an escape sequence,
    /// and a closing apostrophe. An apostrophe that does not start such a
    /// literal (a Rust lifetime `'a`, a digit separator `1'000`, a prime
    /// `x'`) is ordinary code, so this form never hides more than a short
    /// literal.
    CharacterLiteral { escape: Option<char> },
    /// `prefix` followed by one character, or by the escape character and one
    /// more character - e.g. Clojure `\"`, Scheme `#\;`, Erlang `$%`.
    PrefixedCharacter {
        prefix: &'static str,
        escape: Option<char>,
    },
}

/// a leaf grammar: one comment family combined with one string family
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Leaf {
    pub comments: &'static Comments,
    pub strings: &'static [StringForm],
}

const fn comments_only(comments: &'static Comments) -> Leaf {
    Leaf {
        comments,
        strings: NO_STRINGS,
    }
}

/// the string family of languages whose literals the scanner does not know
pub static NO_STRINGS: &[StringForm] = &[];

// Shared comment families, reused across the extension table below. C_LIKE is
// also the fallback comment family for unknown extensions (see parse_code.rs).
pub static C_LIKE: Comments = Comments {
    line: &["//"],
    block: &[pair("/*", "*/")],
};
// Like C_LIKE, but /* */ nests (Rust, Swift, Kotlin, Scala).
static C_LIKE_NESTED: Comments = Comments {
    line: &["//"],
    block: &[nesting_pair("/*", "*/")],
};
// PHP accepts // and # line comments plus /* */.
static PHP: Comments = Comments {
    line: &["//", "#"],
    block: &[pair("/*", "*/")],
};
static HASH: Comments = Comments {
    line: &["#"],
    block: &[],
};
// Hash line comments plus the language's own block pair. Julia's #= =# and
// Nim's #[ ]# nest per their specs; CoffeeScript's ### ### does not.
// CoffeeScript's ### opens a block only when no further # follows, so `#### x`
// and `##########` are line comments. The #### line marker outranks the ###
// opener by the longest-match tie-break, which degrades every run of four or
// more to a line comment while a bare ### still opens a block.
static COFFEE: Comments = Comments {
    line: &["#", "####"],
    block: &[pair("###", "###")],
};
static JULIA: Comments = Comments {
    line: &["#"],
    block: &[nesting_pair("#=", "=#")],
};
// Nim also has ##[ ]## doc blocks; the longer opener wins the tie against both
// # and #[ at the same position, so doc blocks are recognized as such.
static NIM: Comments = Comments {
    line: &["#"],
    block: &[nesting_pair("#[", "]#"), nesting_pair("##[", "]##")],
};
// CMake bracket comments: #[[ opens, ]] closes, and they do not nest. Like Lua
// we recognize the base level, not the equal-signed #[=[ ... ]=] variants.
static CMAKE: Comments = Comments {
    line: &["#"],
    block: &[pair("#[[", "]]")],
};
static POWERSHELL: Comments = Comments {
    line: &["#"],
    block: &[pair("<#", "#>")],
};
static SQL: Comments = Comments {
    line: &["--"],
    block: &[pair("/*", "*/")],
};
static LUA: Comments = Comments {
    line: &["--"],
    block: &[pair("--[[", "]]")],
};
static HASKELL: Comments = Comments {
    line: &["--"],
    block: &[nesting_pair("{-", "-}")],
};
static CSS: Comments = Comments {
    line: &[],
    block: &[pair("/*", "*/")],
};
static XML: Comments = Comments {
    line: &[],
    block: &[pair("<!--", "-->")],
};
// A comment-less grammar, for embedded content that has no comments (JSON).
static NONE: Comments = Comments {
    line: &[],
    block: &[],
};
static SEMICOLON: Comments = Comments {
    line: &[";"],
    block: &[],
};
// Scheme and Racket add nestable #| |# block comments on top of ; lines.
static SCHEME: Comments = Comments {
    line: &[";"],
    block: &[nesting_pair("#|", "|#")],
};
static PERCENT: Comments = Comments {
    line: &["%"],
    block: &[],
};
static DASH_LINE: Comments = Comments {
    line: &["--"],
    block: &[],
};
// OCaml/F# (* *) nest per spec; Pascal's (* *) does not, so it keeps a plain pair.
static ML: Comments = Comments {
    line: &[],
    block: &[nesting_pair("(*", "*)")],
};
static FSHARP: Comments = Comments {
    line: &["//"],
    block: &[nesting_pair("(*", "*)")],
};
static PASCAL: Comments = Comments {
    line: &["//"],
    block: &[pair("{", "}"), pair("(*", "*)")],
};
static HCL: Comments = Comments {
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
fn script_grammar(tag: &str) -> Leaf {
    let type_attribute = attribute_of(tag, &TYPE_ATTRIBUTE_RE);
    if type_attribute.contains("json") || type_attribute.contains("importmap") {
        return comments_only(&NONE); // JSON / import maps: no comments
    }
    if type_attribute.contains("template") || type_attribute.contains("html") {
        return comments_only(&XML); // inline HTML templates
    }
    if attribute_of(tag, &LANG_ATTRIBUTE_RE).contains("coffee") {
        return comments_only(&COFFEE); // CoffeeScript
    }
    comments_only(&C_LIKE) // JS / TS / JSX / module / ...
}

fn style_grammar(tag: &str) -> Leaf {
    // SCSS, Sass and Less add `//` line comments on top of CSS `/* */`;
    // "styl" also covers "stylus"
    let lang = attribute_of(tag, &LANG_ATTRIBUTE_RE);
    if ["sass", "scss", "less", "styl"]
        .iter()
        .any(|name| lang.contains(name))
    {
        comments_only(&C_LIKE)
    } else {
        comments_only(&CSS)
    }
}

/// how a composite region picks its leaf grammar: fixed, or resolved from the
/// opening tag's attributes
pub enum RegionGrammar {
    Fixed(Leaf),
    Resolver(fn(&str) -> Leaf),
}

pub struct Region {
    pub enter: Regex,
    pub exit: Regex,
    pub grammar: RegionGrammar,
}

pub struct Composite {
    pub default: Leaf,
    pub regions: Vec<Region>,
}

// HTML-family files: HTML comments in markup, but JS comments inside <script>
// and CSS comments inside <style>.
static HTML: LazyLock<Composite> = LazyLock::new(|| Composite {
    default: comments_only(&XML),
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

/// a file's grammar: a plain leaf, or a composite with regions
#[derive(Clone, Copy)]
pub enum Grammar {
    Leaf(Leaf),
    Composite(&'static Composite),
}

impl Grammar {
    /// a stable identity for grouping extensions by shared comment grammar:
    /// two extensions share it exactly when they resolve to the same static
    /// comment family, or to the same composite. String families are left
    /// out on purpose - languages sharing comments but not strings still
    /// belong together.
    pub fn identity(self) -> usize {
        match self {
            Grammar::Leaf(leaf) => std::ptr::from_ref(leaf.comments) as usize,
            Grammar::Composite(composite) => std::ptr::from_ref(composite) as usize,
        }
    }
}

static BY_EXT: LazyLock<Vec<(&str, Grammar)>> = LazyLock::new(|| {
    let leaf = |ext: &'static str, comments: &'static Comments, strings: &'static [StringForm]| {
        (ext, Grammar::Leaf(Leaf { comments, strings }))
    };
    let html = |ext: &'static str| (ext, Grammar::Composite(&HTML));
    vec![
        // C-family: // line, /* */ block
        leaf("ts", &C_LIKE, NO_STRINGS),
        leaf("js", &C_LIKE, NO_STRINGS),
        leaf("mjs", &C_LIKE, NO_STRINGS),
        leaf("cjs", &C_LIKE, NO_STRINGS),
        leaf("jsx", &C_LIKE, NO_STRINGS),
        leaf("tsx", &C_LIKE, NO_STRINGS),
        leaf("cts", &C_LIKE, NO_STRINGS),
        leaf("mts", &C_LIKE, NO_STRINGS),
        leaf("c", &C_LIKE, NO_STRINGS),
        leaf("h", &C_LIKE, NO_STRINGS),
        leaf("cpp", &C_LIKE, NO_STRINGS),
        leaf("cc", &C_LIKE, NO_STRINGS),
        leaf("hpp", &C_LIKE, NO_STRINGS),
        leaf("cxx", &C_LIKE, NO_STRINGS),
        leaf("hxx", &C_LIKE, NO_STRINGS),
        leaf("ino", &C_LIKE, NO_STRINGS),
        leaf("inl", &C_LIKE, NO_STRINGS),
        leaf("tpp", &C_LIKE, NO_STRINGS),
        leaf("cs", &C_LIKE, NO_STRINGS),
        leaf("java", &C_LIKE, NO_STRINGS),
        leaf("go", &C_LIKE, NO_STRINGS),
        leaf("groovy", &C_LIKE, NO_STRINGS),
        leaf("gradle", &C_LIKE, NO_STRINGS),
        leaf("sol", &C_LIKE, NO_STRINGS),
        leaf("dart", &C_LIKE, NO_STRINGS),
        leaf("php", &PHP, NO_STRINGS),
        leaf("proto", &C_LIKE, NO_STRINGS),
        leaf("scss", &C_LIKE, NO_STRINGS),
        leaf("less", &C_LIKE, NO_STRINGS),
        // C-family with nested block comments
        leaf("rs", &C_LIKE_NESTED, NO_STRINGS),
        leaf("swift", &C_LIKE_NESTED, NO_STRINGS),
        leaf("kt", &C_LIKE_NESTED, NO_STRINGS),
        leaf("kts", &C_LIKE_NESTED, NO_STRINGS),
        leaf("scala", &C_LIKE_NESTED, NO_STRINGS),
        // hash line comments
        leaf("py", &HASH, NO_STRINGS),
        leaf("rb", &HASH, NO_STRINGS),
        leaf("sh", &HASH, NO_STRINGS),
        leaf("bash", &HASH, NO_STRINGS),
        leaf("zsh", &HASH, NO_STRINGS),
        leaf("yaml", &HASH, NO_STRINGS),
        leaf("yml", &HASH, NO_STRINGS),
        leaf("toml", &HASH, NO_STRINGS),
        leaf("r", &HASH, NO_STRINGS),
        leaf("pm", &HASH, NO_STRINGS),
        leaf("ex", &HASH, NO_STRINGS),
        leaf("exs", &HASH, NO_STRINGS),
        leaf("tcl", &HASH, NO_STRINGS),
        leaf("cr", &HASH, NO_STRINGS),
        leaf("gd", &HASH, NO_STRINGS),
        leaf("awk", &HASH, NO_STRINGS),
        leaf("graphql", &HASH, NO_STRINGS),
        leaf("gql", &HASH, NO_STRINGS),
        // hash line comments plus a block pair of their own
        leaf("jl", &JULIA, NO_STRINGS),
        leaf("nim", &NIM, NO_STRINGS),
        leaf("coffee", &COFFEE, NO_STRINGS),
        leaf("cmake", &CMAKE, NO_STRINGS),
        leaf("ps1", &POWERSHELL, NO_STRINGS),
        leaf("psm1", &POWERSHELL, NO_STRINGS),
        leaf("tf", &HCL, NO_STRINGS),
        leaf("tfvars", &HCL, NO_STRINGS),
        leaf("hcl", &HCL, NO_STRINGS),
        // semicolon (Lisp family)
        leaf("clj", &SEMICOLON, NO_STRINGS),
        leaf("cljs", &SEMICOLON, NO_STRINGS),
        leaf("cljc", &SEMICOLON, NO_STRINGS),
        leaf("edn", &SEMICOLON, NO_STRINGS),
        leaf("el", &SEMICOLON, NO_STRINGS),
        leaf("lisp", &SEMICOLON, NO_STRINGS),
        // Scheme/Racket: ; lines plus nestable #| |# blocks
        leaf("scm", &SCHEME, NO_STRINGS),
        leaf("ss", &SCHEME, NO_STRINGS),
        leaf("rkt", &SCHEME, NO_STRINGS),
        // percent (Erlang, LaTeX)
        leaf("erl", &PERCENT, NO_STRINGS),
        leaf("hrl", &PERCENT, NO_STRINGS),
        leaf("tex", &PERCENT, NO_STRINGS),
        leaf("sty", &PERCENT, NO_STRINGS),
        // dash line-only (Ada, VHDL)
        leaf("adb", &DASH_LINE, NO_STRINGS),
        leaf("ads", &DASH_LINE, NO_STRINGS),
        leaf("vhd", &DASH_LINE, NO_STRINGS),
        leaf("vhdl", &DASH_LINE, NO_STRINGS),
        // ML-family
        leaf("ml", &ML, NO_STRINGS),
        leaf("mli", &ML, NO_STRINGS),
        leaf("fs", &FSHARP, NO_STRINGS),
        leaf("fsi", &FSHARP, NO_STRINGS),
        leaf("fsx", &FSHARP, NO_STRINGS),
        leaf("pas", &PASCAL, NO_STRINGS),
        leaf("dpr", &PASCAL, NO_STRINGS),
        // dashes and others
        leaf("sql", &SQL, NO_STRINGS),
        leaf("lua", &LUA, NO_STRINGS),
        leaf("hs", &HASKELL, NO_STRINGS),
        leaf("elm", &HASKELL, NO_STRINGS),
        leaf("purs", &HASKELL, NO_STRINGS),
        leaf("css", &CSS, NO_STRINGS),
        leaf("xml", &XML, NO_STRINGS),
        leaf("svg", &XML, NO_STRINGS),
        // composite: HTML markup with embedded <script>/<style> regions
        html("vue"),
        html("html"),
        html("htm"),
        html("svelte"),
    ]
});

/// every extension the scanner knows, in the table's order
pub static CODE_EXT: LazyLock<Vec<&str>> =
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
        assert!(std::ptr::eq(script_grammar("<script>").comments, &C_LIKE));
        assert!(std::ptr::eq(
            script_grammar("<script setup lang=\"ts\">").comments,
            &C_LIKE
        ));
        assert!(std::ptr::eq(
            script_grammar("<script type=\"application/json\">").comments,
            &NONE
        ));
        assert!(std::ptr::eq(
            script_grammar("<script type=\"importmap\">").comments,
            &NONE
        ));
        assert!(std::ptr::eq(
            script_grammar("<script type=\"text/x-template\">").comments,
            &XML
        ));
        assert!(std::ptr::eq(
            script_grammar("<script lang=\"coffee\">").comments,
            &COFFEE
        ));
        // the leading-whitespace guard: data-type is not type
        assert!(std::ptr::eq(
            script_grammar("<script data-type=\"json\">").comments,
            &C_LIKE
        ));
    }

    #[test]
    fn style_grammar_resolves_from_the_opening_tag() {
        assert!(std::ptr::eq(style_grammar("<style>").comments, &CSS));
        assert!(std::ptr::eq(style_grammar("<style scoped>").comments, &CSS));
        for lang in ["scss", "sass", "less", "stylus", "styl"] {
            assert!(
                std::ptr::eq(
                    style_grammar(&format!("<style lang=\"{lang}\">")).comments,
                    &C_LIKE
                ),
                "{lang}"
            );
        }
    }
}
