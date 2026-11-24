// hyperglot fixture: .java is scanned with the C-like comment grammar.
// [impl:c-like/java-line#1]

/*
 * [impl:c-like/java-block#1]
 */

// A string hides comment markers; a comment after it still counts.
var doubleQuoted = "\" // [impl:c-like/java-ghost-double-quoted#1]"; // [impl:c-like/java-after-double-quoted#1]
var characterLiteral = '"'; // [impl:c-like/java-after-character-literal#1]
