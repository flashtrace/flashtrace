-- hyperglot fixture: .elm nests its block comments.
-- [impl:haskell/elm-line#1]

{-
  [impl:haskell/elm-block#1]
-}

{- outer
  {- [impl:haskell/elm-nested/deep#1] inner -}
  [impl:haskell/elm-nested/after-close#1] still inside the outer block
-}
