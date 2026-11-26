const path = require('node:path');
const { readJson, writeJson } = require('./materials-import.cjs');

async function main() {
  const [work, indices] = process.argv.slice(2);
  if (!indices) throw new Error('Pass comma-separated evidence numbers after visual review');
  const manifest = await readJson(path.join(work, 'label-review', 'manifest.json'));
  const previous = await readJson(path.join(work, 'approved-labels.json')).catch(() => []);
  const selected = indices.split(',').map(Number);
  if (!selected.every(i => Number.isInteger(i) && manifest[i])) throw new Error('Invalid review number');
  const aliases = {
    '区分位移和路程': ['位移与路程'], '光现象识别': ['光现象'], '物态变化识别': ['物态变化'],
    '声音特性识别': ['声音的特性'], '三视图': ['物体的三视图'], '同底数幂的乘法': ['同底数幂相乘'],
    '中位数': ['统计中位数'], '弧长公式': ['弧长计算'], '原子结构': ['原子的结构'],
  };
  for (const i of selected) {
    const label = manifest[i];
    if (previous.some(v => v.key === label.key)) continue;
    previous.push({ ...label, point: label.point.replace(/\s/gu, ''), status: '已审核',
      aliases: aliases[label.point] || [], reviewMethod: '2026-09-11 Codex 对照原图标签逐项目视复核；非人工业务签审' });
  }
  for (const label of await readJson(path.join(work, 'manual-labels.json')).catch(() => [])) {
    if (!previous.some(v => v.key === label.key)) previous.push(label);
  }
  await writeJson(path.join(work, 'approved-labels.json'), previous);
  console.log(`Approved evidence: ${previous.length}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
