// hyperglot fixture: .kt nests its block comments.
// [impl:c-like-nested/kt-line#1]

/*
 * [impl:c-like-nested/kt-block#1]
 */

/* outer
  /* [impl:c-like-nested/kt-nested/deep#1] inner */
  [impl:c-like-nested/kt-nested/after-close#1] still inside the outer block
*/

// A string hides comment markers; a comment after it still counts.
val doubleQuoted = "\" // [impl:c-like-nested/kt-ghost-double-quoted#1]" // [impl:c-like-nested/kt-after-double-quoted#1]
val characterLiteral = '"' // [impl:c-like-nested/kt-after-character-literal#1]
