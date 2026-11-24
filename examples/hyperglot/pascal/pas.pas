// hyperglot fixture: .pas has two block pairs.
// [impl:pascal/pas-line#1]

{
  [impl:pascal/pas-brace-block#1]
}

(*
 * [impl:pascal/pas-paren-block#1]
 *)

// A string hides comment markers; a comment after it still counts.
SingleQuoted := 'it''s // [impl:pascal/pas-ghost-single-quoted#1]'; // [impl:pascal/pas-after-single-quoted#1]
