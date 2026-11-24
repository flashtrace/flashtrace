% hyperglot fixture: .hrl has line comments only.
% [impl:percent/hrl#1]

% A string hides comment markers; a comment after it still counts.
Text = "\" % [impl:percent/hrl-ghost-double-quoted#1]", % [impl:percent/hrl-after-double-quoted#1]
Text = '\' % [impl:percent/hrl-ghost-single-quoted#1]', % [impl:percent/hrl-after-single-quoted#1]
Text = $", % [impl:percent/hrl-after-character-prefix#1]
