-- hyperglot fixture: .hs nests its block comments.
-- [impl:haskell/hs-line#1]

{-
  [impl:haskell/hs-block#1]
-}

{- outer
  {- [impl:haskell/hs-nested/deep#1] inner -}
  [impl:haskell/hs-nested/after-close#1] still inside the outer block
-}

-- A string hides comment markers; a comment after it still counts.
text = "\" -- [impl:haskell/hs-ghost-double-quoted#1]" -- [impl:haskell/hs-after-double-quoted#1]
text = '"' -- [impl:haskell/hs-after-character-literal#1]
next' = foldl' step initial -- [impl:haskell/hs-after-prime#1]
