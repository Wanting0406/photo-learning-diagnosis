const { readJson, writeJson, feishu } = require('./materials-import.cjs');
const path = require('node:path');
const NAME = '数学课程目录';
const FIELDS = ['课程ID', '课程名称', '学科', '适用年级', '教材版本', '课程类型', '模块', '小节',
  '检索关键词', '原目录链接', '原工作表', '原单元格', '源文件校验', '审核状态', '可用性说明'];
async function main() {
  const [work, flag] = process.argv.slice(2);
  if (!work || flag !== '--apply') throw new Error('Usage: math-catalog-import.cjs WORK --apply');
  const courses = await readJson(path.join(work, 'courses.json'));
  if (!courses.length || courses.some(c => c.subject !== '数学' || !['已核对', '待核实'].includes(c.reviewStatus))) {
    throw new Error('Invalid reviewed course inventory');
  }
  const base = `/bitable/v1/apps/${process.env.BITABLE_APP_TOKEN}/tables`;
  let token = ''; let table;
  for (let page = 0; page < 20; page++) {
    const data = await feishu.request('GET', base, undefined, { page_size: '100', ...(token ? { page_token: token } : {}) });
    table ||= data.items?.find(t => t.name === NAME)?.table_id;
    if (!data.has_more) break;
    if (!data.page_token || data.page_token === token || page === 19) throw new Error('Invalid table pagination');
    token = data.page_token;
  }
  if (!table) table = (await feishu.request('POST', base, { table: { name: NAME,
    default_view_name: '已核对课程', fields: FIELDS.map(field_name => ({ field_name, type: 1 })) } })).table_id;
  const state = { table, url: `https://guanghe.feishu.cn/base/${process.env.BITABLE_APP_TOKEN}?table=${table}` };
  await writeJson(path.join(work, 'feishu-import.json'), state);
  const existing = new Map(); token = '';
  for (let page = 0; page < 20; page++) {
    const data = await feishu.listRecords(table, token, 500);
    for (const row of data.items) existing.set(row.fields['课程ID'], row.recordId);
    if (!data.pageToken) break;
    if (data.pageToken === token || page === 19) throw new Error('Invalid record pagination');
    token = data.pageToken;
  }
  const creates = []; const updates = [];
  for (const c of courses) {
    const fields = Object.fromEntries(FIELDS.map((field, i) => [field, [c.id, c.title, c.subject, c.grade,
      c.edition, c.courseType, c.module, c.section, c.keywords.join('\n'), c.sourceUrl, c.sourceSheet,
      c.sourceCell, c.sourceSha256, c.reviewStatus, c.availability][i]]));
    if (existing.has(c.id)) updates.push({ record_id: existing.get(c.id), fields });
    else creates.push({ fields });
  }
  for (const [action, records] of [['batch_create', creates], ['batch_update', updates]]) {
    for (let i = 0; i < records.length; i += 100) {
      await feishu.request('POST', `${feishu.tablePath(table)}/records/${action}`, { records: records.slice(i, i + 100) });
    }
  }
  await writeJson(path.join(work, 'feishu-import.json'), { ...state, count: courses.length,
    importedAt: new Date().toISOString(), created: creates.length, updated: updates.length });
  console.log(JSON.stringify({ ...state, created: creates.length, updated: updates.length }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
