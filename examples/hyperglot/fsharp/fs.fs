// hyperglot fixture: .fs nests its block comments.
// [impl:fsharp/fs-line#1]

(*
 * [impl:fsharp/fs-block#1]
 *)

(* outer
  (* [impl:fsharp/fs-nested/deep#1] inner *)
  [impl:fsharp/fs-nested/after-close#1] still inside the outer block
*)
