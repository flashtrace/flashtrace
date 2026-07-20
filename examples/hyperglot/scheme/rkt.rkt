; hyperglot fixture: .rkt nests its block comments.
; [impl:scheme/rkt-line#1]

#|
  [impl:scheme/rkt-block#1]
|#

#| outer #| inner |# [impl:scheme/rkt-nested#1] still inside the outer block |#
