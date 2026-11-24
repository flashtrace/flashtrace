// hyperglot fixture: .fsx nests its block comments.
// [impl:fsharp/fsx-line#1]

(*
 * [impl:fsharp/fsx-block#1]
 *)

(* outer
  (* [impl:fsharp/fsx-nested/deep#1] inner *)
  [impl:fsharp/fsx-nested/after-close#1] still inside the outer block
*)

// A string hides comment markers; a comment after it still counts.
let text = "\" // [impl:fsharp/fsx-ghost-double-quoted#1]" // [impl:fsharp/fsx-after-double-quoted#1]
let text = '"' // [impl:fsharp/fsx-after-character-literal#1]
let identity (value: 'T) : 'T = value // [impl:fsharp/fsx-after-type-variable#1]
