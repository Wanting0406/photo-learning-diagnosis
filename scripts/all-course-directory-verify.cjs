const assert = require('node:assert/strict');
const path = require('node:path');
const { feishu, readJson, writeJson } = require('./materials-import.cjs');
const { CourseCatalogs, courseSubjects } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
async function main() {
  const work = process.argv[2]; assert.ok(work);
  const tables = await readJson(path.join(work, 'tables.json'));
  assert.equal(Object.keys(tables).length, 3);
  process.env.BITABLE_ALL_COURSE_TABLES = JSON.stringify(tables);
  Object.assign(process.env, { BITABLE_MATH_TABLE_ID: 'tblnsV4BVWe6N0Um', BITABLE_MATH_KNOWLEDGE_TABLE_ID: 'tbly3Xg5AEdFRIm4',
    BITABLE_SENIOR_KNOWLEDGE_TABLE_ID: 'tblWZ9tzcK6j6m1X', BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID: 'tblaKIsn6OW8wk1l' });
  const catalogs = new CourseCatalogs(feishu); const at = performance.now();
  const snapshot = await catalogs.read(courseSubjects); const coldMs = performance.now() - at;
  assert.deepEqual(snapshot.failed, []); assert.equal(snapshot.all.length, 19890);
  const cases = [];
  for (const [grade, subject, query, expected] of [
    ['二年级', '语文', '如何看图', '如何看图'], ['三年级', '英语', '自然拼读学什么', '自然拼读学什么？'],
    ['四年级', '数学', '小数的大小比较', '小数的大小比较'], ['四年级', '物理', '什么是沸腾', '什么是沸腾？'],
    ['五年级', '生物', '孢子植物是什么', '孢子植物是什么？'], ['六年级', '地理', '地球家园有什么', '地球家园有什么？'],
    ['初一', '历史', '北京人', '北京人'], ['初一', '道德与法治', '规划初中生活', '规划初中生活'],
    ['高中', '语文', '伟人的青春什么样', '伟人的青春什么样？'],
    ['高一', '数学', '集合与元素', '集合与元素'], ['高二', '政治', '原始社会生产关系', '社会发展的规律与原始社会生产关系'],
    ['高中', '地理', '古代对天体的认识', '古代对天体的认识'],
    ['高一', '历史', '中华文明的起源', '中华文明的起源'],
  ]) {
    const result = catalogs.match(grade, [{ subject, name: query, keywords: [] }], snapshot);
    assert.ok(result.matches.some(c => c.title === expected), JSON.stringify({ grade, subject, query, result }));
    assert.ok(result.matches.every(c => c.subject === subject));
    assert.doesNotMatch(result.note, /尚未接入|暂无可匹配|暂无已核对|读取失败/u);
    cases.push({ grade, subject, query, result });
  }
  const warmAt = performance.now(); await catalogs.read(courseSubjects); const warmReadMs = performance.now() - warmAt;
  const editionCase = catalogs.match('高一', [{ subject: '物理', name: '质点', keywords: [] }], snapshot, '人教版');
  assert.ok(editionCase.matches.some(c => c.title === '质点' && c.edition === '人教版高中物理'));
  cases.push({ grade: '高一', subject: '物理', query: '质点（备注人教版）', result: editionCase });
  const times = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now(); catalogs.match('初中', [{ subject: '数学', name: '一元二次方程', keywords: [] }], snapshot);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b); assert.ok(times[189] < 200);
  const result = { at: new Date().toISOString(), newCourses: snapshot.all.length, oldMathCourses: snapshot.math.length,
    coldMs, warmReadMs, matchingP95Ms: times[189], failed: snapshot.failed, extraModelCalls: 0, cases };
  await writeJson(path.join(work, 'live-matching-verification.json'), result);
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
