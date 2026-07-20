# hyperglot fixture: .jl nests its block comments.
# [impl:julia/jl-line#1]

#=
  [impl:julia/jl-block#1]
=#

#= outer #= inner =# [impl:julia/jl-nested#1] still inside the outer block =#
