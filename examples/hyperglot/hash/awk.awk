# hyperglot fixture: .awk has line comments only.
# [impl:hash/awk#1]

# A string hides comment markers; a comment after it still counts.
BEGIN { double_quoted = "\" # [impl:hash/awk-ghost-double-quoted#1]" } # [impl:hash/awk-after-double-quoted#1]
