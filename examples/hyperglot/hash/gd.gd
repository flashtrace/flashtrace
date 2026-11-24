# hyperglot fixture: .gd has line comments only.
# [impl:hash/gd#1]

# A string hides comment markers; a comment after it still counts.
var text = "\" # [impl:hash/gd-ghost-double-quoted#1]" # [impl:hash/gd-after-double-quoted#1]
var text = '\' # [impl:hash/gd-ghost-single-quoted#1]' # [impl:hash/gd-after-single-quoted#1]
