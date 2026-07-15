/*
 * Summarize hyperfine JSON exports into raw + aggregated CSV and a markdown
 * table.
 *
 *   node benchmark/tools/summarize.mjs <results-dir>
 *
 * Reads every *.json in <results-dir> (hyperfine --export-json format, one
 * command name per matrix cell, named "corpus|phase|runtime"), writes
 * raw-times.csv and summary.csv next to them, and prints a markdown table.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: summarize.mjs <results-dir>');
  process.exit(2);
}

const quantile = (sorted, q) => {
  // nearest-rank on the sorted sample
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
};

const raw = [['corpus', 'phase', 'runtime', 'run', 'seconds']];
const summary = [['corpus', 'phase', 'runtime', 'runs', 'mean_s', 'p50_s', 'p95_s', 'min_s', 'max_s']];
const rows = [];

for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  } catch {
    continue; // not a hyperfine export
  }
  if (!Array.isArray(data.results)) continue;
  for (const r of data.results) {
    const [corpus, phase, runtime] = r.command.split('|');
    if (!runtime) continue;
    r.times.forEach((t, i) => raw.push([corpus, phase, runtime, i + 1, t.toFixed(6)]));
    const sorted = [...r.times].sort((a, b) => a - b);
    const row = {
      corpus,
      phase,
      runtime,
      runs: r.times.length,
      mean: r.mean,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
    rows.push(row);
    summary.push([corpus, phase, runtime, row.runs, ...[row.mean, row.p50, row.p95, row.min, row.max].map((v) => v.toFixed(6))]);
  }
}

writeFileSync(join(dir, 'raw-times.csv'), raw.map((r) => r.join(',')).join('\n') + '\n');
writeFileSync(join(dir, 'summary.csv'), summary.map((r) => r.join(',')).join('\n') + '\n');

const fmt = (s) => (s >= 1 ? `${s.toFixed(2)} s` : `${(s * 1000).toFixed(1)} ms`);
console.log('| corpus | phase | runtime | runs | mean | p50 | p95 |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows.sort((a, b) => a.corpus.localeCompare(b.corpus) || a.phase.localeCompare(b.phase) || a.p50 - b.p50)) {
  console.log(`| ${r.corpus} | ${r.phase} | ${r.runtime} | ${r.runs} | ${fmt(r.mean)} | ${fmt(r.p50)} | ${fmt(r.p95)} |`);
}
console.log(`\nwrote ${join(dir, 'raw-times.csv')} and ${join(dir, 'summary.csv')}`);
