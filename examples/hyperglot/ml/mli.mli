(*
 * hyperglot fixture: .mli nests blocks and has no line comments.
 * [impl:ml/mli-block#1]
 *)

(* outer
  (* [impl:ml/mli-nested/deep#1] inner *)
  [impl:ml/mli-nested/after-close#1] still inside the outer block
*)

(* A string hides comment markers; a comment after it still counts. *)
let double_quoted = "\" (* [impl:ml/mli-ghost-double-quoted#1]" (* [impl:ml/mli-after-double-quoted#1] *)
let character_literal = '"' (* [impl:ml/mli-after-character-literal#1] *)
type 'a pair = 'a * 'a (* [impl:ml/mli-after-type-variable#1] *)
