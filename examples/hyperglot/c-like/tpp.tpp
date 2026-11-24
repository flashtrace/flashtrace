// hyperglot fixture: .tpp is scanned with the C-like comment grammar.
// [impl:c-like/tpp-line#1]

/*
 * [impl:c-like/tpp-block#1]
 */

// A string hides comment markers; a comment after it still counts.
auto text = "\" // [impl:c-like/tpp-ghost-double-quoted#1]"; // [impl:c-like/tpp-after-double-quoted#1]
auto text = '"'; // [impl:c-like/tpp-after-character-literal#1]
auto large = 1'000'000; auto odd = 10'000; // [impl:c-like/tpp-after-digit-separator#1]
