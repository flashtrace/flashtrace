// hyperglot fixture: .h is scanned with the C-like comment grammar.
// [impl:c-like/h-line#1]

/*
 * [impl:c-like/h-block#1]
 */

// A string hides comment markers; a comment after it still counts.
const char *doubleQuoted = "\" // [impl:c-like/h-ghost-double-quoted#1]"; // [impl:c-like/h-after-double-quoted#1]
const char *characterLiteral = '"'; // [impl:c-like/h-after-character-literal#1]
unsigned long large = 1'000'000; unsigned long odd = 10'000; // [impl:c-like/h-after-digit-separator#1]
