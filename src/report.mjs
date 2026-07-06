import path from 'node:path';
import process from 'node:process';

function makeStyler() {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (code) => (s) => (on ? `\u001b[${code}m${s}\u001b[0m` : s);
  return {
    red: wrap('31'),
    green: wrap('32'),
    yellow: wrap('33'),
    cyan: wrap('36'),
    dim: wrap('2'),
    bold: wrap('1'),
  };
}

export function report(items, problems, cwd) {
  const c = makeStyler();
  const rel = (f) => path.relative(cwd, f) || f;
  const dimLoc = (file, line) => c.dim(`${rel(file)}:${line}`);
  const defective = items.filter((it) => it.defects.length > 0);
  const out = [];

  for (const it of defective) {
    const title = it.title ? ' ' + c.dim(`"${it.title}"`) : '';
    out.push(
      `${c.red('✘')} ${c.bold(it.id)}${title}  ${dimLoc(it.file, it.line)}`,
    );
    for (const d of it.defects) out.push(`    ${c.red('•')} ${d}`);
    out.push('');
  }
  for (const p of problems) {
    out.push(`${c.yellow('⚠')} ${p.message}  ${c.dim(`${rel(p.file)}:${p.line}`)}`);
  }
  if (problems.length) out.push('');

  const okCount = items.length - defective.length;
  const notDeep = items.filter((it) => it.defects.length === 0 && !it.deepCovered).length;
  const md = items.filter((i) => i.origin === 'markdown').length;

  out.push(c.bold('Summary'));
  out.push(`  items       ${items.length}  ${c.dim(`(${md} from markdown, ${items.length - md} from code)`)}`);
  out.push(`  ok          ${c.green(String(okCount))}`);
  out.push(`  defective   ${defective.length ? c.red(String(defective.length)) : '0'}`);
  if (notDeep) out.push(`  ${c.dim(`of the ok items, ${notDeep} are only shallow-covered (a needed item is itself defective)`)}`);
  if (problems.length) out.push(`  problems    ${c.yellow(String(problems.length))}`);
  out.push('');

  const clean = defective.length === 0 && problems.length === 0;
  out.push(clean ? c.green(c.bold('ok')) : c.red(c.bold('not ok')));
  console.log(out.join('\n'));
  return clean;
}
