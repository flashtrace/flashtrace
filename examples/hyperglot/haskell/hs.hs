-- hyperglot fixture: .hs nests its block comments.
-- [impl:haskell/hs-line#1]

{-
  [impl:haskell/hs-block#1]
-}

{- outer
  {- [impl:haskell/hs-nested/deep#1] inner -}
  [impl:haskell/hs-nested/after-close#1] still inside the outer block
-}
