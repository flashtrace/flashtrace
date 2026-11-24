// hyperglot fixture: .dpr has two block pairs.
// [impl:pascal/dpr-line#1]

{
  [impl:pascal/dpr-brace-block#1]
}

(*
 * [impl:pascal/dpr-paren-block#1]
 *)

// A string hides comment markers; a comment after it still counts.
SingleQuoted := 'it''s // [impl:pascal/dpr-ghost-single-quoted#1]'; // [impl:pascal/dpr-after-single-quoted#1]
