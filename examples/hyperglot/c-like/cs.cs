// hyperglot fixture: .cs is scanned with the C-like comment grammar.
// [impl:c-like/cs-line#1]

/*
 * [impl:c-like/cs-block#1]
 */

// A string hides comment markers; a comment after it still counts.
var doubleQuoted = "\" // [impl:c-like/cs-ghost-double-quoted#1]"; // [impl:c-like/cs-after-double-quoted#1]
var characterLiteral = '"'; // [impl:c-like/cs-after-character-literal#1]
