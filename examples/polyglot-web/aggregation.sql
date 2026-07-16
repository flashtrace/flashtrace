-- [impl:data/aggregation#1]
SELECT date_trunc('minute', recorded_at) AS minute,
       count(*) AS events
FROM raw_events
GROUP BY minute;
