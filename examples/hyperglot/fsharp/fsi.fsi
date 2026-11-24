// hyperglot fixture: .fsi nests its block comments.
// [impl:fsharp/fsi-line#1]

(*
 * [impl:fsharp/fsi-block#1]
 *)

(* outer
  (* [impl:fsharp/fsi-nested/deep#1] inner *)
  [impl:fsharp/fsi-nested/after-close#1] still inside the outer block
*)

// A string hides comment markers; a comment after it still counts.
let text = "\" // [impl:fsharp/fsi-ghost-double-quoted#1]" // [impl:fsharp/fsi-after-double-quoted#1]
let text = '"' // [impl:fsharp/fsi-after-character-literal#1]
let identity (value: 'T) : 'T = value // [impl:fsharp/fsi-after-type-variable#1]
