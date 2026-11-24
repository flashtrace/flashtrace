(*
 * hyperglot fixture: .ml nests blocks and has no line comments.
 * [impl:ml/ml-block#1]
 *)

(* outer
  (* [impl:ml/ml-nested/deep#1] inner *)
  [impl:ml/ml-nested/after-close#1] still inside the outer block
*)

(* A string hides comment markers; a comment after it still counts. *)
let text = "\" (* [impl:ml/ml-ghost-double-quoted#1]" (* [impl:ml/ml-after-double-quoted#1] *)
let text = '"' (* [impl:ml/ml-after-character-literal#1] *)
type 'a pair = 'a * 'a (* [impl:ml/ml-after-type-variable#1] *)
