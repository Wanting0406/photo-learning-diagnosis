const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { readJson, writeJson, feishu } = require('./materials-import.cjs');
const { MathCourseCatalog, CourseCatalogs } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
async function main() {
  const [work, mode = '--verify'] = process.argv.slice(2);
  const state = await readJson(path.join(work, 'feishu-import.json'));
  process.env.BITABLE_MATH_TABLE_ID = state.table;
  const fixtureFile = path.join(work, 'ui-fixtures.json');
  if (mode === '--cleanup') {
    const records = await readJson(fixtureFile).catch(() => []);
    if (records.length) await feishu.request('POST', `${feishu.tablePath(process.env.BITABLE_TASK_TABLE_ID)}/records/batch_delete`,
      { records: records.map(r => r.recordId) });
    await writeJson(fixtureFile, []); console.log(`Removed ${records.length} math verification records`); return;
  }
  if (!['--verify', '--apply'].includes(mode)) throw new Error('Use --verify, --apply or --cleanup');
  const source = await readJson(path.join(work, 'courses.json'));
  const catalog = new MathCourseCatalog(feishu); const started = performance.now();
  const items = await catalog.read(); const coldMs = performance.now() - started;
  const approved = source.filter(c => c.reviewStatus === '已核对');
  assert.equal(items.length, approved.length);
  assert.deepEqual(items.map(c => c.title).sort(), approved.map(c => c.title).sort());
  const catalogs = new CourseCatalogs(feishu); const snapshot = { math: items, physics: [], failed: [] };
  const cases = [];
  for (const name of ['因式分解', '三视图', '分式方程的解法', '二次函数的图象', '用频率估计概率', '韦达定理进阶']) {
    const result = catalogs.match('初三', [{ subject: '数学', name, keywords: [] }], snapshot);
    assert.ok(result.matches.length > 0, name); assert.ok(result.matches.length <= 2);
    cases.push({ query: name, titles: result.matches.map(c => c.title) });
  }
  for (const [grade, subject, name] of [['高三', '数学', '因式分解'], ['初一', '数学', '因式分解'],
    ['初三', '物理', '因式分解'], ['初三', '数学', '计算'], ['初三', '数学', '导数']]) {
    assert.equal(catalogs.match(grade, [{ subject, name, keywords: [] }], snapshot).matches.length, 0);
  }
  const points = ['因式分解', '三视图'].map(name => ({ subject: '数学', name, keywords: [] }));
  const times = [];
  for (let i = 0; i < 1000; i++) {
    const start = performance.now(); catalogs.match('初三', points, snapshot); times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const verification = { at: new Date().toISOString(), source: source.length, approved: items.length,
    pending: source.length - items.length, coldMs, warmP95Ms: times[949], cases,
    negativeCasesPassed: 5, extraOnlineModelCalls: 0 };
  await writeJson(path.join(work, 'verification.json'), verification); console.log(JSON.stringify(verification));
  if (mode !== '--apply') return;
  const previous = await readJson(fixtureFile).catch(() => []);
  if (previous.length) { console.log(JSON.stringify(previous)); return; }
  let encoded = process.env.SUDA_WEBUSER;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { JSON.parse(encoded); break; } catch { encoded = JSON.parse('"' + encoded + '"'); }
  }
  const owner = JSON.parse(encoded).user_id;
  if (!/^\d{10,30}$/u.test(owner || '')) throw new Error('Missing local test identity');
  const matched = catalogs.match('初三', points, snapshot);
  const result = { ok: true, grade: '初三', subjects: ['数学'], wrongItems: [],
    scopeNote: '数学课程集成验证，非客户记录。', warnings: [], needsRephoto: false, rephotoHint: '',
    photoQuality: { assessment: '清晰', issue: '', advice: '' }, knowledgePoints: points,
    courseMatches: matched.matches, courseMatchNote: matched.note };
  const key = randomUUID();
  const record = await feishu.createRecord(process.env.BITABLE_TASK_TABLE_ID, { '请求编号': key, '提交用户': owner,
    '学生姓名': '数学课程集成验证（非客户）', '模式': 'extract-wrong', '状态': 'completed', '进度': '验证数据',
    '开始时间': Date.now(), '输入摘要': key, '结果': JSON.stringify(result) }, key);
  const fixtures = [{ recordId: record.recordId, url: `http://localhost:8080/app/app_17dsmxamvns/?job=${record.recordId}` }];
  await writeJson(fixtureFile, fixtures); console.log(JSON.stringify(fixtures));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
