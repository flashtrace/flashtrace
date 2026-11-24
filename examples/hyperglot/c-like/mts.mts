// hyperglot fixture: .mts is scanned with the C-like comment grammar.
// [impl:c-like/mts-line#1]

/*
 * [impl:c-like/mts-block#1]
 */

// A string hides comment markers; a comment after it still counts.
const doubleQuoted = "\" // [impl:c-like/mts-ghost-double-quoted#1]"; // [impl:c-like/mts-after-double-quoted#1]
const singleQuoted = '\' // [impl:c-like/mts-ghost-single-quoted#1]'; // [impl:c-like/mts-after-single-quoted#1]
const backtickQuoted = `\` // [impl:c-like/mts-ghost-backtick-quoted#1]`; // [impl:c-like/mts-after-backtick-quoted#1]
