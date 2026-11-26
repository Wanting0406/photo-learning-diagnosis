require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { HttpService } = require('@nestjs/axios');
const { FeishuService } = require('../server/modules/diagnosis-gateway/feishu.service');
const { VisionService } = require('../server/modules/diagnosis-gateway/vision.service');
const { DiagnosisGatewayService } = require('../server/modules/diagnosis-gateway/diagnosis-gateway.service');

// Explicit opt-in: creates isolated integration records and deletes only those records afterwards.
async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Use --apply to verify live Feishu writes; add --model PHOTO to invoke the model.');
  const http = new HttpService();
  http.axiosRef.interceptors.response.use(response => {
    if (response.data?.code) console.error(`Feishu rejected operation: code=${response.data.code}`);
    return response;
  }, error => {
    console.error(`Upstream HTTP error: status=${error.response?.status}, code=${error.response?.data?.code}`);
    return Promise.reject(error);
  });
  const feishu = new FeishuService(http);
  const cleanup = [];
  try {
    const key = randomUUID();
    const fields = { '请求编号': key, '提交用户': 'integration-check', '学生姓名': '集成验证',
      '模式': 'extract-wrong', '状态': 'completed', '开始时间': Date.now() };
    const first = await feishu.createRecord(process.env.BITABLE_TASK_TABLE_ID, fields, key);
    cleanup.push([process.env.BITABLE_TASK_TABLE_ID, first.recordId]);
    const repeated = await feishu.createRecord(process.env.BITABLE_TASK_TABLE_ID, fields, key);
    if (repeated.recordId !== first.recordId) cleanup.push([process.env.BITABLE_TASK_TABLE_ID, repeated.recordId]);
    assert.equal(repeated.recordId, first.recordId, 'Feishu creation must honor client_token');
    const found = await feishu.findTask(key);
    assert.equal(found?.recordId, first.recordId);
    assert.equal(found.fields['提交用户'], 'integration-check');
    console.log('PASS Feishu record creation, client_token, search and text shape');
    const photoIndex = process.argv.indexOf('--model');
    if (photoIndex === -1) return;
    const photoPath = process.argv[photoIndex + 1];
    if (!photoPath) throw new Error('Missing photo path');
    const vision = new VisionService(http);
    let service = new DiagnosisGatewayService(vision, feishu);
    let recognitionJobId; let initialCourses;
    const verifyCourses = process.argv.includes('--physics');
    let uploads = 0;
    const uploadPhoto = feishu.uploadPhoto.bind(feishu);
    feishu.uploadPhoto = async photo => { uploads++; return uploadPhoto(photo); };
    const identity = { userId: `integration-${randomUUID()}`, userName: '集成验证' };
    const input = { studentName: '集成验证', grade: verifyCourses ? '初二' : '', subject: verifyCourses ? '物理' : '数学',
      note: verifyCourses ? '人教版，每天二十分钟；非客户测试记录' : '迁移集成验证，非客户记录', wrongItems: [],
      photos: [{ name: 'integration.jpg', mimeType: 'image/jpeg', dataBase64: fs.readFileSync(photoPath).toString('base64') }] };
    for (const mode of ['extract-wrong', 'analyze']) {
      // A fresh service forces the durable-photo path, as with a restart or a different replica.
      if (mode === 'analyze') service = new DiagnosisGatewayService(vision, feishu);
      const started = await service.start(mode, { requestId: randomUUID(),
        input: mode === 'analyze' ? { ...input, photos: [] } : input,
        ...(recognitionJobId ? { recognitionJobId } : {}) }, identity);
      cleanup.push([process.env.BITABLE_TASK_TABLE_ID, started.jobId]);
      const deadline = Date.now() + 7 * 60 * 1000;
      let job = started;
      while (job.status === 'running' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        job = await service.job(started.jobId, identity.userId);
      }
      if (job.result?.recordId) cleanup.push([process.env.BITABLE_DIAGNOSIS_TABLE_ID, job.result.recordId]);
      assert.equal(job.status, 'completed', job.error || 'Task did not complete');
      if (mode === 'extract-wrong') {
        assert.equal(job.reusable, true, 'Recognition must preserve reusable photos');
        input.wrongItems = job.result.wrongItems; recognitionJobId = job.jobId;
        assert.doesNotMatch(JSON.stringify(job), /file_token|dataBase64|artifact/u);
        if (verifyCourses) {
          assert.ok(job.result.knowledgePoints?.length, 'Initial recognition must extract visual knowledge points');
          initialCourses = job.result.courseMatches;
          assert.ok(initialCourses?.length >= 1 && initialCourses.length <= 2, 'Return one or two real courses before diagnosis');
          assert.ok(initialCourses.every(course => course.sourceUrl.includes('record=rec')));
          console.log(JSON.stringify({ initialPoints: job.result.knowledgePoints, initialCourses, timings: job.timings }));
        }
      }
      else {
        assert.equal(job.result.stored, true, job.result.warnings.join('; '));
        const record = await feishu.getRecord(process.env.BITABLE_DIAGNOSIS_TABLE_ID, job.result.recordId);
        assert.equal(record.fields['销售'], identity.userName);
        const attachment = record.fields['照片附件'][0];
        const downloaded = await feishu.downloadPhoto(attachment.file_token);
        assert.equal(downloaded.contentType, 'image/jpeg');
        assert.ok(downloaded.body.equals(fs.readFileSync(photoPath)));
        assert.equal(uploads, 1, 'Analysis must reuse the original uploaded attachment');
        if (verifyCourses) {
          assert.deepEqual(job.result.diagnosis.courseMatches, initialCourses);
          assert.equal(job.timings.knowledgeReadMs, undefined, 'Full report must reuse the initial catalog matches');
        }
      }
      assert.ok(job.timings.modelMs >= 0);
      console.log(`PASS ${mode}: model, task polling${mode === 'analyze' ? ', diagnosis write and attachment roundtrip' : ''}`);
    }
  } finally {
    for (const [table, record] of cleanup.reverse()) {
      const token = await feishu.accessToken();
      const response = await http.axiosRef.delete(`https://open.feishu.cn/open-apis${feishu.tablePath(table)}/records/${record}`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 20000, maxRedirects: 0,
      });
      assert.equal(response.data.code, 0, `Cleanup failed for ${record}`);
    }
    console.log(`Removed ${cleanup.length} integration records`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
