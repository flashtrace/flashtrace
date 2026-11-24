// hyperglot fixture: .scala nests its block comments.
// [impl:c-like-nested/scala-line#1]

/*
 * [impl:c-like-nested/scala-block#1]
 */

/* outer
  /* [impl:c-like-nested/scala-nested/deep#1] inner */
  [impl:c-like-nested/scala-nested/after-close#1] still inside the outer block
*/

// A string hides comment markers; a comment after it still counts.
val doubleQuoted = "\" // [impl:c-like-nested/scala-ghost-double-quoted#1]" // [impl:c-like-nested/scala-after-double-quoted#1]
val characterLiteral = '"' // [impl:c-like-nested/scala-after-character-literal#1]
