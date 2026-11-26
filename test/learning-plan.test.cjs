require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { of, throwError } = require('rxjs');
const { LearningPlanService } = require('../server/modules/diagnosis-gateway/learning-plan.service');
const { LearningPlanController } = require('../server/modules/diagnosis-gateway/learning-plan.controller');
const { LearningReportSource, reportAuthorization } = require('../server/modules/diagnosis-gateway/learning-report-source');
const { learningInputSchema, evidenceSchema, generatedPlanSchema, phoneTitles } = require('../server/modules/diagnosis-gateway/learning-plan.validation');
const { LEARNING_EVIDENCE_PROMPT, LEARNING_PLAN_PROMPT } = require('../server/modules/diagnosis-gateway/learning-plan.prompts');
const { learningBoardHtml, learningPlanText } = require('../shared/learning-plan-format');
const { productRows, productTableId } = require('./product-fixtures.cjs');
const input = () => ({ studentName: '合成验证', grade: '初二', subject: '数学', attribute: '同步巩固与分层提升', note: '',
  watchText: '9月10日观看三角形的边与角。观看时间21:36:17。', reportText: '累计练习10题，正确6题；知识点掌握情况待确认。', watchPhotos: [], reportPhotos: [] });
const evidence = { facts: ['观看记录：9月10日观看三角形的边与角'], uncertainties: ['观看不等于掌握'],
  knowledgePoints: [{ subject: '数学', name: '三角形的边与角', keywords: [] }] };
const generated = () => ({ parentMessage: '孩子愿意学习，先用独立练习确认掌握情况。', summary: '观看记录不能证明全部掌握。',
  diagnosisBoard: { importance: '三角形关系支撑后续几何条件判断。' },
  phoneSteps: phoneTitles.map(title => ({ text: title + '沟通内容' })), professionalBasis: ['依据观看记录，尚无独立作答证据。'],
  plans: [1, 2, 3].map(() => ({ goal: '验证三角形知识', actions: ['独立完成3道同类题'], acceptance: '说出第一步理由' })),
  allocationNote: '基础不稳先补同步，再过渡到40/60。', solutions: [{ knowledgePoint: '三角形的边与角', capabilityId: 'CAP-COURSE-01', evidenceIndexes: [0],
    recommendation: '先用对应概念课理解三角形，再结合练习复盘。' }] });
function setup() {
  process.env.BITABLE_TASK_TABLE_ID = 'tblTasks'; process.env.BITABLE_APP_TOKEN = 'baseTest';
  process.env.BITABLE_MATH_TABLE_ID = 'tblMath'; delete process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID;
  const rows = new Map(); const calls = []; let gen = generated();
  const feishu = { configured: true,
    listRecords: async table => ({ items: table === productTableId() ? productRows : [], pageToken: '' }),
    findTask: async key => [...rows.values()].find(r => r.fields['请求编号'] === key) || null,
    createRecord: async (table, fields) => { const r = { recordId: 'recTest' + rows.size, fields }; rows.set(r.recordId, r); return structuredClone(r); },
    updateRecord: async (table, id, fields) => { Object.assign(rows.get(id).fields, fields); },
    getRecord: async (table, id) => structuredClone(rows.get(id)),
    request: async () => ({ items: [{ record_id: 'recCourse', fields: { '学科': '数学', '适用年级': '初二',
      '课程名称': '三角形的边与角', '审核状态': '已核对' } }] }),
  };
  const vision = { configured: true, learning: async (system, context, photos, phase) => {
    calls.push({ system, context, photos, phase }); return phase === 'evidence' ? structuredClone(evidence) : structuredClone(gen);
  } };
  const service = new LearningPlanService(feishu, vision);
  return { service, rows, calls, feishu, vision, setGenerated: value => { gen = value; } };
}
async function done(env, id) {
  for (let i = 0; i < 50 && env.rows.get(id).fields['状态'] === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  return env.service.job(id, 'owner');
}
test('planning preloads courses during evidence extraction and only generates once both are available', async () => {
  const env = setup(); let catalogStarted = false; let releaseCatalog; let releaseEvidence;
  const originalRead = env.feishu.request;
  env.feishu.request = async (...args) => {
    catalogStarted = true;
    await new Promise(resolve => { releaseCatalog = resolve; });
    return originalRead(...args);
  };
  const originalLearning = env.vision.learning;
  env.vision.learning = async (...args) => {
    if (args[3] === 'evidence') await new Promise(resolve => { releaseEvidence = resolve; });
    return originalLearning(...args);
  };
  const job = await env.service.start({ requestId: randomUUID(), input: input() }, { userId: 'owner' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(catalogStarted, true); assert.equal(env.calls.length, 0);
  releaseEvidence(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.calls.length, 1); assert.equal(env.rows.get(job.jobId).fields['状态'], 'running');
  releaseCatalog(); assert.equal((await done(env, job.jobId)).status, 'completed');
  assert.equal(env.calls.length, 2); assert.equal(env.calls[1].context.matchedCourses.length, 1);
});
test('planning validates required sources, actual grade, screenshot bytes and token exclusion', () => {
  assert.ok(learningInputSchema.safeParse(input()).success);
  for (const change of [{ studentName: '' }, { grade: '八年级课程' }, { watchText: '' }, { reportText: '' },
    { note: 'Bearer secret' }, { reportText: 'https://example.com?token=secret' },
    { watchPhotos: [{ name: 'fake.png', mimeType: 'image/png', dataBase64: 'AAAA' }] }]) {
    assert.equal(learningInputSchema.safeParse({ ...input(), ...change }).success, false);
  }
});
test('extra model keywords are bounded and internal field names stay out of report prose', () => {
  const parsed = evidenceSchema.parse({ ...evidence, knowledgePoints: [{ ...evidence.knowledgePoints[0],
    keywords: ['三角形', '边角', '内角和', '三边关系'] }] });
  assert.deepEqual(parsed.knowledgePoints[0].keywords, ['三角形', '边角', '内角和']);
  assert.throws(() => evidenceSchema.parse({ ...evidence, knowledgePoints: [{ ...evidence.knowledgePoints[0], keywords: [123] }] }));
  const report = generatedPlanSchema.parse({ ...generated(), summary: '观看matchedCourses中的课程，结合productLibrary。' });
  assert.equal(report.summary, '观看已核对课程目录中的课程，结合洋葱产品能力库。');
});
test('report URL accepts only the known origin and sends no caller-selected host, path or user ID', async () => {
  const url = 'https://xxgj.yangcongxing.com/onion-learning/study-report/?token=Bearer%20a.b.c&userId=another';
  assert.equal(reportAuthorization(url + '，'), 'Bearer a.b.c');
  for (const bad of [url.replace('xxgj.yangcongxing.com', '127.0.0.1'), url.replace('https:', 'http:'),
    url.replace('xxgj.yangcongxing.com', 'xxgj.yangcongxing.com.evil.com'), url + '&token=Bearer%20d.e.f', url + '#private',
    url.replace('/study-report/', '/other/')]) assert.throws(() => reportAuthorization(bad));
  let call;
  const source = new LearningReportSource({ get: (path, options) => {
    call = { path, options }; return of({ data: { data: { userAccumulateData: { accumulateDurations: 1000,
      accumulateAnswerProblem: 10, privateId: 'do-not-return' }, mobile: 'do-not-return' } } });
  } });
  const result = await source.read(url);
  assert.equal(call.path, 'https://7to12.yangcong345.com/backend/study-statistics/parent/userBasic');
  assert.equal(call.options.headers.Authorization, 'Bearer a.b.c'); assert.equal(call.options.maxRedirects, 0);
  assert.doesNotMatch(JSON.stringify(result), /a\.b\.c|do-not-return|another/u);
  assert.match(result.text, /1000/u);
  const broken = new LearningReportSource({ get: () => throwError(() => new Error('secret token')) });
  await assert.rejects(broken.read(url), error => !error.message.includes('secret token'));
});
test('one durable planning report serves both views; ownership, retries, context and courses are preserved', async () => {
  const env = setup(); const requestId = randomUUID();
  const [a, b] = await Promise.all([env.service.start({ requestId, input: input() }, { userId: 'owner' }),
    env.service.start({ requestId, input: input() }, { userId: 'owner' })]);
  assert.equal(a.jobId, b.jobId); assert.equal(env.rows.size, 1);
  const job = await done(env, a.jobId); assert.equal(job.status, 'completed');
  assert.equal(env.calls.length, 2); assert.equal(env.calls[1].photos.length, 0);
  assert.deepEqual(env.calls[1].context.validEvidenceIndexes, [0]);
  assert.equal(env.calls[1].context.matchedCourses[0].title, '三角形的边与角');
  assert.ok(env.calls[1].context.productLibrary.length > 0);
  assert.deepEqual(job.report.phoneSteps.map(s => s.title), phoneTitles);
  assert.equal(job.report.solutions[0].name, '同步概念课');
  assert.equal(job.report.professionalBasis, undefined);
  assert.equal(job.report.diagnosisBoard.focus, job.report.summary);
  assert.equal(job.report.diagnosisBoard.courseApproach, '');
  assert.equal(job.report.solutions[0].reason, '');
  assert.equal(job.report.solutions[0].method, generated().solutions[0].recommendation);
  assert.doesNotMatch(JSON.stringify(env.calls[1].context.productLibrary), /sourceUrl|recordId|verifiedAt|materialIds/u);
  await assert.rejects(env.service.job(a.jobId, 'someone-else'));
  await assert.rejects(env.service.start({ requestId, input: { ...input(), note: 'changed' } }, { userId: 'owner' }));
  await env.service.find(requestId, 'owner'); await env.service.job(a.jobId, 'owner'); assert.equal(env.calls.length, 2);
  const html = learningBoardHtml(job.report); const text = learningPlanText(job.report);
  assert.ok(html.includes(job.report.parentMessage)); assert.ok(text.includes(job.report.summary));
  assert.ok(html.indexOf(job.report.parentMessage) < html.indexOf('目前需要关注'));
  assert.doesNotMatch(html + text, /未来7天|未来1个月|当前学期|40%|60%/u);
  assert.equal(job.report.reportVersion, 'product-recommendation-v2');
  assert.equal(job.report.plans, undefined); assert.ok(text.includes('推进下一步'));
  const escaped = learningBoardHtml({ ...job.report, studentName: '<script>evil()</script>' });
  assert.doesNotMatch(escaped, /<script>/u);
});
test('repeated valid products do not fail the report, but every repeated entry is still validated', async () => {
  const env = setup(); const report = generated();
  report.solutions.push({ ...report.solutions[0], knowledgePoint: '三角形内角和' });
  env.setGenerated(report);
  const job = await env.service.start({ requestId: randomUUID(), input: input() }, { userId: 'owner' });
  const result = await done(env, job.jobId);
  assert.equal(result.status, 'completed'); assert.equal(result.report.solutions.length, 1);
  const invalid = setup(); report.solutions[1].evidenceIndexes = [15]; invalid.setGenerated(report);
  const rejected = await invalid.service.start({ requestId: randomUUID(), input: input() }, { userId: 'owner' });
  assert.equal((await done(invalid, rejected.jobId)).status, 'failed');
});

test('invalid model products and truncated reports fail closed without saving a completed report', async () => {
  for (const invalid of [{ ...generated(), solutions: [{ ...generated().solutions[0], capabilityId: 'fake-product' }] },
    { ...generated(), solutions: [{ ...generated().solutions[0], capabilityId: 'CAP-AI-01' }] },
    { ...generated(), solutions: [{ ...generated().solutions[0], supportingCapabilityIds: ['CAP-COURSE-02'] }] },
    { ...generated(), phoneSteps: [] },
    { ...generated(), solutions: [{ ...generated().solutions[0], evidenceIndexes: [15] }] }]) {
    const env = setup(); env.setGenerated(invalid);
    const job = await env.service.start({ requestId: randomUUID(), input: input() }, { userId: 'owner' });
    assert.equal((await done(env, job.jobId)).status, 'failed');
  }
});
test('selling points support a paid course and remain visible in both report exports', async () => {
  const env = setup(); env.setGenerated({ ...generated(), solutions: [{ ...generated().solutions[0],
    supportingCapabilityIds: ['CAP-AI-02'] }] });
  const job = await env.service.start({ requestId: randomUUID(), input: { ...input(), note: '同类错题反复出错，需要错题复盘' } }, { userId: 'owner' });
  const completed = await done(env, job.jobId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.report.solutions[0].capabilityId, 'CAP-COURSE-01');
  assert.equal(completed.report.solutions[0].sellingPoints[0].name, 'AI 错题本');
  assert.match(learningBoardHtml(completed.report), /结合AI 错题本辅助巩固/u);
  assert.match(learningPlanText(completed.report), /结合AI 错题本辅助巩固/u);
});
test('planning materials are owner-scoped, independent of report generation and use saved evidence', async () => {
  const env = setup(); let reads = 0;
  const saved = { assets: process.env.BITABLE_MATERIAL_TABLE_ID, mappings: process.env.BITABLE_MATERIAL_MAPPING_TABLE_ID };
  process.env.BITABLE_MATERIAL_TABLE_ID = 'assets'; process.env.BITABLE_MATERIAL_MAPPING_TABLE_ID = 'mappings';
  let fail = false;
  env.feishu.listRecords = async table => {
    if (table === productTableId()) return { items: productRows, pageToken: '' };
    if (table === 'tblbIbCiWjza35RR') return { items: [], pageToken: '' };
    reads++; if (fail) throw new Error('material storage unavailable');
    const materialId = 'mat_00000000000000000001';
    return { items: [{ recordId: 'recMaterial1', fields: table === 'assets' ? {
      '素材ID': materialId, '规范名称': '验收中考数学长图', '年度': 2026, '考试': '中考', '学科': '数学',
      '来源链接': 'https://guanghe.feishu.cn/wiki/source', '原图附件': [{ file_token: 'approved-original' }], '审核状态': '已审核',
    } : { '关联素材ID': materialId, '标准知识点': '三角形的边与角', '标注原文': '三角形的边与角',
      '学科': '数学', '审核状态': '已审核' } }], pageToken: '' };
  };
  try {
    const started = await env.service.start({ requestId: randomUUID(), input: input() }, { userId: 'owner' });
    await assert.rejects(env.service.materialMatches(started.jobId, 'other'), e => e.getStatus() === 404);
    const job = await done(env, started.jobId); assert.equal(job.status, 'completed'); assert.equal(reads, 0);
    assert.equal((await env.service.materialMatches(job.jobId, 'owner')).status, 'ready');
    assert.equal(reads, 2); assert.equal(env.calls.length, 2);
    const restarted = new LearningPlanService(env.feishu, env.vision);
    fail = true;
    assert.equal((await restarted.materialMatches(job.jobId, 'owner')).status, 'unavailable');
    assert.equal((await restarted.job(job.jobId, 'owner')).status, 'completed');
    assert.equal(env.calls.length, 2);
    const running = new LearningPlanService({ getRecord: async () => ({ recordId: 'recRunning1',
      fields: { '提交用户': 'owner', '模式': 'learning-plan', '状态': 'running', '开始时间': Date.now() } }) }, env.vision);
    await assert.rejects(running.materialMatches('recRunning1', 'owner'), e => e.getStatus() === 400);
    const handler = LearningPlanController.prototype.materials;
    assert.ok(Reflect.getMetadata('authnpaas:needLogin', handler));
    assert.deepEqual(Reflect.getMetadata('authzpaas:roles', handler).roles, ['sales', 'admin']);
  } finally {
    for (const [key, value] of [['BITABLE_MATERIAL_TABLE_ID', saved.assets], ['BITABLE_MATERIAL_MAPPING_TABLE_ID', saved.mappings]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test('product matching and images reject another owner before any material reads', async () => {
  const env = setup(); let reads = 0;
  env.feishu.listRecords = async table => {
    if (table === productTableId()) return { items: productRows, pageToken: '' };
    reads++; return { items: [], pageToken: '' };
  };
  const started = await env.service.start({ requestId: randomUUID(), input: input() }, { userId: 'owner' });
  const job = await done(env, started.jobId);
  const preloadedReads = reads;
  await assert.rejects(env.service.productMatches(job.jobId, 'other'), e => e.getStatus() === 404);
  await assert.rejects(env.service.productImage(job.jobId, 'prod_course', 'other'), e => e.getStatus() === 404);
  assert.equal(reads, preloadedReads);
  assert.equal((await env.service.productMatches(job.jobId, 'owner')).status, 'empty');
  assert.equal(env.calls.length, 2);
});
test('senior planning uses the same directory matches and preserves review notes in both exports', async () => {
  const env = setup(); process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID = 'tblSenior';
  env.feishu.request = async () => ({ items: [{ record_id: 'recChemistry', fields: { '学科': '化学',
    '适用年级': '高一、高二、高三', '课程名称': '化学平衡与可逆反应', '课程类型': '同步课', '知识点名称': '可逆反应', '审核状态': '待核实' } }] });
  const phases = [];
  env.vision.learning = async (system, context, photos, phase) => {
    phases.push(phase);
    if (phase === 'evidence') return { ...evidence, knowledgePoints: [{ subject: '化学', name: '化学平衡与可逆反应', keywords: [] }] };
    assert.equal(context.matchedCourses[0].subject, '化学');
    assert.match(context.matchedCourses[0].reviewNote, /待核实/u);
    const result = generated(); result.solutions[0].knowledgePoint = '化学平衡与可逆反应'; return result;
  };
  try {
    const started = await env.service.start({ requestId: randomUUID(), input: { ...input(), grade: '高三', subject: '化学' } }, { userId: 'owner' });
    const job = await done(env, started.jobId);
    assert.equal(job.status, 'completed'); assert.deepEqual(phases, ['evidence', 'report']);
    assert.match(learningPlanText(job.report), /内容还需和老师确认/u);
    assert.match(learningBoardHtml(job.report), /内容还需和老师确认/u);
  } finally { delete process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID; }
});
test('product recommendations use evidence and replace fixed periods without weakening learning boundaries', () => {
  assert.match(LEARNING_EVIDENCE_PROMPT, /观看时间是时间戳/u);
  assert.match(LEARNING_EVIDENCE_PROMPT, /观看不等于/u);
  assert.match(LEARNING_PLAN_PROMPT, /基础不稳先同步打底/u);
  assert.match(LEARNING_PLAN_PROMPT, /matchedCourses/u);
});
