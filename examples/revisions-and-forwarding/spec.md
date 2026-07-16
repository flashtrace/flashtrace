# Session handling

`feat:session#1`

Sessions survive a service restart and are reachable over the API.

Needs: req:session/store#2.4.0, req:session/api#1

# Session store requirement

`req:session/store#2.4.0`

Sessions persist across restarts. The reference above names this revision
exactly: 2.4.0 and 2.4 are different revisions.

Needs: impl:session/store#2.x.y, utest:session/store#1.x

# Session API requirement

`req:session/api#1`

The API design carries this requirement's coverage obligation.

`[req:session/api#1 --> dsn:session/api#2]`

# Session API design

`dsn:session/api#2`

The design in turn delegates to the implementation.

`[dsn:session/api#2 --> impl:session/api#1.3]`
