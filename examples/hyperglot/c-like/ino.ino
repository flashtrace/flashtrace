// hyperglot fixture: .ino is scanned with the C-like comment grammar.
// [impl:c-like/ino-line#1]

/*
 * [impl:c-like/ino-block#1]
 */

// A string hides comment markers; a comment after it still counts.
auto text = "\" // [impl:c-like/ino-ghost-double-quoted#1]"; // [impl:c-like/ino-after-double-quoted#1]
auto text = '"'; // [impl:c-like/ino-after-character-literal#1]
auto large = 1'000'000; auto odd = 10'000; // [impl:c-like/ino-after-digit-separator#1]
