// hyperglot fixture: .cxx is scanned with the C-like comment grammar.
// [impl:c-like/cxx-line#1]

/*
 * [impl:c-like/cxx-block#1]
 */

// A string hides comment markers; a comment after it still counts.
auto doubleQuoted = "\" // [impl:c-like/cxx-ghost-double-quoted#1]"; // [impl:c-like/cxx-after-double-quoted#1]
auto characterLiteral = '"'; // [impl:c-like/cxx-after-character-literal#1]
auto large = 1'000'000; auto odd = 10'000; // [impl:c-like/cxx-after-digit-separator#1]
