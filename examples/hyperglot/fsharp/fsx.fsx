// hyperglot fixture: .fsx nests its block comments.
// [impl:fsharp/fsx-line#1]

(*
 * [impl:fsharp/fsx-block#1]
 *)

(* outer
  (* [impl:fsharp/fsx-nested/deep#1] inner *)
  [impl:fsharp/fsx-nested/after-close#1] still inside the outer block
*)
