-- hyperglot fixture: .purs nests its block comments.
-- [impl:haskell/purs-line#1]

{-
  [impl:haskell/purs-block#1]
-}

{- outer
  {- [impl:haskell/purs-nested/deep#1] inner -}
  [impl:haskell/purs-nested/after-close#1] still inside the outer block
-}
