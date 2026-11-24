// hyperglot fixture: .sol is scanned with the C-like comment grammar.
// [impl:c-like/sol-line#1]

/*
 * [impl:c-like/sol-block#1]
 */

// A string hides comment markers; a comment after it still counts.
string constant text = "\" // [impl:c-like/sol-ghost-double-quoted#1]"; // [impl:c-like/sol-after-double-quoted#1]
string constant text = '\' // [impl:c-like/sol-ghost-single-quoted#1]'; // [impl:c-like/sol-after-single-quoted#1]
