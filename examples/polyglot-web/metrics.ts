// [impl:api/metrics#1]
export function metricsHandler(): string {
  return JSON.stringify({ metrics: [] });
}
