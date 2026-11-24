// hyperglot fixture: .groovy is scanned with the C-like comment grammar.
// [impl:c-like/groovy-line#1]

/*
 * [impl:c-like/groovy-block#1]
 */

// A string hides comment markers; a comment after it still counts.
def text = "\" // [impl:c-like/groovy-ghost-double-quoted#1]" // [impl:c-like/groovy-after-double-quoted#1]
def text = '\' // [impl:c-like/groovy-ghost-single-quoted#1]' // [impl:c-like/groovy-after-single-quoted#1]
