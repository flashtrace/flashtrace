// hyperglot fixture: .mjs is scanned with the C-like comment grammar.
// [impl:c-like/mjs-line#1]

/*
 * [impl:c-like/mjs-block#1]
 */

// A string hides comment markers; a comment after it still counts.
const text = "\" // [impl:c-like/mjs-ghost-double-quoted#1]"; // [impl:c-like/mjs-after-double-quoted#1]
const text = '\' // [impl:c-like/mjs-ghost-single-quoted#1]'; // [impl:c-like/mjs-after-single-quoted#1]
const text = `\` // [impl:c-like/mjs-ghost-backtick-quoted#1]`; // [impl:c-like/mjs-after-backtick-quoted#1]
