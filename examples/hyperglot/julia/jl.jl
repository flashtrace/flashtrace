# hyperglot fixture: .jl nests its block comments.
# [impl:julia/jl-line#1]

#=
  [impl:julia/jl-block#1]
=#

#= outer
  #= [impl:julia/jl-nested/deep#1] inner =#
  [impl:julia/jl-nested/after-close#1] still inside the outer block
=#
