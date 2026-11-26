const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
require('dotenv').config({ path: path.join(__dirname, '../.env.local'), quiet: true });
process.env.TS_NODE_PROJECT = path.join(__dirname, '../tsconfig.node.json');
require('ts-node/register');
const { feishu } = require('./materials-import.cjs');
const { CourseCatalogs, courseSubjects } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
async function main() {
  const work = process.argv[2]; assert.ok(work, 'Provide data work directory');
  const data = async file => JSON.parse(await fs.readFile(path.join(work, file), 'utf8'));
  process.env.BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID = (await data('junior-work/table.json')).table;
  process.env.BITABLE_MATH_TABLE_ID = (await data('math-work/feishu-import.json')).table;
  process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID = (await data('math-work/knowledge-table.json')).table;
  process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID = (await data('math-work/senior-other-table.json')).table;
  const rows = await data('junior-work/directory-rows.json');
  const expected = rows.filter(row => row['审核状态'] === '已核对');
  const catalogs = new CourseCatalogs(feishu); const start = performance.now();
  const snapshot = await catalogs.read(courseSubjects);
  const coldMs = performance.now() - start;
  assert.deepEqual(snapshot.failed, []);
  assert.equal(snapshot.junior.length, expected.length);
  assert.equal(snapshot.senior.length, 259);
  const cases = [];
  const physicsPoint = [{ subject: '物理', name: '后视镜问题', keywords: [] }];
  const advancedPhysics = catalogs.match('初二', physicsPoint, { ...snapshot, physics: [] }, '人教版');
  assert.ok(advancedPhysics.matches.some(c => c.title === '后视镜问题' && c.courseType === '重难点培优'));
  cases.push({ subject: '物理', grade: '初二', query: '后视镜问题', titles: advancedPhysics.matches.map(c => c.title) });
  for (const [subject, grade, query, title, edition] of [
    ['化学', '初三', '测定空气中氧气含量的改进实验题', '测定空气中氧气含量的改进实验题', '人教版'],
    ['生物', '初一', '显微镜使用及成像特点综合', '显微镜使用及成像特点综合', '人教版'],
    ['地理', '初一', '经纬网定位', '经纬网定位-极地经纬网', '人教版'],
    ['英语', '初一', '名词数的一致性', '名词数的一致性(上)', '人教版'],
    ['语文', '初二', '中心论点', '中心论点类题型（一）', ''],
  ]) {
    const points = [{ subject, name: query, keywords: [] }];
    const result = catalogs.match(grade, points, snapshot, edition);
    assert.ok(result.matches.some(c => c.title === title), JSON.stringify({ subject, query, result }));
    assert.ok(result.matches.length <= 2);
    assert.ok(result.matches.every(c => c.subject === subject && c.grade === grade));
    for (const wrong of ['一年级', '高一', '高三']) {
      assert.equal(catalogs.match(wrong, points, { ...snapshot, senior: [] }, edition).matches.length, 0);
    }
    for (const generic of ['实验', '阅读', '中考', '培优', '总复习', subject]) {
      assert.equal(catalogs.match(grade, [{ subject, name: generic, keywords: [] }], snapshot, edition).matches.length, 0);
    }
    cases.push({ subject, grade, query, titles: result.matches.map(c => c.title), note: result.note });
  }
  assert.equal(catalogs.match('初一', [{ subject: '英语', name: '测定空气中氧气含量', keywords: [] }], snapshot).matches.length, 0);
  const physicsTypes = Object.fromEntries([...new Set(snapshot.physics.map(c => c.courseType))]
    .map(type => [type, snapshot.physics.filter(c => c.courseType === type).length]));
  const times = [];
  for (let i = 0; i < 1000; i++) {
    const at = performance.now();
    catalogs.match('初三', [{ subject: '化学', name: '测定空气中氧气含量', keywords: [] }], snapshot);
    times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b); assert.ok(times[949] <= 200);
  const report = { at: new Date().toISOString(), reviewed: snapshot.junior.length,
    pendingExcluded: rows.length - snapshot.junior.length,
    bySubject: Object.fromEntries(['物理', '化学', '生物', '地理', '英语', '语文'].map(subject =>
      [subject, snapshot.junior.filter(c => c.subject === subject).length])),
    mathCourses: snapshot.math.length, seniorCourses: snapshot.senior.length,
    physicsCourses: snapshot.physics.length, physicsTypes, coldMs, warmP95Ms: times[949], cases, extraModelCalls: 0 };
  await fs.writeFile(path.join(work, 'junior-work/match-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
