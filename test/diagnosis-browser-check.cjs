require('reflect-metadata');
const assert = require('node:assert/strict');
const { HttpService } = require('@nestjs/axios');
const { FeishuService } = require('../server/modules/diagnosis-gateway/feishu.service');

// Inspect and clean up only explicit browser-test task IDs, never a broad table search.
async function main() {
  const [flag, expectedName, ...ids] = process.argv.slice(2);
  assert.equal(flag, '--apply');
  assert.match(expectedName, /^性能集成验证/u);
  assert.equal(ids.length, 2);
  ids.forEach(id => assert.match(id, /^rec[A-Za-z0-9]{5,64}$/u));
  const http = new HttpService(); const feishu = new FeishuService(http);
  const tasks = [];
  for (const id of ids) {
    const task = await feishu.getRecord(process.env.BITABLE_TASK_TABLE_ID, id);
    assert.equal(task.fields['学生姓名'], expectedName);
    assert.equal(task.fields['状态'], 'completed');
    tasks.push(task);
  }
  const source = tasks.find(task => task.fields['模式'] === 'extract-wrong');
  const analysis = tasks.find(task => task.fields['模式'] === 'analyze');
  assert.ok(source); assert.ok(analysis);
  assert.equal(source.fields['提交用户'], analysis.fields['提交用户']);
  const storedRecognition = JSON.parse(source.fields['结果']);
  const storedAnalysis = JSON.parse(analysis.fields['结果']);
  assert.equal(storedRecognition.format, 'diagnosis-v2');
  assert.equal(storedAnalysis.format, 'diagnosis-v2');
  assert.ok(storedRecognition.artifact.photos.length);
  assert.equal(storedAnalysis.result.stored, true);
  assert.equal(storedAnalysis.timings.photoArchiveMs, undefined, 'Reference analysis must not upload again');
  const businessId = storedAnalysis.result.recordId;
  const business = await feishu.getRecord(process.env.BITABLE_DIAGNOSIS_TABLE_ID, businessId);
  assert.equal(business.fields['学生姓名'], expectedName);
  assert.deepEqual(business.fields['照片附件'].map(photo => photo.file_token),
    storedRecognition.artifact.photos.map(photo => photo.token));
  console.log('PASS browser recognition, persisted timings, photo reference reuse and diagnosis attachment identity');
  const cleanup = [[process.env.BITABLE_DIAGNOSIS_TABLE_ID, businessId],
    ...ids.map(id => [process.env.BITABLE_TASK_TABLE_ID, id])];
  const token = await feishu.accessToken();
  for (const [table, id] of cleanup) {
    const response = await http.axiosRef.delete(`https://open.feishu.cn/open-apis${feishu.tablePath(table)}/records/${id}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 20000, maxRedirects: 0,
    });
    assert.equal(response.data.code, 0);
  }
  console.log(`Removed ${cleanup.length} verified browser-test records`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
