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
//
// A wrong string rule is worse than none: a quote misread as an opener hides
// the real comments after it, and nothing reports their absence. So these
// languages keep the comments-only scan, for the reasons their docs give:
//   shell       a backslash outside quotes escapes a quote (don\'t), and `#`
//               opens a comment only at the start of a word
//               https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_02
//               https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_03
//   YAML        plain scalars hold quotes (title: Don't panic); quoted
//               scalars only open at the start of a scalar
//               https://yaml.org/spec/1.2.2/#733-plain-style
//   Perl        quote-like operators take arbitrary delimiters, and `$#` is
//               array syntax
//               https://perldoc.perl.org/perlop#Quote-and-Quote-like-Operators
//               https://perldoc.perl.org/perldata
//   Tcl         a double quote opens a word only at the start of the word,
//               and `#` is a comment only where a command may start
//               https://www.tcl-lang.org/man/tcl8.6/TclCmd/Tcl.htm
//   LaTeX       has no string literals; `\%` is not a comment
//               https://en.wikibooks.org/wiki/LaTeX/Basics#Comments
//   XML, HTML   character data holds quotes freely; quotes only delimit
//   markup      attribute values inside tags
//               https://www.w3.org/TR/xml/#syntax
//   JSX, TSX    JSX text between tags may hold an unpaired quote
//               https://github.com/facebook/jsx/blob/main/spec.emu (JSXText)
//   Less, Emacs Lisp, EDN
//               string syntax not validated against current documentation
pub static NO_STRINGS: &[StringForm] = &[];

// "…" strings and 'c' character literals, both with backslash escapes. The
// character-literal form only matches one character or one escape sequence
// between apostrophes, so the apostrophe's other uses stay code: C23/C++14
// digit separators (1'000), Rust lifetimes ('a), OCaml/F# type variables
// ('a, 'T), Haskell primes (foldl'), Julia's adjoint (A') and Nim's type
// suffixes (1'i8).
//   C        https://en.cppreference.com/w/c/language/string_literal
//            https://en.cppreference.com/w/c/language/character_constant
//   C++      https://en.cppreference.com/w/cpp/language/string_literal
//            https://en.cppreference.com/w/cpp/language/character_literal
//   C#       https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/reference-types#string-literals
//            https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/char
//   Java     https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.10.4
//            https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.10.5
//   Kotlin   https://kotlinlang.org/docs/strings.html
//            https://kotlinlang.org/docs/characters.html
//   Scala    https://docs.scala-lang.org/scala3/reference/syntax.html (stringLiteral, characterLiteral)
//   Rust     https://doc.rust-lang.org/reference/tokens.html#character-literals
//            https://doc.rust-lang.org/reference/tokens.html#string-literals
//            https://doc.rust-lang.org/reference/tokens.html#lifetimes-and-loop-labels
//   Crystal  https://crystal-lang.org/reference/latest/syntax_and_semantics/literals/string.html
//            https://crystal-lang.org/reference/latest/syntax_and_semantics/literals/char.html
//   Julia    https://docs.julialang.org/en/v1/manual/strings/
//   Nim      https://nim-lang.org/docs/manual.html#lexical-analysis-string-literals
//            https://nim-lang.org/docs/manual.html#lexical-analysis-character-literals
//   OCaml    https://ocaml.org/manual/latest/lex.html#sss:stringliterals
//            https://ocaml.org/manual/latest/lex.html#sss:character-literals
//   F#       https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/strings
//            https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/literals
//   Haskell  https://www.haskell.org/onlinereport/haskell2010/haskellch2.html#x7-200002.6
//   Elm      https://github.com/elm/compiler/blob/master/compiler/src/Parse/String.hs
static DOUBLE_QUOTED_AND_CHARACTER: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::CharacterLiteral { escape: Some('\\') },
];

// "…" strings with backslash escapes, and no other single-line literal.
//   Swift       https://github.com/swiftlang/swift-book/blob/main/TSPL.docc/ReferenceManual/LexicalStructure.md#string-literals
//   AWK         https://pubs.opengroup.org/onlinepubs/9799919799/utilities/awk.html (Lexical Conventions: STRING)
//   GraphQL     https://spec.graphql.org/October2021/#sec-String-Value
//   CMake       https://cmake.org/cmake/help/latest/manual/cmake-language.7.html#quoted-argument
//   HCL         https://github.com/hashicorp/hcl/blob/main/hclsyntax/spec.md#template-expressions
//   PureScript  https://github.com/purescript/documentation/blob/master/language/Syntax.md#strings
static DOUBLE_QUOTED: &[StringForm] = &[StringForm::Quoted {
    quote: '"',
    escape: Some('\\'),
}];

// "…" and '…' strings, both with backslash escapes. PHP's single-quoted
// strings only know \' and \\, which ends them at the same place.
//   Python        https://docs.python.org/3/reference/lexical_analysis.html#string-and-bytes-literals
//   Ruby          https://docs.ruby-lang.org/en/master/syntax/literals_rdoc.html
//   R             https://cran.r-project.org/doc/manuals/r-release/R-lang.html#Literal-constants
//   GDScript      https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html#literals
//   CoffeeScript  https://coffeescript.org/#strings
//   Lua           https://www.lua.org/manual/5.4/manual.html#3.1
//   PHP           https://www.php.net/manual/en/language.types.string.php
//   Groovy        https://groovy-lang.org/syntax.html#all-strings
//   Dart          https://dart.dev/language/built-in-types#strings
//   Solidity      https://docs.soliditylang.org/en/latest/types.html#string-literals-and-types
//   Protobuf      https://protobuf.dev/reference/protobuf/proto3-spec/#string_literals
//   SCSS          https://sass-lang.com/documentation/values/strings/
//   CSS           https://www.w3.org/TR/css-syntax-3/#consume-string-token
static DOUBLE_AND_SINGLE_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::Quoted {
        quote: '\'',
        escape: Some('\\'),
    },
];

// "…", '…' and `…` with backslash escapes. A template literal spanning
// lines, or holding ${…} with nested literals, is only followed on its
// opening line. JSX and TSX are left out: JSX text between tags may hold
// either quote unpaired (https://github.com/facebook/jsx/blob/main/spec.emu,
// JSXText).
//   JavaScript/TypeScript  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#string_literals
//                          https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals
static JAVASCRIPT_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::Quoted {
        quote: '\'',
        escape: Some('\\'),
    },
    StringForm::Quoted {
        quote: '`',
        escape: Some('\\'),
    },
];

// Go: "…" interpreted strings and 'c' rune literals with backslash
// escapes, and `…` raw strings, in which a backslash escapes nothing.
//   https://go.dev/ref/spec#String_literals
//   https://go.dev/ref/spec#Rune_literals
static GO_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::Quoted {
        quote: '`',
        escape: None,
    },
    StringForm::CharacterLiteral { escape: Some('\\') },
];

// TOML: "…" basic strings with backslash escapes and '…' literal strings
// without any escapes.
//   https://toml.io/en/v1.0.0#string
static TOML_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::Quoted {
        quote: '\'',
        escape: None,
    },
];

// Languages that escape a quote by doubling it. A doubled quote closes the
// literal and reopens it at once, so no escape character is needed.
// SQL: '…' strings and "…" quoted identifiers, as the SQL standard and
// PostgreSQL define them. MySQL's default backslash escapes ('it\'s') are not
// followed, since they contradict the standard ('C:\' is a complete string).
//   https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS
//   https://dev.mysql.com/doc/refman/8.4/en/string-literals.html
static SQL_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '\'',
        escape: None,
    },
    StringForm::Quoted {
        quote: '"',
        escape: None,
    },
];
// Pascal: '…' strings only.
//   https://www.freepascal.org/docs-html/ref/refse8.html
static PASCAL_QUOTED: &[StringForm] = &[StringForm::Quoted {
    quote: '\'',
    escape: None,
}];
// Ada and VHDL: "…" strings and 'c' character literals, neither with an
// escape character - ''' is the apostrophe literal, and an attribute
// apostrophe (Text'Length, clk'event) stays code.
//   Ada   https://www.adaic.org/resources/add_content/standards/22rm/html/RM-2-6.html
//         https://www.adaic.org/resources/add_content/standards/22rm/html/RM-2-5.html
//   VHDL  https://peterfab.com/ref/vhdl/vhdl_renerta/source/vhd00070.htm
//         https://peterfab.com/ref/vhdl/vhdl_renerta/source/vhd00041.htm
static ADA_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: None,
    },
    StringForm::CharacterLiteral { escape: None },
];
// PowerShell: verbatim '…' strings escape by doubling; expandable "…"
// strings escape with the backtick (doubling works there too).
//   https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_quoting_rules
static POWERSHELL_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '\'',
        escape: None,
    },
    StringForm::Quoted {
        quote: '"',
        escape: Some('`'),
    },
];

// Languages with prefixed character literals, which may hold a quote or a
// comment marker: Clojure \" and \;, Scheme/Racket/Common Lisp #\" and #\;,
// Erlang $" and $%, Elixir ?" and ?#.
//   Clojure      https://clojure.org/reference/reader (Strings, Character)
static CLOJURE_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::PrefixedCharacter {
        prefix: "\\",
        escape: None,
    },
];
//   Scheme       https://standards.scheme.org/corrected-r7rs/r7rs-Z-H-8.html (6.6 Characters, 6.7 Strings)
//   Racket       https://docs.racket-lang.org/reference/reader.html#(part._parse-string)
//                https://docs.racket-lang.org/reference/reader.html#(part._parse-character)
//   Common Lisp  https://www.lispworks.com/documentation/HyperSpec/Body/02_de.htm
//                https://www.lispworks.com/documentation/HyperSpec/Body/02_dha.htm
static LISP_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::PrefixedCharacter {
        prefix: "#\\",
        escape: None,
    },
];
//   Erlang       https://www.erlang.org/doc/system/data_types.html ("…" strings, '…' quoted atoms, $c)
static ERLANG_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::Quoted {
        quote: '\'',
        escape: Some('\\'),
    },
    StringForm::PrefixedCharacter {
        prefix: "$",
        escape: Some('\\'),
    },
];
//   Elixir       https://hexdocs.pm/elixir/syntax-reference.html ("…" strings, '…' charlists)
//                https://hexdocs.pm/elixir/String.html#module-unicode-and-code-points (?c)
static ELIXIR_QUOTED: &[StringForm] = &[
    StringForm::Quoted {
        quote: '"',
        escape: Some('\\'),
    },
    StringForm::Quoted {
        quote: '\'',
        escape: Some('\\'),
    },
    StringForm::PrefixedCharacter {
        prefix: "?",
        escape: Some('\\'),
    },
];

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
        return Leaf {
            comments: &COFFEE,
            strings: DOUBLE_AND_SINGLE_QUOTED,
        }; // CoffeeScript
    }
    Leaf {
        comments: &C_LIKE,
        strings: JAVASCRIPT_QUOTED,
    } // JS / TS / module / ...
}

fn style_grammar(tag: &str) -> Leaf {
    // SCSS, Sass and Less add `//` line comments on top of CSS `/* */`;
    // "styl" also covers "stylus"
    let lang = attribute_of(tag, &LANG_ATTRIBUTE_RE);
    if ["sass", "scss", "less", "styl"]
        .iter()
        .any(|name| lang.contains(name))
    {
        // only SCSS's strings are validated; Sass, Less and Stylus keep
        // the comments-only scan
        if lang.contains("scss") {
            Leaf {
                comments: &C_LIKE,
                strings: DOUBLE_AND_SINGLE_QUOTED,
            }
        } else {
            comments_only(&C_LIKE)
        }
    } else {
        Leaf {
            comments: &CSS,
            strings: DOUBLE_AND_SINGLE_QUOTED,
        }
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
        leaf("ts", &C_LIKE, JAVASCRIPT_QUOTED),
        leaf("js", &C_LIKE, JAVASCRIPT_QUOTED),
        leaf("mjs", &C_LIKE, JAVASCRIPT_QUOTED),
        leaf("cjs", &C_LIKE, JAVASCRIPT_QUOTED),
        leaf("jsx", &C_LIKE, NO_STRINGS),
        leaf("tsx", &C_LIKE, NO_STRINGS),
        leaf("cts", &C_LIKE, JAVASCRIPT_QUOTED),
        leaf("mts", &C_LIKE, JAVASCRIPT_QUOTED),
        leaf("c", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("h", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("cpp", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("cc", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("hpp", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("cxx", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("hxx", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("ino", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("inl", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("tpp", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("cs", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("java", &C_LIKE, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("go", &C_LIKE, GO_QUOTED),
        leaf("groovy", &C_LIKE, DOUBLE_AND_SINGLE_QUOTED),
        leaf("gradle", &C_LIKE, DOUBLE_AND_SINGLE_QUOTED),
        leaf("sol", &C_LIKE, DOUBLE_AND_SINGLE_QUOTED),
        leaf("dart", &C_LIKE, DOUBLE_AND_SINGLE_QUOTED),
        leaf("php", &PHP, DOUBLE_AND_SINGLE_QUOTED),
        leaf("proto", &C_LIKE, DOUBLE_AND_SINGLE_QUOTED),
        leaf("scss", &C_LIKE, DOUBLE_AND_SINGLE_QUOTED),
        leaf("less", &C_LIKE, NO_STRINGS),
        // C-family with nested block comments
        leaf("rs", &C_LIKE_NESTED, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("swift", &C_LIKE_NESTED, DOUBLE_QUOTED),
        leaf("kt", &C_LIKE_NESTED, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("kts", &C_LIKE_NESTED, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("scala", &C_LIKE_NESTED, DOUBLE_QUOTED_AND_CHARACTER),
        // hash line comments
        leaf("py", &HASH, DOUBLE_AND_SINGLE_QUOTED),
        leaf("rb", &HASH, DOUBLE_AND_SINGLE_QUOTED),
        leaf("sh", &HASH, NO_STRINGS),
        leaf("bash", &HASH, NO_STRINGS),
        leaf("zsh", &HASH, NO_STRINGS),
        leaf("yaml", &HASH, NO_STRINGS),
        leaf("yml", &HASH, NO_STRINGS),
        leaf("toml", &HASH, TOML_QUOTED),
        leaf("r", &HASH, DOUBLE_AND_SINGLE_QUOTED),
        leaf("pm", &HASH, NO_STRINGS),
        leaf("ex", &HASH, ELIXIR_QUOTED),
        leaf("exs", &HASH, ELIXIR_QUOTED),
        leaf("tcl", &HASH, NO_STRINGS),
        leaf("cr", &HASH, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("gd", &HASH, DOUBLE_AND_SINGLE_QUOTED),
        leaf("awk", &HASH, DOUBLE_QUOTED),
        leaf("graphql", &HASH, DOUBLE_QUOTED),
        leaf("gql", &HASH, DOUBLE_QUOTED),
        // hash line comments plus a block pair of their own
        leaf("jl", &JULIA, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("nim", &NIM, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("coffee", &COFFEE, DOUBLE_AND_SINGLE_QUOTED),
        leaf("cmake", &CMAKE, DOUBLE_QUOTED),
        leaf("ps1", &POWERSHELL, POWERSHELL_QUOTED),
        leaf("psm1", &POWERSHELL, POWERSHELL_QUOTED),
        leaf("tf", &HCL, DOUBLE_QUOTED),
        leaf("tfvars", &HCL, DOUBLE_QUOTED),
        leaf("hcl", &HCL, DOUBLE_QUOTED),
        // semicolon (Lisp family)
        leaf("clj", &SEMICOLON, CLOJURE_QUOTED),
        leaf("cljs", &SEMICOLON, CLOJURE_QUOTED),
        leaf("cljc", &SEMICOLON, CLOJURE_QUOTED),
        leaf("edn", &SEMICOLON, NO_STRINGS),
        leaf("el", &SEMICOLON, NO_STRINGS),
        leaf("lisp", &SEMICOLON, LISP_QUOTED),
        // Scheme/Racket: ; lines plus nestable #| |# blocks
        leaf("scm", &SCHEME, LISP_QUOTED),
        leaf("ss", &SCHEME, LISP_QUOTED),
        leaf("rkt", &SCHEME, LISP_QUOTED),
        // percent (Erlang, LaTeX)
        leaf("erl", &PERCENT, ERLANG_QUOTED),
        leaf("hrl", &PERCENT, ERLANG_QUOTED),
        leaf("tex", &PERCENT, NO_STRINGS),
        leaf("sty", &PERCENT, NO_STRINGS),
        // dash line-only (Ada, VHDL)
        leaf("adb", &DASH_LINE, ADA_QUOTED),
        leaf("ads", &DASH_LINE, ADA_QUOTED),
        leaf("vhd", &DASH_LINE, ADA_QUOTED),
        leaf("vhdl", &DASH_LINE, ADA_QUOTED),
        // ML-family
        leaf("ml", &ML, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("mli", &ML, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("fs", &FSHARP, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("fsi", &FSHARP, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("fsx", &FSHARP, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("pas", &PASCAL, PASCAL_QUOTED),
        leaf("dpr", &PASCAL, PASCAL_QUOTED),
        // dashes and others
        leaf("sql", &SQL, SQL_QUOTED),
        leaf("lua", &LUA, DOUBLE_AND_SINGLE_QUOTED),
        leaf("hs", &HASKELL, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("elm", &HASKELL, DOUBLE_QUOTED_AND_CHARACTER),
        leaf("purs", &HASKELL, DOUBLE_QUOTED),
        leaf("css", &CSS, DOUBLE_AND_SINGLE_QUOTED),
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
