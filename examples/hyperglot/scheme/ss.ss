; hyperglot fixture: .ss nests its block comments.
; [impl:scheme/ss-line#1]

#|
  [impl:scheme/ss-block#1]
|#

#| outer
  #| [impl:scheme/ss-nested/deep#1] inner |#
  [impl:scheme/ss-nested/after-close#1] still inside the outer block
|#
