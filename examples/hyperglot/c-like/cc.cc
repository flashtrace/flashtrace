// hyperglot fixture: .cc is scanned with the C-like comment grammar.
// [impl:c-like/cc-line#1]

/*
 * [impl:c-like/cc-block#1]
 */

// A string hides comment markers; a comment after it still counts.
auto text = "\" // [impl:c-like/cc-ghost-double-quoted#1]"; // [impl:c-like/cc-after-double-quoted#1]
auto text = '"'; // [impl:c-like/cc-after-character-literal#1]
auto large = 1'000'000; auto odd = 10'000; // [impl:c-like/cc-after-digit-separator#1]
