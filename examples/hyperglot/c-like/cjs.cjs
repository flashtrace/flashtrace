// hyperglot fixture: .cjs is scanned with the C-like comment grammar.
// [impl:c-like/cjs-line#1]

/*
 * [impl:c-like/cjs-block#1]
 */

// A string hides comment markers; a comment after it still counts.
const doubleQuoted = "\" // [impl:c-like/cjs-ghost-double-quoted#1]"; // [impl:c-like/cjs-after-double-quoted#1]
const singleQuoted = '\' // [impl:c-like/cjs-ghost-single-quoted#1]'; // [impl:c-like/cjs-after-single-quoted#1]
const backtickQuoted = `\` // [impl:c-like/cjs-ghost-backtick-quoted#1]`; // [impl:c-like/cjs-after-backtick-quoted#1]
