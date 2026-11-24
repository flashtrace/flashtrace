# hyperglot fixture: .cmake adds a bracket block to its hash line comments.
# [impl:cmake/cmake-line#1]

#[[
  [impl:cmake/cmake-block#1]
]]

# A string hides comment markers; a comment after it still counts.
set(text "\" # [impl:cmake/cmake-ghost-double-quoted#1]") # [impl:cmake/cmake-after-double-quoted#1]
