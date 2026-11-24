// hyperglot fixture: .inl is scanned with the C-like comment grammar.
// [impl:c-like/inl-line#1]

/*
 * [impl:c-like/inl-block#1]
 */

// A string hides comment markers; a comment after it still counts.
auto text = "\" // [impl:c-like/inl-ghost-double-quoted#1]"; // [impl:c-like/inl-after-double-quoted#1]
auto text = '"'; // [impl:c-like/inl-after-character-literal#1]
auto large = 1'000'000; auto odd = 10'000; // [impl:c-like/inl-after-digit-separator#1]
