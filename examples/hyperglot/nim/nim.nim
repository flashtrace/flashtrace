# hyperglot fixture: .nim has a plain and a doc block pair, both nesting.
# [impl:nim/nim-line#1]

#[
  [impl:nim/nim-block#1]
]#

#[ outer
  #[ [impl:nim/nim-nested/deep#1] inner ]#
  [impl:nim/nim-nested/after-close#1] still inside the outer block
]#

# the longer doc opener wins the tie against both shorter openers
##[
  [impl:nim/nim-doc-block#1]
]##

##[ outer
  ##[ [impl:nim/nim-doc-nested/deep#1] inner ]##
  [impl:nim/nim-doc-nested/after-close#1] still inside the outer block
]##
