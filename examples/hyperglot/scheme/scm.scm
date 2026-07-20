; hyperglot fixture: .scm nests its block comments.
; [impl:scheme/scm-line#1]

#|
  [impl:scheme/scm-block#1]
|#

#| outer #| inner |# [impl:scheme/scm-nested#1] still inside the outer block |#
