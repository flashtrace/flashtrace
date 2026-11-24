// hyperglot fixture: .js is scanned with the C-like comment grammar.
// [impl:c-like/js-line#1]

/*
 * [impl:c-like/js-block#1]
 */

// A string hides comment markers; a comment after it still counts.
const text = "\" // [impl:c-like/js-ghost-double-quoted#1]"; // [impl:c-like/js-after-double-quoted#1]
const text = '\' // [impl:c-like/js-ghost-single-quoted#1]'; // [impl:c-like/js-after-single-quoted#1]
const text = `\` // [impl:c-like/js-ghost-backtick-quoted#1]`; // [impl:c-like/js-after-backtick-quoted#1]
