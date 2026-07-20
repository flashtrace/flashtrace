# HCL comment grammar

`req:hcl/grammar#1`

Two line-comment markers plus one block pair.

Covers: feat:support-grammar/hcl#1

Needs:
* req:hcl/hcl#1
* req:hcl/tf#1
* req:hcl/tfvars#1

Tags: grammar, hcl

## .hcl

`req:hcl/hcl#1`

Needs: impl:hcl/hcl-line-hash#1, impl:hcl/hcl-line-slash#1, impl:hcl/hcl-block#1

## .tf

`req:hcl/tf#1`

Needs: impl:hcl/tf-line-hash#1, impl:hcl/tf-line-slash#1, impl:hcl/tf-block#1

## .tfvars

`req:hcl/tfvars#1`

Needs: impl:hcl/tfvars-line-hash#1, impl:hcl/tfvars-line-slash#1, impl:hcl/tfvars-block#1
