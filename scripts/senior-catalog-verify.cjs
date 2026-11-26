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
  const state = async name => JSON.parse(await fs.readFile(path.join(work, 'math-work', name), 'utf8'));
  process.env.BITABLE_MATH_TABLE_ID = (await state('feishu-import.json')).table;
  process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID = (await state('knowledge-table.json')).table;
  process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID = (await state('senior-other-table.json')).table;
  const catalogs = new CourseCatalogs(feishu); const start = performance.now();
  const snapshot = await catalogs.read(courseSubjects); const coldMs = performance.now() - start;
  assert.deepEqual(snapshot.failed, []); assert.equal(snapshot.senior.length, 259);
  const cases = [];
  for (const [subject, query, expected] of [
    ['物理', '动能定理', '动能定理及其应用'], ['化学', '可逆反应', '第30讲 化学平衡与可逆反应'],
    ['生物', '光合作用的过程与场所', '光合作用的过程与场所'],
    ['英语', '记叙文-介绍人物类', '记叙文-介绍人物类'], ['数学', '外接球', '第40讲 外接球与内切球'],
    ['化学', '2024全国甲卷', '2024全国甲卷'],
  ]) {
    const result = catalogs.match('高三', [{ subject, name: query, keywords: [] }], snapshot);
    assert.ok(result.matches.some(c=>c.title===expected), JSON.stringify({subject,query,result}));
    assert.ok(result.matches.length<=2);
    cases.push({subject,query,titles:result.matches.map(c=>c.title),notes:result.matches.map(c=>c.reviewNote||'')});
  }
  for (const grade of ['高一','高二','高三']) {
    assert.ok(catalogs.match(grade,[{subject:'化学',name:'可逆反应',keywords:[]}],snapshot).matches.length>0);
  }
  for (const grade of ['一年级','初三','高中']) {
    assert.equal(catalogs.match(grade,[{subject:'化学',name:'可逆反应',keywords:[]}],snapshot).matches.length,0);
  }
  for (const query of ['化学','计算','实验','全国甲卷']) {
    assert.equal(catalogs.match('高三',[{subject:'化学',name:query,keywords:[]}],snapshot).matches.length,0);
  }
  assert.equal(catalogs.match('高三',[{subject:'英语',name:'可逆反应',keywords:[]}],snapshot).matches.length,0);
  const times=[];
  for(let i=0;i<1000;i++) { const at=performance.now();catalogs.match('高三',[{subject:'化学',name:'可逆反应',keywords:[]}],snapshot);times.push(performance.now()-at); }
  times.sort((a,b)=>a-b); assert.ok(times[949]<=200);
  const report={at:new Date().toISOString(),seniorRows:snapshot.senior.length,
    bySubject:Object.fromEntries(['物理','化学','生物','英语'].map(s=>[s,snapshot.senior.filter(c=>c.subject===s).length])),
    mathCourses:snapshot.math.length,juniorPhysicsCourses:snapshot.physics.length,
    exactOnly:snapshot.senior.filter(c=>c.exactOnly).length,coldMs,warmP95Ms:times[949],cases,extraModelCalls:0};
  await fs.writeFile(path.join(work,'math-work/senior-online-match-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
