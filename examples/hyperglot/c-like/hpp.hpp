// hyperglot fixture: .hpp is scanned with the C-like comment grammar.
// [impl:c-like/hpp-line#1]

/*
 * [impl:c-like/hpp-block#1]
 */

// A string hides comment markers; a comment after it still counts.
auto doubleQuoted = "\" // [impl:c-like/hpp-ghost-double-quoted#1]"; // [impl:c-like/hpp-after-double-quoted#1]
auto characterLiteral = '"'; // [impl:c-like/hpp-after-character-literal#1]
auto large = 1'000'000; auto odd = 10'000; // [impl:c-like/hpp-after-digit-separator#1]
