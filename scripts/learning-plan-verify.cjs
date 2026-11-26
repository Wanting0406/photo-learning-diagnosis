const { feishu } = require('./materials-import.cjs');
async function main() {
  const [mode, ...ids] = process.argv.slice(2);
  if (!['--inspect', '--cleanup'].includes(mode) || !ids.length || ids.some(id => !/^rec[A-Za-z0-9]{5,64}$/u.test(id))) {
    throw new Error('Use --inspect or --cleanup with exact synthetic task IDs');
  }
  for (const id of ids) {
    const record = await feishu.getRecord(process.env.BITABLE_TASK_TABLE_ID, id);
    const f = record.fields;
    if (f['学生姓名'] !== '规划验证学生（非客户）' || f['模式'] !== 'learning-plan') throw new Error('Not the marked synthetic planning task');
    if (mode === '--cleanup') {
      await feishu.request('DELETE', `${feishu.tablePath(process.env.BITABLE_TASK_TABLE_ID)}/records/${id}`);
      console.log(JSON.stringify({ id, cleaned: true }));
    } else {
      const report = f['结果'] ? JSON.parse(f['结果']).report : undefined;
      console.log(JSON.stringify({ id, status: f['状态'], phoneSteps: report?.phoneSteps?.length,
        plans: report?.plans?.length, courses: report?.courses?.length, solutions: report?.solutions?.length,
        hasInternalField: /matchedCourses|productLibrary/u.test(f['结果'] || '') }));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
