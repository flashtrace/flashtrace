// hyperglot fixture: .cpp is scanned with the C-like comment grammar.
// [impl:c-like/cpp-line#1]

/*
 * [impl:c-like/cpp-block#1]
 */

// A string hides comment markers; a comment after it still counts.
auto text = "\" // [impl:c-like/cpp-ghost-double-quoted#1]"; // [impl:c-like/cpp-after-double-quoted#1]
auto text = '"'; // [impl:c-like/cpp-after-character-literal#1]
auto large = 1'000'000; auto odd = 10'000; // [impl:c-like/cpp-after-digit-separator#1]
