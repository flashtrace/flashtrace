// hyperglot fixture: .rs nests its block comments.
// [impl:c-like-nested/rs-line#1]

/*
 * [impl:c-like-nested/rs-block#1]
 */

/* outer
  /* [impl:c-like-nested/rs-nested/deep#1] inner */
  [impl:c-like-nested/rs-nested/after-close#1] still inside the outer block
*/

// A string hides comment markers; a comment after it still counts.
let text = "\" // [impl:c-like-nested/rs-ghost-double-quoted#1]"; // [impl:c-like-nested/rs-after-double-quoted#1]
let text = '"'; // [impl:c-like-nested/rs-after-character-literal#1]
fn first<'a>(text: &'a str) -> &'a str { text } // [impl:c-like-nested/rs-after-lifetime#1]
