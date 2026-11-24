# hyperglot fixture: .rb has line comments only.
# [impl:hash/rb#1]

# A string hides comment markers; a comment after it still counts.
text = "\" # [impl:hash/rb-ghost-double-quoted#1]" # [impl:hash/rb-after-double-quoted#1]
text = '\' # [impl:hash/rb-ghost-single-quoted#1]' # [impl:hash/rb-after-single-quoted#1]
