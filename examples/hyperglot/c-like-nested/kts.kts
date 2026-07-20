// hyperglot fixture: .kts nests its block comments.
// [impl:c-like-nested/kts-line#1]

/*
 * [impl:c-like-nested/kts-block#1]
 */

/* outer
  /* [impl:c-like-nested/kts-nested/deep#1] inner */
  [impl:c-like-nested/kts-nested/after-close#1] still inside the outer block
*/
