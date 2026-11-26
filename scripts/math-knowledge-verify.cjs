const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { feishu, readJson, writeJson } = require('./materials-import.cjs');
const { CourseCatalogs, parseMathCourses } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
async function main() {
  const [work, mode = '--verify'] = process.argv.slice(2);
  const fixturePath = path.join(work, 'knowledge-ui-fixtures.json');
  if (mode === '--cleanup') {
    const fixtures = await readJson(fixturePath).catch(() => []);
    if (fixtures.length) await feishu.request('POST', `${feishu.tablePath(process.env.BITABLE_TASK_TABLE_ID)}/records/batch_delete`,
      { records: fixtures.map(r => r.recordId) });
    await writeJson(fixturePath, []); console.log(`Removed ${fixtures.length} verification records`); return;
  }
  assert.ok(['--verify', '--apply'].includes(mode));
  const state = await readJson(path.join(work, 'knowledge-table.json'));
  process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID = state.table;
  process.env.BITABLE_MATH_TABLE_ID = (await readJson(path.join(work, 'feishu-import.json'))).table;
  const fields = await feishu.request('GET', `${feishu.tablePath(state.table)}/fields`, undefined, { page_size: '100' });
  assert.deepEqual(fields.items.map(f => f.field_name).sort(), [...state.fields].sort());
  const rows = []; let token = '';
  do {
    const page = await feishu.listRecords(state.table, token, 500);
    rows.push(...page.items); token = page.pageToken;
  } while (token);
  assert.equal(rows.length, 450);
  assert.equal(new Set(rows.map(r => r.fields['目录ID'])).size, 450);
  const grades = {};
  for (const row of rows) grades[row.fields['适用年级']] = (grades[row.fields['适用年级']] || 0) + 1;
  assert.deepEqual(grades, { '初一': 101, '初二': 173, '初三': 176 });
  const usable = parseMathCourses(rows.map(r => ({ record_id: r.recordId, fields: r.fields })), process.env.BITABLE_APP_TOKEN, state.table);
  const catalog = new CourseCatalogs(feishu); const start = performance.now();
  const snapshot = await catalog.read(['数学']); const coldMs = performance.now() - start;
  assert.deepEqual(snapshot.failed, []); assert.equal(snapshot.math.length, 187 + usable.length);
  const cases = [];
  for (const grade of ['初一', '初二', '初三']) {
    const row = rows.find(r => r.fields['适用年级'] === grade && r.fields['审核状态'] === '已核对');
    const points = [{ subject: '数学', name: row.fields['知识点名称'], keywords: [] }];
    const result = catalog.match(grade, points, snapshot);
    assert.ok(result.matches.some(c => c.title === row.fields['课程名称']));
    assert.ok(result.matches.every(c => c.grade === grade)); assert.ok(result.matches.length <= 2);
    cases.push({ grade, query: points[0].name, titles: result.matches.map(c => c.title), points, result });
  }
  for (const [grade, subject, name] of [['小学三年级', '数学', cases[0].query], ['高三', '数学', cases[2].query],
    ['初一', '物理', cases[0].query], ['初二', '数学', '计算'], ['初三', '数学', '函数']]) {
    assert.equal(catalog.match(grade, [{ subject, name, keywords: [] }], snapshot).matches.length, 0);
  }
  const times = [];
  for (let i = 0; i < 1000; i++) {
    const at = performance.now(); catalog.match(cases[i % 3].grade, cases[i % 3].points, snapshot); times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b); assert.ok(times[949] <= 200);
  const report = { at: new Date().toISOString(), rows: rows.length, grades, usable: usable.length,
    pending: rows.length - usable.length, totalUsable: snapshot.math.length, coldMs, warmP95Ms: times[949],
    metadataFields: state.fields, cases: cases.map(({ grade, query, titles }) => ({ grade, query, titles })),
    negativeCasesPassed: 5, extraModelCalls: 0 };
  await writeJson(path.join(work, 'knowledge-verification.json'), report); console.log(JSON.stringify(report));
  if (mode !== '--apply') return;
  assert.equal((await readJson(fixturePath).catch(() => [])).length, 0, 'Clean up existing fixtures first');
  let encoded = process.env.SUDA_WEBUSER;
  for (let i = 0; i < 5; i++) { try { JSON.parse(encoded); break; } catch { encoded = JSON.parse('"' + encoded + '"'); } }
  const owner = JSON.parse(encoded).user_id; assert.match(owner, /^\d{10,30}$/u);
  const fixtures = [];
  for (const sample of cases.slice(0, 2)) {
    const key = randomUUID();
    const result = { ok: true, grade: sample.grade, subjects: ['数学'], wrongItems: [], scopeNote: '目录集成验证，非客户记录。',
      warnings: [], needsRephoto: false, rephotoHint: '', photoQuality: { assessment: '清晰', issue: '', advice: '' },
      knowledgePoints: sample.points, courseMatches: sample.result.matches, courseMatchNote: sample.result.note };
    const record = await feishu.createRecord(process.env.BITABLE_TASK_TABLE_ID, { '请求编号': key, '提交用户': owner,
      '学生姓名': `${sample.grade}目录验证（非客户）`, '模式': 'extract-wrong', '状态': 'completed', '进度': '验证数据',
      '开始时间': Date.now(), '输入摘要': key, '结果': JSON.stringify(result) }, key);
    fixtures.push({ recordId: record.recordId, url: `http://localhost:8080/app/app_17dsmxamvns/?job=${record.recordId}` });
    await writeJson(fixturePath, fixtures);
  }
  console.log(JSON.stringify(fixtures));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
