# Session handling

`feat:session#1`

Sessions survive a service restart and are reachable over the API.

Needs: req:session/store#2.4, req:session/api#1

# Session store requirement

`req:session/store#2.4.0`

Sessions persist across restarts. The reference above spells 2.4: omitted
layers are zero (SemVer), so it names exactly this revision, 2.4.0.

Needs: impl:session/store#2.x, utest:session/store#1.*

# Session API requirement

`req:session/api#1`

The API design carries this requirement's coverage obligation.

`[req:session/api#1 --> dsn:session/api#2]`

# Session API design

`dsn:session/api#2`

The design in turn delegates to the implementation.

`[dsn:session/api#2 --> impl:session/api#1.3]`
