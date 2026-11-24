# hyperglot fixture: .hcl accepts two line-comment markers.
# [impl:hcl/hcl-line-hash#1]
// [impl:hcl/hcl-line-slash#1]

/*
 * [impl:hcl/hcl-block#1]
 */

# A string hides comment markers; a comment after it still counts.
double_quoted = "\" # [impl:hcl/hcl-ghost-double-quoted#1]" # [impl:hcl/hcl-after-double-quoted#1]
