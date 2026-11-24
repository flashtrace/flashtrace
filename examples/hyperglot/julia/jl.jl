# hyperglot fixture: .jl nests its block comments.
# [impl:julia/jl-line#1]

#=
  [impl:julia/jl-block#1]
=#

#= outer
  #= [impl:julia/jl-nested/deep#1] inner =#
  [impl:julia/jl-nested/after-close#1] still inside the outer block
=#

# A string hides comment markers; a comment after it still counts.
double_quoted = "\" # [impl:julia/jl-ghost-double-quoted#1]" # [impl:julia/jl-after-double-quoted#1]
character_literal = '"' # [impl:julia/jl-after-character-literal#1]
product = A' * B' # [impl:julia/jl-after-adjoint#1]
