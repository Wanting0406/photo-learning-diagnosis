const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson, feishu } = require('./materials-import.cjs');

async function main() {
  const [work, command, ownerId] = process.argv.slice(2);
  if (!['--apply', '--cleanup'].includes(command)) throw new Error('Pass --apply or --cleanup for the marked verification records');
  const file = path.join(work, 'ui-fixtures.json');
  const previous = await readJson(file).catch(() => []);
  if (command === '--cleanup') {
    if (previous.length) await feishu.request('POST', `${feishu.tablePath(process.env.BITABLE_TASK_TABLE_ID)}/records/batch_delete`,
      { records: previous.map(r => r.recordId) });
    await writeJson(file, []); console.log(`Removed ${previous.length} verification records`); return;
  }
  if (previous.length) { console.log(JSON.stringify(previous)); return; }
  if (!/^\d{10,30}$/u.test(ownerId || '')) throw new Error('Pass the current local session user ID');
  const tasks = [];
  for (const [grade, points] of [['初三', [['物理', '原子结构'], ['物理', '声音的特性'], ['数学', '三视图']]],
    ['高三', [['数学', '中位数'], ['物理', '双缝干涉'], ['数学', '估计概率']]]]) {
    const key = randomUUID();
    const recognition = { ok: true, grade, subjects: [...new Set(points.map(p => p[0]))], wrongItems: [],
      scopeNote: '长图展示集成验证记录，知识点为测试输入。', warnings: [], needsRephoto: false, rephotoHint: '',
      photoQuality: { assessment: '清晰', issue: '', advice: '' },
      knowledgePoints: points.map(([subject, name]) => ({ subject, name, keywords: [] })), courseMatches: [],
      courseMatchNote: '独立验证长图匹配' };
    const record = await feishu.createRecord(process.env.BITABLE_TASK_TABLE_ID, {
      '请求编号': key, '提交用户': ownerId, '学生姓名': '长图集成验证（非客户）',
      '模式': 'extract-wrong', '状态': 'completed', '进度': '验证数据', '开始时间': Date.now(),
      '输入摘要': key, '结果': JSON.stringify(recognition),
    }, key);
    tasks.push({ recordId: record.recordId, grade, url: `http://localhost:8080/app/app_17dsmxamvns/?job=${record.recordId}` });
    await writeJson(file, tasks);
  }
  console.log(JSON.stringify(tasks));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
