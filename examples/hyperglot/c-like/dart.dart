// hyperglot fixture: .dart is scanned with the C-like comment grammar.
// [impl:c-like/dart-line#1]

/*
 * [impl:c-like/dart-block#1]
 */

// A string hides comment markers; a comment after it still counts.
var text = "\" // [impl:c-like/dart-ghost-double-quoted#1]"; // [impl:c-like/dart-after-double-quoted#1]
var text = '\' // [impl:c-like/dart-ghost-single-quoted#1]'; // [impl:c-like/dart-after-single-quoted#1]
