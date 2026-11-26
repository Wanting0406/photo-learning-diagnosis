const assert = require('node:assert/strict');
const path = require('node:path');
const { feishu, readJson, writeJson } = require('./materials-import.cjs');
const { parseMathDirectory, CourseCatalogs } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');

const TABLE = 'tbly3Xg5AEdFRIm4';
const SOURCE = 'https://guanghe.feishu.cn/wiki/IWxCwfiU5iZ50bkiqbmchaQSnIc';
const PREFIX = 'primary_q3_';
async function rows() {
  const result = []; let token = '';
  for (let page = 0; page < 30; page++) {
    const data = await feishu.listRecords(TABLE, token, 500);
    result.push(...data.items);
    if (!data.pageToken) return result;
    assert.notEqual(data.pageToken, token); token = data.pageToken;
  }
  throw new Error('Unexpected directory size');
}
function validate(data) {
  assert.equal(data.source, SOURCE);
  assert.equal(data.records.length, 1938);
  assert.equal(new Set(data.records.map(r => r['目录ID'])).size, data.records.length);
  for (const r of data.records) {
    assert.match(r['目录ID'], /^primary_q3_[a-f0-9]{24}$/u);
    assert.equal(r['学科'], '数学'); assert.equal(r['审核状态'], '已核对');
    assert.match(r['适用年级'], /^[一二三四五六]年级[上下]册$/u);
    assert.ok(['教材同步', '思维培优'].includes(r['课程类型']));
    assert.ok(['人教版', '人教版（2024）'].includes(r['教材版本']));
    assert.ok(r['原目录链接'].startsWith(SOURCE + '#'));
    assert.match(r['核对说明'], /已发布目录!A\d+:F\d+/u);
    assert.ok(r['课程名称'] && r['课程名称'] === r['知识点名称']);
  }
  const parsed = parseMathDirectory(data.records.map((fields, index) =>
    ({ record_id: `recPreview${index}`, fields })), process.env.BITABLE_APP_TOKEN, TABLE);
  assert.equal(parsed.length, data.records.length);
  return parsed;
}
function verifyMatches(math) {
  const catalog = new CourseCatalogs(feishu);
  const snapshot = { math, physics: [], failed: [] };
  const check = (grade, name, note = '') => catalog.match(grade, [{ subject: '数学', name, keywords: [] }], snapshot, note);
  const cases = [];
  for (const n of ['一', '二', '三', '四', '五', '六']) {
    const row = math.find(r => r.grade === `${n}年级上册`);
    const result = check(`${n}年级`, row.title, row.edition);
    assert.ok(result.matches.some(r => r.title === row.title));
    assert.ok(result.matches.every(r => r.grade.startsWith(`${n}年级`)));
    cases.push({ grade: `${n}年级`, query: row.title, matches: result.matches });
  }
  const decimal = check('四年级', '小数的大小比较');
  assert.ok(decimal.matches.some(r => r.title === '小数的大小比较' && r.courseType === '教材同步'));
  assert.ok(decimal.matches.every(r => r.grade.startsWith('四年级')));
  assert.equal(check('四年级', '乘加和乘减').matches.length, 0);
  assert.equal(check('四年级', '小数的大小比较', '人教版（2024）').matches.length, 0);
  assert.equal(check('初一', '小数的大小比较').matches.length, 0);
  assert.equal(catalog.match('四年级', [{ subject: '物理', name: '小数的大小比较', keywords: [] }], snapshot).matches.length, 0);
  const onlinePoints = [{ subject: '数学', name: '小数的大小比较', keywords: ['小数比较', '位数对齐'] },
    { subject: '数学', name: '乘加混合运算应用', keywords: ['倍数关系', '两步计算'] }];
  assert.deepEqual(catalog.match('四年级', onlinePoints, snapshot).matches.map(r => r.title), ['小数的大小比较']);
  return { cases, decimal, noCrossGrade: true, noWrongEdition: true, noCrossSubject: true };
}
async function main() {
  const [input, mode = '--plan'] = process.argv.slice(2);
  assert.ok(input && ['--plan', '--apply', '--verify'].includes(mode));
  const data = await readJson(input);
  const parsed = validate(data);
  const matchVerification = verifyMatches(parsed);
  const existing = await rows();
  const own = new Map(existing.filter(r => String(r.fields['目录ID']).startsWith(PREFIX))
    .map(r => [r.fields['目录ID'], r]));
  for (const r of data.records) {
    const stored = own.get(r['目录ID']);
    if (stored) assert.deepEqual(Object.fromEntries(Object.keys(r).map(k => [k, stored.fields[k]])), r,
      'Previously imported metadata was edited; do not overwrite manual changes');
  }
  const creates = data.records.filter(r => !own.has(r['目录ID']));
  const plan = { source: SOURCE, table: TABLE, existingTotal: existing.length, incoming: parsed.length,
    create: creates.length, unchanged: data.records.length - creates.length, counts: data.counts, matchVerification };
  const dir = path.dirname(input);
  await writeJson(path.join(dir, 'import-plan.json'), plan);
  if (mode === '--plan') { console.log(JSON.stringify(plan)); return; }
  if (mode === '--apply') {
    const schema = await feishu.request('GET', `${feishu.tablePath(TABLE)}/fields`, undefined, { page_size: '100' });
    if (!schema.items.some(f => f.field_name === '核对说明')) {
      await feishu.request('POST', `${feishu.tablePath(TABLE)}/fields`, { field_name: '核对说明', type: 1 });
    }
    for (let i = 0; i < creates.length; i += 100) {
      await feishu.request('POST', `${feishu.tablePath(TABLE)}/records/batch_create`,
        { records: creates.slice(i, i + 100).map(fields => ({ fields })) });
      console.log(JSON.stringify({ created: Math.min(i + 100, creates.length), total: creates.length }));
    }
  }
  const after = await rows();
  const imported = after.filter(r => String(r.fields['目录ID']).startsWith(PREFIX));
  assert.equal(imported.length, data.records.length);
  const importedById = new Map(imported.map(r => [r.fields['目录ID'], r.fields]));
  assert.equal(importedById.size, data.records.length);
  for (const expected of data.records) {
    const stored = importedById.get(expected['目录ID']);
    assert.ok(stored, 'Missing imported source record');
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(k => [k, stored[k]])), expected,
      'Imported metadata differs from source');
  }
  for (const original of existing.filter(r => !String(r.fields['目录ID']).startsWith(PREFIX))) {
    assert.deepEqual(after.find(r => r.recordId === original.recordId)?.fields, original.fields,
      'Unrelated directory record changed');
  }
  const actual = parseMathDirectory(imported.map(r => ({ record_id: r.recordId, fields: r.fields })),
    process.env.BITABLE_APP_TOKEN, TABLE);
  assert.equal(actual.length, data.records.length);
  const verification = { verifiedAt: new Date().toISOString(), table: TABLE, imported: actual.length,
    counts: data.counts, ...verifyMatches(actual), unrelatedRecordsPreserved: true };
  await writeJson(path.join(dir, 'verification.json'), verification);
  console.log(JSON.stringify(verification));
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
