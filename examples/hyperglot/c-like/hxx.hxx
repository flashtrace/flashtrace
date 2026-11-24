// hyperglot fixture: .hxx is scanned with the C-like comment grammar.
// [impl:c-like/hxx-line#1]

/*
 * [impl:c-like/hxx-block#1]
 */

// A string hides comment markers; a comment after it still counts.
auto doubleQuoted = "\" // [impl:c-like/hxx-ghost-double-quoted#1]"; // [impl:c-like/hxx-after-double-quoted#1]
auto characterLiteral = '"'; // [impl:c-like/hxx-after-character-literal#1]
auto large = 1'000'000; auto odd = 10'000; // [impl:c-like/hxx-after-digit-separator#1]
