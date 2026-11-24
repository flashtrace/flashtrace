# hyperglot fixture: .tf accepts two line-comment markers.
# [impl:hcl/tf-line-hash#1]
// [impl:hcl/tf-line-slash#1]

/*
 * [impl:hcl/tf-block#1]
 */

# A string hides comment markers; a comment after it still counts.
double_quoted = "\" # [impl:hcl/tf-ghost-double-quoted#1]" # [impl:hcl/tf-after-double-quoted#1]
