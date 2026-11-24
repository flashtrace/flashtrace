# hyperglot fixture: .tfvars accepts two line-comment markers.
# [impl:hcl/tfvars-line-hash#1]
// [impl:hcl/tfvars-line-slash#1]

/*
 * [impl:hcl/tfvars-block#1]
 */

# A string hides comment markers; a comment after it still counts.
double_quoted = "\" # [impl:hcl/tfvars-ghost-double-quoted#1]" # [impl:hcl/tfvars-after-double-quoted#1]
