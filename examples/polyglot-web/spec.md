# Web dashboard

`req:web/dashboard#1`

Renders the live metrics dashboard in the browser.

| Needs             | Tags |
|-------------------|------|
| impl:web/page#1   | web  |
| impl:web/markup#1 |      |
| impl:web/widget#1 |      |
| impl:web/theme#1  |      |

# Metrics API

`req:api/metrics#1`

Serves aggregated metrics as JSON.

Needs: impl:api/metrics#1, utest:api/metrics#1

Tags: web, data

# Metrics aggregation

`req:data/aggregation#1`

Aggregates raw events into per-minute metrics.

Needs: impl:data/aggregation#1

Tags: data

# Style guide

`doc:web/style-guide#1`

Describes the dashboard's look and feel.

Needs: doc:web/color-palette#1

Tags: guide

# Color palette

`doc:web/color-palette#1`

The palette the style guide builds on.

Tags: guide
