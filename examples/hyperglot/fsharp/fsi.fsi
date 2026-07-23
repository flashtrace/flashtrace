// hyperglot fixture: .fsi nests its block comments.
// [impl:fsharp/fsi-line#1]

(*
 * [impl:fsharp/fsi-block#1]
 *)

(* outer
  (* [impl:fsharp/fsi-nested/deep#1] inner *)
  [impl:fsharp/fsi-nested/after-close#1] still inside the outer block
*)
