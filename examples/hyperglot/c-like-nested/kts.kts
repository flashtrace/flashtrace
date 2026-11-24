// hyperglot fixture: .kts nests its block comments.
// [impl:c-like-nested/kts-line#1]

/*
 * [impl:c-like-nested/kts-block#1]
 */

/* outer
  /* [impl:c-like-nested/kts-nested/deep#1] inner */
  [impl:c-like-nested/kts-nested/after-close#1] still inside the outer block
*/

// A string hides comment markers; a comment after it still counts.
val doubleQuoted = "\" // [impl:c-like-nested/kts-ghost-double-quoted#1]" // [impl:c-like-nested/kts-after-double-quoted#1]
val characterLiteral = '"' // [impl:c-like-nested/kts-after-character-literal#1]
