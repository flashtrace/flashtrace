# hyperglot fixture: .ex has line comments only.
# [impl:hash/ex#1]

# A string hides comment markers; a comment after it still counts.
text = "\" # [impl:hash/ex-ghost-double-quoted#1]" # [impl:hash/ex-after-double-quoted#1]
text = '\' # [impl:hash/ex-ghost-single-quoted#1]' # [impl:hash/ex-after-single-quoted#1]
text = ?" # [impl:hash/ex-after-character-prefix#1]
