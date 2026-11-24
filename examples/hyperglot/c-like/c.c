// hyperglot fixture: .c is scanned with the C-like comment grammar.
// [impl:c-like/c-line#1]

/*
 * [impl:c-like/c-block#1]
 */

// A string hides comment markers; a comment after it still counts.
const char *text = "\" // [impl:c-like/c-ghost-double-quoted#1]"; // [impl:c-like/c-after-double-quoted#1]
const char *text = '"'; // [impl:c-like/c-after-character-literal#1]
unsigned long large = 1'000'000; unsigned long odd = 10'000; // [impl:c-like/c-after-digit-separator#1]
