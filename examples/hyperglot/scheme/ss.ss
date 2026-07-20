; hyperglot fixture: .ss nests its block comments.
; [impl:scheme/ss-line#1]

#|
  [impl:scheme/ss-block#1]
|#

#| outer #| inner |# [impl:scheme/ss-nested#1] still inside the outer block |#
