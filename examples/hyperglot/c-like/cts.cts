// hyperglot fixture: .cts is scanned with the C-like comment grammar.
// [impl:c-like/cts-line#1]

/*
 * [impl:c-like/cts-block#1]
 */

// A string hides comment markers; a comment after it still counts.
const text = "\" // [impl:c-like/cts-ghost-double-quoted#1]"; // [impl:c-like/cts-after-double-quoted#1]
const text = '\' // [impl:c-like/cts-ghost-single-quoted#1]'; // [impl:c-like/cts-after-single-quoted#1]
const text = `\` // [impl:c-like/cts-ghost-backtick-quoted#1]`; // [impl:c-like/cts-after-backtick-quoted#1]
