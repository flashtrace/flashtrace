// hyperglot fixture: .ts is scanned with the C-like comment grammar.
// [impl:c-like/ts-line#1]

/*
 * [impl:c-like/ts-block#1]
 */

// A string hides comment markers; a comment after it still counts.
const text = "\" // [impl:c-like/ts-ghost-double-quoted#1]"; // [impl:c-like/ts-after-double-quoted#1]
const text = '\' // [impl:c-like/ts-ghost-single-quoted#1]'; // [impl:c-like/ts-after-single-quoted#1]
const text = `\` // [impl:c-like/ts-ghost-backtick-quoted#1]`; // [impl:c-like/ts-after-backtick-quoted#1]
