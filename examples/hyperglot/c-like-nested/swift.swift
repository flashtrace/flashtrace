// hyperglot fixture: .swift nests its block comments.
// [impl:c-like-nested/swift-line#1]

/*
 * [impl:c-like-nested/swift-block#1]
 */

/* outer
  /* [impl:c-like-nested/swift-nested/deep#1] inner */
  [impl:c-like-nested/swift-nested/after-close#1] still inside the outer block
*/

// A string hides comment markers; a comment after it still counts.
let text = "\" // [impl:c-like-nested/swift-ghost-double-quoted#1]" // [impl:c-like-nested/swift-after-double-quoted#1]
