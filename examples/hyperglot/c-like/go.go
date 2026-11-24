// hyperglot fixture: .go is scanned with the C-like comment grammar.
// [impl:c-like/go-line#1]

/*
 * [impl:c-like/go-block#1]
 */

// A string hides comment markers; a comment after it still counts.
doubleQuoted := "\" // [impl:c-like/go-ghost-double-quoted#1]" // [impl:c-like/go-after-double-quoted#1]
backtickQuoted := `// [impl:c-like/go-ghost-backtick-quoted#1] \` // [impl:c-like/go-after-backtick-quoted#1]
characterLiteral := '"' // [impl:c-like/go-after-character-literal#1]
