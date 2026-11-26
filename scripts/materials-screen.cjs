const path = require('node:path');
const { readJson, writeJson } = require('./materials-import.cjs');

async function main() {
  const work = process.argv[2];
  const rows = await readJson(path.join(work, 'candidates.json'));
  const excluded = { 0: '年度汇总封面', 12: '单题散点截图', 13: '单题散点截图', 14: '单题散点截图',
    15: '单题散点截图', 31: '英语单题宣传，非整卷对比长图', 32: '英语单题宣传，非整卷对比长图',
    33: '英语单题宣传，非整卷对比长图', 34: '年度汇总封面', 46: '三张已收集长图的拼接重复' };
  const duplicates = { 35: 48, 36: 51, 37: 59, 38: 63, 39: 53, 50: 51 };
  const groups = [
    [[1], '物理', '陕晋青宁'], [[2], '物理', '湖北'], [[3], '物理', '黑吉辽蒙'],
    [[4], '化学', '河南'], [[5], '化学', '陕晋青宁'], [[6], '生物', '云南'], [[7], '生物', '黑吉辽蒙'],
    [[8, 9], '数学', '新高考I'], [[10, 11], '数学', '新高考II'],
    [[16], '物理', '上海'], [[17], '物理', '湖南'], [[18], '物理', '河南'], [[19], '物理', '湖北'], [[20], '物理', '河北'],
    [[21], '数学', '重庆'], [[22], '数学', '广东深圳'], [[23], '数学', '江苏苏州'], [[24], '数学', '山东'],
    [[25], '数学', '四川眉山'], [[26], '化学', '广东'], [[27], '化学', '河南'], [[28], '化学', '湖南'],
    [[29], '化学', '山东烟台'], [[30], '化学', '江苏苏州'],
    [[40, 43], '数学', '湖北'], [[41, 44], '数学', '江苏苏州'], [[42, 45], '数学', '北京'],
    [[47, 48], '数学', '新高考I'], [[49, 51], '数学', '新高考II'], [[52, 53], '物理', '上海'],
    [[54, 55], '物理', '北京'], [[56, 57], '物理', '广东'], [[58, 59], '化学', '黑吉辽蒙'],
    [[60, 61], '化学', '广东'], [[62, 63], '生物', '安徽'], [[64, 65], '生物', '山东'], [[66], '生物', '北京'],
  ];
  const vertical = new Set([9, 11, 43, 44, 45, 47, 49, 52, 54, 56, 58, 60, 62, 64, 66]);
  const pilots = new Set([1, 9, 16, 17, 43, 44, 47, 52]);
  rows.forEach((r, i) => {
    r.inventoryIndex = i;
    if (excluded[i]) { r.status = '排除'; r.reason = excluded[i]; }
    else if (duplicates[i] !== undefined) {
      r.status = '重复不导入'; r.reason = `同内容版本，保留更清晰原图 ${rows[duplicates[i]].id}`;
      r.duplicateOf = rows[duplicates[i]].id;
    }
  });
  for (const [indices, subject, region] of groups) {
    const representative = indices.find(i => vertical.has(i)) ?? indices[0];
    for (const i of indices) {
      const r = rows[i]; r.subjects = [subject]; r.region = region; r.orientation = vertical.has(i) ? '竖版' : '整卷对比海报';
      r.group = rows[representative].id; r.representative = i === representative; r.pilot = pilots.has(i);
      r.name = `${r.year}${r.exam}-${subject}-${region}卷-${r.orientation}-${String(i + 1).padStart(2, '0')}`;
      if (r.originalName.includes('未命名') || r.originalName.length > 60) r.originalName = r.name;
      r.status = '选定待识别'; r.reason = '已目视核对栏目及整卷对比版式';
      r.scopeReview = '2026-09-11 Codex 逐张候选图目视筛选';
      if (i === 30) {
        r.metadataCorrection = '源文档栏目名称误标数学；按原图标题2026年中考化学苏州卷核定为化学';
        r.scopeReview += `；${r.metadataCorrection}`;
      }
    }
  }
  const unknown = rows.filter(r => r.status === '候选待筛选');
  if (unknown.length) throw new Error('Unclassified candidates');
  await writeJson(path.join(work, 'candidates.json'), rows);
  console.log(JSON.stringify({ selected: rows.filter(r => r.status === '选定待识别').length, groups: groups.length,
    pilots: rows.filter(r => r.pilot).length, excluded: Object.keys(excluded).length, duplicates: Object.keys(duplicates).length }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
