require('reflect-metadata');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { of, throwError } = require('rxjs');
const { randomUUID } = require('node:crypto');
const { DiagnosisGatewayService, requestKey, recordFields } = require('../server/modules/diagnosis-gateway/diagnosis-gateway.service');
const { DiagnosisGatewayController } = require('../server/modules/diagnosis-gateway/diagnosis-gateway.controller');
const { diagnosisInputSchema } = require('../server/modules/diagnosis-gateway/diagnosis-gateway.validation');
const { normalizeRecognition, normalizeDiagnosis, parseModel } = require('../server/modules/diagnosis-gateway/diagnosis-normalize');
const { recommend } = require('../server/modules/diagnosis-gateway/diagnosis-recommendation');
const { eligibleCapabilities, PRODUCT_SOURCE } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');
const { renderReport } = require('../server/modules/diagnosis-gateway/diagnosis-report');
const { VisionService } = require('../server/modules/diagnosis-gateway/vision.service');

function visionStub(respond) {
  const calls = [];
  const capability = { load: (id) => ({ call: async (action, params) => {
    calls.push({ id, action, params });
    return { content: await respond({ id, action, params, index: calls.length - 1 }) };
  } }) };
  const files = {
    upload: async (_body, options) => ({ filePath: `tmp/${options.fileName}`, bucketID: 'bucket-a' }),
    from: () => ({ createSignedUrl: async (path) => `https://files.example/${path}` }),
    remove: async () => [],
  };
  return { vision: new VisionService(capability, files), calls };
}
const { PhysicsCourseCatalog, parsePhysicsCourses, matchPhysicsCourses, matchPhysicsKnowledge } = require('../server/modules/diagnosis-gateway/diagnosis-knowledge');
const { reportInputSchema } = require('../server/modules/diagnosis-gateway/diagnosis-gateway.validation');
const { normalizeFields } = require('../server/modules/diagnosis-gateway/feishu.service');
const { TaskRecordCache, RecognitionPhotoCache, TaskTimings } = require('../server/modules/diagnosis-gateway/diagnosis-performance');
const { productRows, productCapabilities, productTableId } = require('./product-fixtures.cjs');

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
const input = { studentName: '测试学生', grade: '初一', subject: '数学', note: '', wrongItems: ['第 1 题'],
  photos: [{ name: 'test.png', mimeType: 'image/png', dataBase64: png }] };
const identity = { userId: 'owner', userName: '顾问' };
const raw = { grade: '初一', subjects: ['数学'], overall: '能辨认的题目中存在概念问题。',
  problems: [{ subject: '数学', item: '第 1 题', error_type: '概念不清', knowledge_point: '有理数', root_cause: '未区分概念', suggestion: '复习定义' }],
  plan: ['复习有理数定义'], parent_message: '建议核对第 1 题。', wrong_items: ['模型自加的第 9 题'],
  selected_capability_ids: ['CAP-COURSE-01', 'CAP-PRACTICE-01', 'CAP-AI-02'] };

class FakeFeishu {
  configured = true;
  records = new Map(); calls = []; failBusiness = false; failVisionState = false;
  async findTask(key) { return [...this.records.values()].find((record) => record.fields['请求编号'] === key) || null; }
  async createRecord(table, fields, token) {
    this.calls.push({ table, fields, token });
    if (table === 'diagnoses' && this.failBusiness) throw new Error('secret-upstream-body');
    const record = { recordId: `recTest${this.records.size + 1}`, fields: { ...fields } };
    this.records.set(record.recordId, record); return record;
  }
  async updateRecord(table, id, fields) { Object.assign(this.records.get(id).fields, fields); }
  async getRecord(table, id) { return this.records.get(id); }
  async mapping() { return []; }
  uploads = 0; downloads = 0;
  async uploadPhoto() { this.uploads++; return 'file-token'; }
  async downloadPhoto() { this.downloads++; return { body: Buffer.from(png, 'base64'), contentType: 'image/png' }; }
  async listRecords(table) { return { items: table === productTableId() ? productRows : [], pageToken: '' }; }
}
beforeEach(() => { process.env.BITABLE_TASK_TABLE_ID = 'tasks'; process.env.BITABLE_DIAGNOSIS_TABLE_ID = 'diagnoses'; });
async function waitFinished(service, id) {
  for (let i = 0; i < 30; i++) {
    const job = await service.job(id, identity.userId);
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Job failed to finish');
}

test('diagnosis endpoints retain login, default sales access and explicit administrator guards', () => {
  const methods = Object.getOwnPropertyNames(DiagnosisGatewayController.prototype)
    .filter((name) => !['constructor', 'identity'].includes(name));
  for (const name of methods) {
    const handler = DiagnosisGatewayController.prototype[name];
    assert.ok(Reflect.getMetadata('authnpaas:needLogin', handler), name);
    const requirement = Reflect.getMetadata('authzpaas:roles', handler);
    if (['records', 'config', 'photos', 'photo', 'testFeishu'].includes(name)) {
      assert.deepEqual(requirement?.roles, ['admin'], name);
    } else if (['materialMatches', 'materialImage', 'productMaterials', 'productImage'].includes(name)) {
      assert.deepEqual(requirement?.roles, ['sales', 'admin'], name);
    } else {
      assert.ok(['session', 'health', 'recognize', 'analyze', 'findJob', 'clientTiming', 'job', 'report'].includes(name), name);
      assert.equal(requirement, undefined, name);
    }
  }
  const controller = new DiagnosisGatewayController({});
  assert.throws(() => controller.health({ userContext: {} }), (e) => e.getStatus() === 401);
});
test('photo validation rejects forged identities, mismatched image types and oversized aggregate', () => {
  assert.equal(diagnosisInputSchema.safeParse(input).success, true);
  assert.equal(diagnosisInputSchema.safeParse({ ...input, salesName: 'forged' }).success, false);
  assert.equal(diagnosisInputSchema.safeParse({ ...input, photos: [{ ...input.photos[0], mimeType: 'image/jpeg' }] }).success, false);
  assert.equal(diagnosisInputSchema.safeParse({ ...input, photos: [{ ...input.photos[0], dataBase64: png + '\n' }] }).success, false);
  const large = Buffer.alloc(7 * 1024 * 1024); Buffer.from(png, 'base64').copy(large);
  const photo = { ...input.photos[0], dataBase64: large.toString('base64') };
  assert.equal(diagnosisInputSchema.safeParse({ ...input, photos: [photo, photo] }).success, false);
});
test('subjective and low-confidence answers remain uncertain, never preselected', () => {
  const result = normalizeRecognition({ ...raw, items: [
    { item: 'A', question_type: '主观', verdict: '错', confidence: '高' },
    { item: 'B', question_type: '客观', verdict: '错误', confidence: '低' },
    { item: 'C', question_type: '客观', verdict: '错误', confidence: '高' },
    { item: 'D', question_type: '客观', verdict: '部分正确', confidence: '高' },
  ] }, input, 'grade');
  assert.deepEqual(result.wrongItems, ['C']);
  assert.deepEqual(result.items.map((item) => item.verdict), ['存疑', '存疑', '错', '存疑']);
});
test('analysis uses confirmed scope and no-error mode removes invented weaknesses', () => {
  const result = normalizeDiagnosis(raw, input);
  assert.deepEqual(result.diagnosis.wrongItems, input.wrongItems);
  const mastery = normalizeDiagnosis({ ...raw, weak_points: ['invented'] }, { ...input, wrongItems: [] });
  assert.deepEqual(mastery.diagnosis.problems, []);
  assert.deepEqual(mastery.diagnosis.weakPoints, []);
  assert.throws(() => parseModel('{"overall":"truncated"'));
  assert.throws(() => normalizeDiagnosis({}, input));
});
test('product recommendation uses verified capability paths and never infers membership', () => {
  const { diagnosis } = normalizeDiagnosis(raw, input);
  assert.equal(recommend(diagnosis, raw.selected_capability_ids), true);
  assert.equal(diagnosis.membership, '待定');
  assert.match(diagnosis.onionRecommendation, /同步概念课/u);
  assert.match(diagnosis.onionRecommendation, /验收：/u);
  assert.match(diagnosis.onionRecommendation, /使用边界：/u);
  assert.ok(diagnosis.onionRecommendation.includes(PRODUCT_SOURCE));
  assert.doesNotMatch(diagnosis.onionRecommendation, /AI 私教|拍照即出|全科会员|免费体验/u);
  const fields = recordFields(diagnosis, input, identity, 'raw');
  assert.equal(fields['销售'], identity.userName); assert.equal(fields['跟进状态'], '待跟进');
});
test('product selection rejects invented, out-of-scope, missing and oversized combinations', () => {
  for (const ids of [undefined, [], ['CAP-COURSE-01', 'invented'],
    ['CAP-PRIMARY-01', 'CAP-COURSE-01'], ['CAP-JUNIOR-01', 'CAP-COURSE-01'],
    ['CAP-AI-01', 'CAP-AI-02', 'CAP-AI-03', 'CAP-AI-04', 'CAP-AI-05'],
    ['CAP-COURSE-01', 'CAP-AI-02', null]]) {
    const { diagnosis } = normalizeDiagnosis({ ...raw, parent_message: '推荐虚构产品', sales_tips: '免费体验' }, input);
    assert.equal(recommend(diagnosis, ids), false);
    assert.match(diagnosis.onionRecommendation, /尚未形成可核实/u);
    assert.doesNotMatch(diagnosis.parentMessage + diagnosis.salesTips, /虚构产品|免费体验/u);
  }
  const { diagnosis } = normalizeDiagnosis(raw, input);
  assert.equal(recommend(diagnosis, ['CAP-COURSE-01', 'CAP-COURSE-01', 'CAP-AI-02']), true);
  assert.equal(diagnosis.onionRecommendation.split('同步概念课').length, 2);
});
test('product library respects stage and subject restrictions and unreadable photos', () => {
  const ids = (grade, subjects) => eligibleCapabilities(grade, subjects).map(item => item.id);
  assert.ok(ids('四年级', ['数学']).includes('CAP-PRIMARY-01'));
  assert.ok(!ids('四年级', ['语文']).includes('CAP-PRIMARY-01'));
  assert.ok(ids('初二', ['英语']).includes('CAP-JUNIOR-01'));
  assert.ok(!ids('初二', ['数学']).includes('CAP-JUNIOR-01'));
  assert.ok(ids('高一', ['物理']).includes('CAP-COURSE-05'));
  assert.ok(!ids('四年级', ['物理']).includes('CAP-COURSE-05'));
  assert.ok(!ids('', []).some(id => /PRIMARY|JUNIOR/u.test(id)));
  const { diagnosis } = normalizeDiagnosis({ ...raw,
    photo_quality: { assessment: '无法辨认', issue: '模糊', advice: '补拍' } }, input);
  assert.equal(recommend(diagnosis, raw.selected_capability_ids), false);
});
test('no-error analysis does not automatically upsell advanced courses or all-subject membership', () => {
  const { diagnosis } = normalizeDiagnosis(raw, { ...input, wrongItems: [] });
  assert.equal(recommend(diagnosis, undefined), false);
  assert.equal(diagnosis.membership, '待定');
  assert.doesNotMatch(diagnosis.onionRecommendation, /培优|全科会员/u);
});
test('sales follow-up accepts short model lists and supplies a document-based fallback when absent', () => {
  const { diagnosis } = normalizeDiagnosis({ ...raw, sales_tips: ['核对教材版本', '确认账号权益', '安排复测', '多余条目'] }, input);
  assert.equal(diagnosis.salesTips, '核对教材版本\n确认账号权益\n安排复测');
  for (const sales_tips of ['', undefined]) {
    const result = normalizeDiagnosis({ ...raw, sales_tips }, input).diagnosis;
    assert.equal(recommend(result, raw.selected_capability_ids), true);
    assert.match(result.salesTips, /账号权益/u);
    assert.match(result.salesTips, /复测/u);
  }
});
test('customer-facing product text removes internal capability IDs without removing learning context', () => {
  const { diagnosis } = normalizeDiagnosis({ ...raw,
    parent_message: '先用同步概念课（CAP-COURSE-01），再做专项突破(CAP-PRACTICE-04)，核对进率（1m=100cm）。',
    sales_tips: 'CAP-AI-02 记录错因并复测。', plan: ['同步概念课（CAP-COURSE-01）后口述规则'] }, input);
  assert.equal(recommend(diagnosis, ['CAP-COURSE-01', 'CAP-PRACTICE-04', 'CAP-AI-02']), true);
  assert.equal(diagnosis.parentMessage, '先用同步概念课，再做专项突破，核对进率（1m=100cm）。');
  assert.equal(diagnosis.salesTips, '记录错因并复测。');
  assert.deepEqual(diagnosis.plan, ['同步概念课后口述规则']);
});
test('HTML report escapes user/model content and contains no executable scripts', () => {
  const { diagnosis } = normalizeDiagnosis(raw, input);
  diagnosis.overall = '<script>alert(1)</script>';
  const html = renderReport(diagnosis, '<img src=x>', '顾问');
  assert.doesNotMatch(html, /<script/iu); assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /&lt;img src=x&gt;/u); assert.match(html, /近期学习安排/u);
  assert.ok(html.indexOf('<h2>家长沟通</h2>') < html.indexOf('<h2>总体学情</h2>'));
  assert.equal(html.split('<h2>家长沟通</h2>').length, 2);
});
test('task start returns before model completes; result is durable, scoped and stored once', async () => {
  const feishu = new FakeFeishu(); let resolveModel;
  const vision = { configured: true, analyze: () => new Promise((resolve) => { resolveModel = resolve; }) };
  const service = new DiagnosisGatewayService(vision, feishu);
  const submission = { requestId: '00000000-0000-4000-a000-000000000001', input };
  const started = await service.start('analyze', submission, identity);
  assert.equal(started.status, 'running');
  await assert.rejects(() => service.job(started.jobId, 'someone-else'), (e) => e.getStatus() === 404);
  const repeat = await service.start('analyze', submission, identity);
  assert.equal(repeat.jobId, started.jobId); assert.equal(feishu.calls.length, 1);
  await assert.rejects(() => service.start('analyze', { ...submission, input: { ...input, note: 'changed' } }, identity), (e) => e.getStatus() === 409);
  resolveModel({ data: raw, raw: JSON.stringify(raw) });
  const done = await waitFinished(service, started.jobId);
  assert.equal(done.status, 'completed'); assert.equal(done.result.stored, true);
  assert.equal(feishu.calls.filter((call) => call.table === 'diagnoses').length, 1);
  assert.notEqual(feishu.calls[0].token, feishu.calls[1].token);
  assert.equal((await service.start('analyze', submission, identity)).jobId, started.jobId);
});
test('write failure preserves diagnosis with an explicit unsaved warning', async () => {
  const feishu = new FakeFeishu(); feishu.failBusiness = true;
  const service = new DiagnosisGatewayService({ configured: true, analyze: async () => ({ data: raw, raw: 'raw' }) }, feishu);
  const started = await service.start('analyze', { requestId: '00000000-0000-4000-a000-000000000002', input }, identity);
  const done = await waitFinished(service, started.jobId);
  assert.equal(done.status, 'completed'); assert.equal(done.result.stored, false);
  assert.ok(done.result.warnings.length); assert.equal(done.result.diagnosis.overall, raw.overall);
  assert.doesNotMatch(JSON.stringify(done), /secret-upstream-body/u);
});
test('independent result writes overlap but completion waits for both to settle', async () => {
  const feishu = new FakeFeishu(); let releaseBackup; let releaseBusiness; let backupStarted = false; let businessStarted = false;
  const backupGate = new Promise(resolve => { releaseBackup = resolve; });
  const businessGate = new Promise(resolve => { releaseBusiness = resolve; });
  const update = feishu.updateRecord.bind(feishu), create = feishu.createRecord.bind(feishu);
  feishu.updateRecord = async (table, id, fields) => {
    if (fields['进度'] === '正在保存照片与诊断') { backupStarted = true; await backupGate; }
    return update(table, id, fields);
  };
  feishu.createRecord = async (table, fields, token) => {
    if (table === 'diagnoses') { businessStarted = true; await businessGate; }
    return create(table, fields, token);
  };
  const service = new DiagnosisGatewayService({ configured: true, analyze: async () => ({ data: raw, raw: 'raw' }) }, feishu);
  const started = await service.start('analyze', { requestId: randomUUID(), input }, identity);
  for (let i = 0; i < 30 && !(backupStarted && businessStarted); i++) await new Promise(setImmediate);
  try {
    assert.equal(backupStarted && businessStarted, true);
    releaseBusiness(); await new Promise(setImmediate);
    assert.equal((await service.job(started.jobId, identity.userId)).status, 'running');
  } finally { releaseBackup(); releaseBusiness(); }
  const done = await waitFinished(service, started.jobId);
  assert.equal(done.status, 'completed'); assert.equal(done.result.stored, true);
  assert.equal(JSON.parse(feishu.records.get(started.jobId).fields['结果']).result.stored, true);
});
test('backup failure still finalizes a saved business record; two failed writes cannot report success', async () => {
  for (const failBusiness of [false, true]) {
    const feishu = new FakeFeishu(); feishu.failBusiness = failBusiness;
    const update = feishu.updateRecord.bind(feishu);
    feishu.updateRecord = async (table, id, fields) => {
      if (fields['进度'] === '正在保存照片与诊断') throw new Error('backup failure');
      return update(table, id, fields);
    };
    const service = new DiagnosisGatewayService({ configured: true, analyze: async () => ({ data: raw, raw: 'raw' }) }, feishu);
    const started = await service.start('analyze', { requestId: randomUUID(), input }, identity);
    const done = await waitFinished(service, started.jobId);
    assert.equal(done.status, failBusiness ? 'failed' : 'completed');
    if (!failBusiness) assert.equal(done.result.stored, true);
  }
});
test('interrupted tasks surface a terminal failure without repeating model calls', async () => {
  const feishu = new FakeFeishu(); let calls = 0;
  const record = await feishu.createRecord('tasks', { '提交用户': identity.userId, '模式': 'analyze',
    '状态': 'running', '开始时间': Date.now() - 20 * 60 * 1000 }, 'unused');
  const service = new DiagnosisGatewayService({ configured: true, analyze: () => { calls++; } }, feishu);
  const done = await service.job(record.recordId, identity.userId);
  assert.equal(done.status, 'failed'); assert.equal(calls, 0);
});
test('vision passes signed photo urls to the official capability and hides upstream errors', async () => {
  const { vision, calls } = visionStub(({ params }) => {
    assert.match(params.images[0], /^https:\/\/files\.example\/tmp\/diagnosis-/u);
    assert.ok(params.prompt.includes(input.studentName) || params.prompt.length > 100);
    return JSON.stringify(raw);
  });
  assert.equal((await vision.analyze('analyze', input)).data.overall, raw.overall);
  assert.equal(calls[0].id, 'student_homework_image_recognition_1');
  assert.equal(calls[0].action, 'imageUnderstanding');
  const failed = visionStub(() => { throw new Error('secret-key upstream'); }).vision;
  await assert.rejects(() => failed.analyze('analyze', input), (e) => !e.message.includes('secret-key') && e.getStatus() === 502);
});
test('request ids are scoped to the authenticated owner', () => {
  assert.notEqual(requestKey('a', 'same'), requestKey('b', 'same'));
  assert.match(requestKey('a', 'same'), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
});
test('concurrent submissions in one instance share creation and reject changed content', async () => {
  const feishu = new FakeFeishu(); let resolveLookup; let modelCalls = 0;
  feishu.findTask = () => new Promise(resolve => { resolveLookup = resolve; });
  const service = new DiagnosisGatewayService({ configured: true, analyze: async () => {
    modelCalls++; return { data: raw, raw: 'raw' };
  } }, feishu);
  const submission = { requestId: '00000000-0000-4000-a000-000000000005', input };
  const first = service.start('analyze', submission, identity);
  const second = service.start('analyze', submission, identity);
  await assert.rejects(() => service.start('analyze', { ...submission, input: { ...input, note: 'changed' } }, identity), e => e.getStatus() === 409);
  resolveLookup(null);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.jobId, b.jobId);
  await waitFinished(service, a.jobId);
  assert.equal(modelCalls, 1);
  assert.equal(feishu.calls.filter(call => call.table === 'tasks').length, 1);
});
test('Feishu search rich text is normalized without changing attachments or multi-selects', () => {
  const fields = normalizeFields({ owner: [{ type: 'text', text: 'user' }, { type: 'text', text: '-id' }],
    result: [{ type: 'text', text: '{"ok":true}' }], subject: ['数学'], photos: [{ file_token: 'token' }], empty: [] });
  assert.equal(fields.owner, 'user-id');
  assert.deepEqual(JSON.parse(fields.result), { ok: true });
  assert.deepEqual(fields.subject, ['数学']);
  assert.deepEqual(fields.photos, [{ file_token: 'token' }]);
  assert.deepEqual(fields.empty, []);
});

test('task reads coalesce, expire and do not cache failures', async () => {
  let now = 0; let reads = 0; let resolveRead;
  const cache = new TaskRecordCache(() => now);
  const record = { recordId: 'recCached', fields: { '状态': 'running' } };
  const read = () => { reads++; return new Promise(resolve => { resolveRead = resolve; }); };
  const a = cache.get(record.recordId, read); const b = cache.get(record.recordId, read);
  assert.equal(reads, 1); resolveRead(record); await Promise.all([a, b]);
  record.fields['状态'] = 'completed';
  assert.equal((await cache.get(record.recordId, read)).fields['状态'], 'running');
  now = 5001;
  const c = cache.get(record.recordId, read); assert.equal(reads, 2); resolveRead(record); await c;
  cache.invalidate(record.recordId);
  await assert.rejects(cache.get(record.recordId, async () => { throw new Error('offline'); }));
  assert.equal((await cache.get(record.recordId, async () => record)).fields['状态'], 'completed');
});

test('a read begun before a task write cannot poison the updated cache', async () => {
  const cache = new TaskRecordCache(); let resolveOld;
  const stale = cache.get('recCached', () => new Promise(resolve => { resolveOld = resolve; }));
  cache.invalidate('recCached');
  await cache.get('recCached', async () => ({ recordId: 'recCached', fields: { '状态': 'completed' } }));
  resolveOld({ recordId: 'recCached', fields: { '状态': 'running' } }); await stale;
  const latest = await cache.get('recCached', async () => { throw new Error('should be cached'); });
  assert.equal(latest.fields['状态'], 'completed');
});

test('photo cache expires and bounds retained originals', () => {
  let now = 0; const cache = new RecognitionPhotoCache(() => now);
  cache.set('one', input.photos); assert.deepEqual(cache.get('one'), input.photos);
  for (let i = 0; i < 33; i++) cache.set(String(i), input.photos);
  assert.equal(cache.get('one'), undefined);
  now = 600001; assert.equal(cache.get('32'), undefined);
});

test('recognition photos and evidence are reused warm and after a service restart', async () => {
  const feishu = new FakeFeishu(); const calls = [];
  const vision = { configured: true, analyze: async (mode, photoInput, evidence) => {
    calls.push({ mode, input: photoInput, evidence }); return { data: raw, raw: JSON.stringify(raw) };
  } };
  const service = new DiagnosisGatewayService(vision, feishu);
  const source = await service.start('extract-wrong', { requestId: randomUUID(), input }, identity);
  const recognized = await waitFinished(service, source.jobId);
  assert.equal(recognized.reusable, true); assert.equal(feishu.uploads, 1);
  assert.doesNotMatch(JSON.stringify(recognized), /file-token|dataBase64|artifact/u);
  const submission = { requestId: randomUUID(), recognitionJobId: source.jobId,
    input: { ...input, photos: [], wrongItems: ['销售改选第2题'] } };
  const warm = await service.start('analyze', submission, identity);
  assert.equal((await waitFinished(service, warm.jobId)).result.stored, true);
  assert.equal(feishu.uploads, 1); assert.equal(feishu.downloads, 0);
  assert.deepEqual(calls[1].input.photos, input.photos);
  assert.deepEqual(calls[1].input.wrongItems, ['销售改选第2题']);
  assert.deepEqual(calls[1].evidence.wrongItems, recognized.result.wrongItems);
  const restarted = new DiagnosisGatewayService(vision, feishu);
  const cold = await restarted.start('analyze', { ...submission, requestId: randomUUID() }, identity);
  const completed = await waitFinished(restarted, cold.jobId);
  assert.equal(completed.result.stored, true);
  assert.equal(feishu.uploads, 1); assert.equal(feishu.downloads, 1);
  assert.equal(typeof completed.timings.modelMs, 'number');
  assert.equal((await restarted.start('analyze', { ...submission, requestId: submission.requestId }, identity)).jobId, warm.jobId);
});

test('source reference rejects other owners, changed context and ambiguous photo payloads', async () => {
  const feishu = new FakeFeishu(); let modelCalls = 0;
  const service = new DiagnosisGatewayService({ configured: true, analyze: async () => {
    modelCalls++; return { data: raw, raw: 'raw' };
  } }, feishu);
  const source = await service.start('extract-wrong', { requestId: randomUUID(), input }, identity);
  await waitFinished(service, source.jobId);
  const submission = { requestId: randomUUID(), recognitionJobId: source.jobId, input: { ...input, photos: [] } };
  const other = { userId: 'other', userName: 'other' };
  const denied = await service.start('analyze', submission, other);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await service.job(denied.jobId, other.userId)).status, 'failed');
  await assert.rejects(service.job(source.jobId, other.userId), e => e.getStatus() === 404);
  const changed = await service.start('analyze', { ...submission, requestId: randomUUID(),
    input: { ...submission.input, studentName: '另一个学生' } }, identity);
  assert.equal((await waitFinished(service, changed.jobId)).status, 'failed');
  assert.equal(modelCalls, 1); assert.equal(feishu.downloads, 0);
  await assert.rejects(service.start('analyze', { ...submission, input }, identity), e => e.getStatus() === 400);
  await assert.rejects(service.start('grade', submission, identity), e => e.getStatus() === 400);
});

test('attachment failure keeps recognition usable and legacy full-photo analysis works', async () => {
  const feishu = new FakeFeishu(); feishu.uploadPhoto = async () => { throw new Error('upload failure'); };
  const service = new DiagnosisGatewayService({ configured: true, analyze: async () => ({ data: raw, raw: 'raw' }) }, feishu);
  const source = await service.start('extract-wrong', { requestId: randomUUID(), input }, identity);
  const recognized = await waitFinished(service, source.jobId);
  assert.equal(recognized.status, 'completed'); assert.equal(recognized.reusable, false);
  assert.ok(recognized.result.wrongItems.length);
  feishu.uploadPhoto = async () => 'file-token';
  const analysis = await service.start('analyze', { requestId: randomUUID(), input }, identity);
  assert.equal((await waitFinished(service, analysis.jobId)).result.stored, true);
});

test('timing telemetry is scoped, bounded and contains only fixed metrics', async () => {
  const feishu = new FakeFeishu(); const service = new DiagnosisGatewayService({}, feishu);
  const record = await feishu.createRecord('tasks', { '提交用户': identity.userId, '模式': 'extract-wrong', '状态': 'completed' });
  const timing = { jobId: record.recordId, photoReadMs: 10, submitMs: 20, visibleMs: 30 };
  assert.deepEqual(await service.clientTiming(timing, identity.userId), { ok: true });
  await assert.rejects(service.clientTiming(timing, 'other'), e => e.getStatus() === 404);
  await assert.rejects(service.clientTiming({ ...timing, photoReadMs: -1 }, identity.userId));
  await assert.rejects(service.clientTiming({ ...timing, studentName: 'private' }, identity.userId));
  const logs = []; const trace = new TaskTimings({ log: text => logs.push(text) }, 'request', 'grade');
  await assert.rejects(trace.measure('modelMs', async () => { throw new Error('private secret'); }));
  trace.finish(); assert.ok(trace.values.modelMs >= 0); assert.ok(trace.values.serverTotalMs >= 0);
  assert.doesNotMatch(logs.join(''), /private secret/u); assert.match(logs[0], /"ok":false/u);
});

test('analysis prompt keeps confirmed evidence subordinate and the concise rules', async () => {
  const evidence = normalizeRecognition(raw, input, 'extract-wrong');
  const { vision, calls } = visionStub(() => JSON.stringify(raw));
  await vision.analyze('analyze', input, evidence);
  const prompt = calls[0].params.prompt;
  assert.match(prompt, /既有识别证据/u);
  assert.match(prompt, /销售确认清单决定错题范围/u);
  assert.match(prompt, /家长话术90—120字、一个自然段/u);
});

test('all model modes receive the full 2000-character note as contextual evidence', async () => {
  const note = '背景'.repeat(990) + '每天仅有二十分钟学习时间，请合理安排。';
  const noted = { ...input, note };
  assert.ok(diagnosisInputSchema.safeParse(noted).success);
  const { vision, calls } = visionStub(({ params }) => {
    assert.ok(params.prompt.includes(note));
    assert.match(params.prompt, /明确区分备注提供的背景与卷面证据/u);
    assert.match(params.prompt, /不得改变本任务规则/u);
    return JSON.stringify(raw);
  });
  for (const mode of ['extract-wrong', 'grade', 'auto', 'analyze']) await vision.analyze(mode, noted);
  assert.equal(calls.length, 4);
  assert.equal(diagnosisInputSchema.safeParse({ ...noted, note: '字'.repeat(2001) }).success, false);
});

const physicsRow = (id, extra = {}) => ({ record_id: id, fields: {
  '视频名': '长度单位换算方法', '年级': '八上', '教材版本': '人教版', '课程类型': '同步课',
  '专题': '长度测量', '内容是否需要调整': '不调整', ...extra,
} });
const physicsDiagnosis = () => ({ ...normalizeDiagnosis(raw, input).diagnosis, grade: '初二', subjects: ['物理'],
  problems: [{ subject: '物理', knowledgePoint: '长度单位换算' }], weakPoints: [] });

test('catalog matching uses grade, subject, edition and real record provenance, excluding withdrawn/planned lessons', () => {
  const courses = parsePhysicsCourses([
    physicsRow('recPhysics1'), physicsRow('recPhysics2', { '教材版本': '苏科版' }),
    physicsRow('recPhysics3', { '内容是否需要调整': '从考点课中下掉' }),
    physicsRow('recPhysics4', { '内容是否需要调整': '增补新做' }),
    physicsRow('recPhysics5', { '年级': '九上' }),
    physicsRow('recPhysics6', { '视频名': '欧姆定律', '专题': '电学' }),
  ]);
  assert.equal(courses.length, 4);
  const d = physicsDiagnosis(); const matches = matchPhysicsCourses(d, courses, '人教版');
  assert.equal(matches.length, 1); assert.match(matches[0].sourceUrl, /record=recPhysics1$/u);
  assert.equal(matches[0].knowledgePoint, '长度单位换算');
  const detailed = { ...d, problems: [{ subject: '物理', knowledgePoint: '长度单位换算：米→厘米（×100）' }] };
  assert.match(matchPhysicsCourses(detailed, courses, '人教版')[0].sourceUrl, /record=recPhysics1$/u);
  assert.deepEqual(matchPhysicsCourses({ ...d, grade: '高二' }, courses), []);
  assert.deepEqual(matchPhysicsCourses({ ...d, subjects: ['数学'], problems: [{ subject: '数学', knowledgePoint: '长度单位换算' }] }, courses), []);
  assert.deepEqual(matchPhysicsCourses({ ...d, problems: [{ subject: '物理', knowledgePoint: '浮力' }] }, courses), []);
  assert.equal(matchPhysicsCourses(d, courses).length, 1);
});

test('catalog cache follows pagination, coalesces readers, expires and never keeps a partial result', async () => {
  let calls = 0; let now = 0; let fail = false;
  const catalog = new PhysicsCourseCatalog({ request: async (method, path, body, params) => {
    calls++; assert.equal(method, 'GET'); assert.match(path, /YdJSbLkOsak2BXsEqUfcMfIunIg/u);
    if (!params.page_token) return { items: [physicsRow('recPhysics1')], has_more: true, page_token: 'next' };
    if (fail) throw new Error('no permission');
    return { items: [physicsRow('recPhysics2')], has_more: false };
  } }, () => now);
  const [a, b] = await Promise.all([catalog.read(), catalog.read()]);
  assert.equal(a.length, 2); assert.deepEqual(a, b); assert.equal(calls, 2);
  await catalog.read(); assert.equal(calls, 2);
  now = 600001; fail = true; await assert.rejects(catalog.read());
  fail = false; assert.equal((await catalog.read()).length, 2); assert.equal(calls, 6);
});

test('catalog matches survive export validation and business storage; unsafe URLs are rejected', () => {
  const { diagnosis } = normalizeDiagnosis(raw, input);
  diagnosis.courseMatches = matchPhysicsCourses(physicsDiagnosis(), parsePhysicsCourses([physicsRow('recPhysics1')]));
  const parsed = reportInputSchema.parse({ studentName: input.studentName, diagnosis });
  const html = renderReport(parsed.diagnosis, input.studentName, identity.userName);
  assert.match(html, /长度单位换算方法/u); assert.match(html, /record=recPhysics1/u);
  assert.match(recordFields(diagnosis, input, identity, '')['洋葱课程推荐'], /record=recPhysics1/u);
  diagnosis.courseMatches[0].sourceUrl = 'javascript:alert(1)';
  assert.equal(reportInputSchema.safeParse({ studentName: input.studentName, diagnosis }).success, false);
});

test('physics catalog outage keeps the diagnosis and surfaces an explicit warning', async () => {
  const feishu = new FakeFeishu(); feishu.request = async () => { throw new Error('private auth details'); };
  const vision = { configured: true, analyze: async () => ({ data: { ...raw, grade: '初二', subjects: ['物理'] }, raw: '{}' }) };
  const service = new DiagnosisGatewayService(vision, feishu);
  const job = await service.start('analyze', { requestId: randomUUID(), input: { ...input, grade: '初二', subject: '物理' } }, identity);
  const done = await waitFinished(service, job.jobId);
  assert.equal(done.status, 'completed'); assert.equal(done.result.stored, true);
  assert.ok(done.result.warnings.some(warning => warning.includes('物理课程目录读取失败')));
  assert.doesNotMatch(JSON.stringify(done), /private auth details/u);
});

test('initial recognition keeps bounded, confident visual knowledge points and skips unreadable photos', () => {
  const points = [
    { subject: '物理', name: '长度单位换算', keywords: ['单位换算', '米'], confidence: '高' },
    { subject: '物理', name: '速度', keywords: ['速度'], confidence: '低' },
    { subject: 'invented', name: '主题', confidence: '高' },
  ];
  const result = normalizeRecognition({ ...raw, knowledge_points: points }, input, 'extract-wrong');
  assert.deepEqual(result.knowledgePoints, [{ subject: '物理', name: '长度单位换算', keywords: ['单位换算'] }]);
  assert.deepEqual(normalizeRecognition({ ...raw, knowledge_points: points,
    photo_quality: { assessment: '无法辨认' } }, input, 'extract-wrong').knowledgePoints, []);
});

test('initial keyword matching ranks all points globally and returns only the closest two distinct lessons', () => {
  const courses = parsePhysicsCourses([
    physicsRow('recBroad', { '视频名': '长度单位换算方法' }),
    physicsRow('recExactLength', { '视频名': '长度单位换算' }),
    physicsRow('recSameVideo', { '视频名': '长度单位换算', '课程类型': '新中考' }),
    physicsRow('recExactSpeed', { '视频名': '速度定义', '专题': '速度定义' }),
    physicsRow('recOtherEdition', { '视频名': '速度定义', '教材版本': '苏科版' }),
  ]);
  const points = [{ subject: '物理', name: '长度单位换算', keywords: ['长度'] },
    { subject: '物理', name: '速度定义', keywords: ['速度'] }];
  const matches = matchPhysicsKnowledge('初二', points, courses, '人教版');
  assert.deepEqual(matches.map(match => match.title), ['长度单位换算', '速度定义']);
  assert.equal(matches.length, 2);
  assert.deepEqual(matchPhysicsKnowledge('初二', [{ subject: '物理', name: '浮力', keywords: ['浮力'] }], courses), []);
});

test('recognition returns course matches after one model call and a restarted analysis reuses them without rereading catalog', async () => {
  const feishu = new FakeFeishu(); let reads = 0; const modes = []; let resolveRecognition;
  feishu.request = async () => { reads++; return { items: [physicsRow('recInitialCourse')], has_more: false }; };
  const initial = { ...raw, grade: '初二', subjects: ['物理'], knowledge_points: [
    { subject: '物理', name: '长度单位换算', keywords: ['单位换算'], confidence: '高' },
  ] };
  const vision = { configured: true, analyze: async (mode, nextInput, evidence) => {
    modes.push(mode);
    if (mode === 'extract-wrong') return new Promise(resolve => { resolveRecognition = resolve; });
    assert.equal(evidence.courseMatches[0].title, '长度单位换算方法');
    return { data: initial, raw: '{}' };
  } };
  const physicsInput = { ...input, grade: '初二', subject: '物理', note: '人教版' };
  const service = new DiagnosisGatewayService(vision, feishu);
  const source = await service.start('extract-wrong', { requestId: randomUUID(), input: physicsInput }, identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1, 'Catalog should load concurrently with the initial model call');
  resolveRecognition({ data: initial, raw: '{}' });
  const recognized = await waitFinished(service, source.jobId);
  assert.deepEqual(modes, ['extract-wrong']);
  assert.equal(recognized.result.courseMatches[0].title, '长度单位换算方法');
  assert.equal(recognized.result.diagnosis, undefined);
  assert.equal(recognized.reusable, true);
  const restarted = new DiagnosisGatewayService(vision, feishu);
  const next = await restarted.start('analyze', { requestId: randomUUID(), recognitionJobId: source.jobId,
    input: { ...physicsInput, photos: [] } }, identity);
  const done = await waitFinished(restarted, next.jobId);
  assert.deepEqual(done.result.diagnosis.courseMatches, recognized.result.courseMatches);
  assert.equal(reads, 1); assert.equal(feishu.uploads, 1);
});

test('initial recognition preserves visual findings when the course directory is unavailable', async () => {
  const feishu = new FakeFeishu(); feishu.request = async () => { throw new Error('private upstream'); };
  const vision = { configured: true, analyze: async () => ({ data: { ...raw, subjects: ['物理'], knowledge_points: [
    { subject: '物理', name: '长度单位换算', keywords: ['单位换算'], confidence: '高' },
  ] }, raw: '{}' }) };
  const service = new DiagnosisGatewayService(vision, feishu);
  const started = await service.start('extract-wrong', { requestId: randomUUID(), input: { ...input, subject: '物理' } }, identity);
  const done = await waitFinished(service, started.jobId);
  assert.equal(done.status, 'completed'); assert.ok(done.result.wrongItems.length);
  assert.deepEqual(done.result.courseMatches, []); assert.match(done.result.courseMatchNote, /图片识别结果已保留/u);
});

test('new senior subjects discovered after preload persist through recognition, analysis and report export', async () => {
  process.env.BITABLE_APP_TOKEN = 'baseTest'; process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID = 'tblSenior';
  const feishu = new FakeFeishu(); let modelCalls = 0; let seniorReads = 0;
  feishu.request = async (method, path) => {
    if (!path.includes('tblSenior')) return { items: [] };
    seniorReads++;
    return { items: [{ record_id: 'recChemistry', fields: { '课程名称': '化学平衡与可逆反应',
      '知识点名称': '化学平衡与可逆反应', '适用年级': '高一、高二、高三', '学科': '化学', '审核状态': '待核实' } }] };
  };
  const initial = { ...raw, grade: '高三', subjects: ['化学'], knowledge_points: [
    { subject: '化学', name: '化学平衡与可逆反应', keywords: [], confidence: '高' }] };
  const vision = { configured: true, analyze: async () => { modelCalls++; return { data: initial, raw: '{}' }; } };
  // The declared subject preloads math, while the model discovers chemistry.
  const sourceInput = { ...input, grade: '高三' };
  try {
    const service = new DiagnosisGatewayService(vision, feishu);
    const started = await service.start('extract-wrong', { requestId: randomUUID(), input: sourceInput }, identity);
    const recognized = await waitFinished(service, started.jobId);
    assert.equal(recognized.result.courseMatches[0].subject, '化学');
    assert.equal(modelCalls, 1); assert.equal(seniorReads, 1);
    const restarted = new DiagnosisGatewayService(vision, feishu);
    const analysis = await restarted.start('analyze', { requestId: randomUUID(), recognitionJobId: started.jobId,
      input: { ...sourceInput, photos: [] } }, identity);
    const done = await waitFinished(restarted, analysis.jobId);
    assert.equal(done.status, 'completed'); assert.equal(modelCalls, 2); assert.equal(seniorReads, 1);
    const validated = reportInputSchema.parse({ studentName: input.studentName, diagnosis: done.result.diagnosis });
    assert.match(validated.diagnosis.courseMatches[0].reviewNote, /待核实/u);
    assert.match(renderReport(validated.diagnosis, input.studentName, identity.userName), /原目录待核实/u);
  } finally { delete process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID; }
});

test('math recognition preloads its catalog, persists matches, and analysis reuses them after restart', async () => {
  process.env.BITABLE_APP_TOKEN = 'baseMath'; process.env.BITABLE_MATH_TABLE_ID = 'tblMath';
  const feishu = new FakeFeishu(); let reads = 0; let calls = 0; let release;
  feishu.request = async (method, path) => {
    reads++; assert.match(path, /tblMath/u);
    return { items: [{ record_id: 'recMathCourse', fields: { '课程名称': '第13讲 因式分解', '适用年级': '初三',
      '学科': '数学', '教材版本': '通用版', '课程类型': '新中考一轮', '审核状态': '已核对', '检索关键词': '因式分解' } }], has_more: false };
  };
  const initial = { ...raw, grade: '初三', knowledge_points: [{ subject: '数学', name: '因式分解', keywords: ['公式法'], confidence: '高' }] };
  const vision = { configured: true, analyze: async (mode, next, evidence) => {
    calls++;
    if (mode === 'extract-wrong') return new Promise(resolve => { release = resolve; });
    assert.equal(evidence.courseMatches[0].title, '第13讲 因式分解'); return { data: initial, raw: '{}' };
  } };
  const mathInput = { ...input, grade: '初三' }; const service = new DiagnosisGatewayService(vision, feishu);
  const started = await service.start('extract-wrong', { requestId: randomUUID(), input: mathInput }, identity);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1);
  release({ data: initial, raw: '{}' }); const recognized = await waitFinished(service, started.jobId);
  assert.equal(recognized.result.courseMatches[0].title, '第13讲 因式分解'); assert.equal(calls, 1);
  const restarted = new DiagnosisGatewayService(vision, feishu);
  const analysis = await restarted.start('analyze', { requestId: randomUUID(), recognitionJobId: started.jobId,
    input: { ...mathInput, photos: [] } }, identity);
  const done = await waitFinished(restarted, analysis.jobId);
  assert.equal(done.status, 'completed'); assert.equal(reads, 1); assert.equal(calls, 2); assert.equal(feishu.uploads, 1);
  assert.deepEqual(done.result.diagnosis.courseMatches, recognized.result.courseMatches);
  assert.ok(reportInputSchema.safeParse({ studentName: input.studentName, diagnosis: done.result.diagnosis }).success);
  assert.match(renderReport(done.result.diagnosis, input.studentName, identity.userName), /第13讲 因式分解/u);
  delete process.env.BITABLE_MATH_TABLE_ID;
});

test('model recognition requests keyword JSON and later analysis receives verified courses even when long evidence is omitted', async () => {
  const courseMatches = matchPhysicsCourses(physicsDiagnosis(), parsePhysicsCourses([physicsRow('recVerifiedCourse')]));
  const { vision, calls } = visionStub(({ index }) => {
    const prompt = calls[index].params.prompt;
    if (index === 0) {
      assert.match(prompt, /knowledge_points/u);
      assert.match(prompt, /keywords/u);
      assert.match(prompt, /不生成诊断、课程或家长话术/u);
    } else {
      assert.ok(prompt.includes(courseMatches[0].title));
      assert.doesNotMatch(prompt, /recVerifiedCourse|sourceUrl/u);
      assert.doesNotMatch(prompt, /很长的证据/u);
    }
    return JSON.stringify(raw);
  });
  await vision.analyze('extract-wrong', input);
  await vision.analyze('analyze', input, { ...normalizeRecognition(raw, input, 'extract-wrong'),
    courseMatches, scopeNote: '很长的证据'.repeat(6000) });
});

test('only report generation receives the product library and legacy selling instructions are replaced', async () => {
  const { vision, calls } = visionStub(({ index }) => {
    const prompt = calls[index].params.prompt;
    if (index === 3) {
      assert.match(prompt, /selected_capability_ids/u);
      assert.match(prompt, /一次全对直接推荐培优/u);
      assert.doesNotMatch(prompt, /核心产品卖点|下危机|成绩稳稳往上走|轻 CTA|5~10 分钟把概念讲透/u);
      assert.ok(!prompt.includes(PRODUCT_SOURCE));
      assert.doesNotMatch(prompt, /sourceUrl|verifiedAt|recordId/u);
      assert.match(prompt, /CAP-COURSE-01/u);
      assert.match(prompt, /同步概念课/u);
      assert.doesNotMatch(prompt, /CAP-PRIMARY-01|CAP-JUNIOR-01/u);
    } else {
      assert.doesNotMatch(prompt, /productLibrary|CAP-COURSE/u);
    }
    return JSON.stringify(raw);
  });
  for (const mode of ['extract-wrong', 'grade', 'auto', 'analyze']) await vision.analyze(mode, input, undefined, undefined, productCapabilities);
  assert.equal(calls.length, 4);
});

test('report pipeline reads editable products and passes the same snapshot to model and validation', async () => {
  const feishu = new FakeFeishu();
  feishu.mapping = async () => { assert.fail('Obsolete product mapping must not be read'); };
  const edited = structuredClone(productRows);
  edited.find(r => r.fields['产品能力ID'] === 'CAP-COURSE-01').fields['产品名称'] = '人工修改的概念课';
  feishu.listRecords = async table => ({ items: table === productTableId() ? edited : [], pageToken: '' });
  const vision = { configured: true, analyze: async (mode, input, recognition, key, products) => {
    assert.equal(products.find(c => c.id === 'CAP-COURSE-01').name, '人工修改的概念课');
    return { data: raw, raw: JSON.stringify(raw) };
  } };
  const service = new DiagnosisGatewayService(vision, feishu);
  const started = await service.start('analyze', { requestId: randomUUID(), input }, identity);
  const completed = await waitFinished(service, started.jobId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.stored, true);
  assert.match(completed.result.diagnosis.onionRecommendation, /人工修改的概念课/u);
  assert.equal(typeof completed.timings.mappingReadMs, 'number');
});
