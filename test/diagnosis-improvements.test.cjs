require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { materialFingerprint, materialApproved } = require('../server/modules/diagnosis-gateway/material-approval');
const { reviewedMaterials } = require('../server/modules/diagnosis-gateway/reviewed-product-materials');
const { parseProductMaterial, matchProductMaterials } = require('../server/modules/diagnosis-gateway/product-materials');
const { eligibleCapabilities } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');
const { sharedProductCatalog } = require('../server/modules/diagnosis-gateway/product-capability-catalog');
const { CourseCatalogs } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
const { confirmedGrade } = require('../shared/diagnosis-scope');
const { learningPlanText, learningBoardHtml, learningReportMetrics } = require('../shared/learning-plan-format');
const { TaskRecordCache } = require('../server/modules/diagnosis-gateway/diagnosis-performance');
const { productRows, productCapabilities } = require('./product-fixtures.cjs');
const product = productCapabilities.find(p => p.id === 'CAP-COURSE-01');
const row = { recordId: 'recApprovalTest', fields: { '素材ID': 'prod_approvaltest', '素材名称': product.name + '介绍',
  '适用学段': ['初中'], '适用学科': ['数学'], '来源链接': 'https://guanghe.feishu.cn/wiki/source',
  '原图附件': [{ file_token: 'testfile' }], '内容摘要': '三角形三边关系' } };
const report = { studentName: '小明测试', grade: '初二', subjects: ['数学'], attribute: '基础修复',
  parentMessage: '家长专属话术', summary: '诊断总结', phoneSteps: [], professionalBasis: [], warnings: [], courses: [],
  createdAt: '2026-09-21', evidence: { facts: [], uncertainties: [], knowledgePoints: [], metrics: [] },
  solutions: [{ capabilityId: product.id, name: product.name, knowledgePoint: '三角形三边关系',
    method: '观看后验证', reason: '需要核实概念', acceptance: '解释三边关系', boundary: '核实权益' }] };
test('153-row snapshot excludes new records and invalidates changed scope, text, links and attachments', () => {
  assert.equal(Object.keys(reviewedMaterials).length, 153);
  assert.equal(materialApproved(row), false);
  reviewedMaterials[row.recordId] = materialFingerprint(row);
  try {
    assert.equal(materialApproved(row), true);
    for (const fields of [{ '素材名称': '改变' }, { '适用学科': ['语文'] }, { '内容摘要': '改变' },
      { '关联产品': ['recChanged'] }, { '原图附件': [{ file_token: 'changed' }] }]) {
      assert.equal(materialApproved({ ...row, fields: { ...row.fields, ...fields } }), false);
    }
    assert.equal(materialApproved({ ...row, fields: { ...row.fields, '审核状态': '待核实' } }), false);
  } finally { delete reviewedMaterials[row.recordId]; }
});
test('text-only matching returns all related posters and rejects generic, cross-stage and specific-grade posters', () => {
  const parse = (id, changes = {}) => parseProductMaterial({ recordId: id, fields: { ...row.fields,
    '素材ID': 'prod_' + id.toLowerCase(), '审核状态': '已核对', ...changes } }, productCapabilities);
  const one = parse('recOne'); const two = parse('recTwo');
  const titledSource = parse('recSourceTitle', { '来源链接': '[销售弹药库] 售前海报库（持续更新）' });
  assert.match(titledSource.sourceUrl, /record=recSourceTitle$/u);
  assert.equal(matchProductMaterials([one, two], report, productCapabilities).length, 2);
  for (const fields of [{ '素材名称': '课程介绍' }, { '适用学科': ['语文'] }, { '适用学段': ['高中'] },
    { '素材名称': '初三' + product.name }]) {
    assert.equal(matchProductMaterials([parse('recNo', fields)], report, productCapabilities).length, 0);
  }
  const narrow = parse('recNarrow', { '素材名称': '初二' + product.name });
  assert.equal(matchProductMaterials([narrow], { ...report, grade: '初中' }, productCapabilities).length, 0);
  assert.equal(matchProductMaterials([one], { ...report, grade: '初中' }, productCapabilities).length, 1);
  const mathProduct = { ...product, subjects: ['数学'] };
  const physics = parse('recPhysics', { '适用学科': ['物理'] });
  assert.equal(matchProductMaterials([physics], { ...report, subjects: ['数学', '物理'] }, [mathProduct]).length, 0);
});
test('stage-only product eligibility never implies the final year and evidence cannot move students across stages', () => {
  const senior = { ...product, stages: ['高中'], grades: ['高三'] };
  assert.equal(eligibleCapabilities('高中', ['数学'], [senior]).length, 0);
  assert.equal(eligibleCapabilities('高三', ['数学'], [senior]).length, 1);
  assert.equal(confirmedGrade('初中', '高三'), '初中');
  assert.equal(confirmedGrade('初中', '初二'), '初二');
  assert.equal(confirmedGrade('初一', '初二'), '初一');
});
test('stage directory ranking prefers exact knowledge point over an earlier-grade partial title', () => {
  const catalog = new CourseCatalogs({ request: async () => ({}) });
  const course = (grade, title, id) => ({ grade, title, sourceUrl: id, terms: [title], courseType: '培优', edition: '' });
  const result = catalog.match('初中', [{ subject: '数学', name: '勾股定理', keywords: [] }],
    { physics: [], math: [course('初一', '勾股定理拓展', 'a'), course('初二', '勾股定理', 'b')], failed: [] });
  assert.equal(result.matches[0].title, '勾股定理');
  assert.match(result.matches[0].reviewNote, /年级.*待核实/u);
});
test('export prioritizes original core numbers, preserves zero and excludes unchecked prose and pictures', () => {
  const metric = (label, value, unit) => ({ label, value, unit, confidence: 'clear', source: 'report', sourceIndex: 1,
    period: '累计', quote: label + value + unit });
  const r = { ...report, evidence: { ...report.evidence, metrics: [metric('刷题数', '0', '题'),
    metric('刷题正确率', '65', '%'), metric('累计主动学习时长', '60', '小时14分钟')] } };
  assert.deepEqual(learningReportMetrics(r).map(m => m.label), ['累计主动学习时长', '刷题正确率', '刷题数']);
  const html = learningBoardHtml(r, [], ['metrics']);
  assert.match(html, /小明测试/u); assert.match(html, /60<span>小时14分钟/u); assert.match(html, /0<span>题/u);
  assert.doesNotMatch(html, /家长专属话术|诊断总结|观看后验证/u);
  assert.doesNotMatch(learningPlanText(r, ['summary']), /家长专属话术|观看后验证|65%/u);
});
test('both workflows share one product read; local task polling does not read or mutate durable records', async () => {
  let reads = 0;
  const f = { listRecords: async () => { reads++; return { items: productRows, pageToken: '' }; } };
  const [a, b] = await Promise.all([sharedProductCatalog(f).read(), sharedProductCatalog(f).read()]);
  assert.equal(reads, 1); assert.deepEqual(a, b);
  const cache = new TaskRecordCache(); const durable = { recordId: 'recTask', fields: { '状态': 'running', '提交用户': 'owner' } };
  cache.put(durable); cache.patch('recTask', { '进度': '生成中' });
  for (let i = 0; i < 30; i++) assert.equal((await cache.get('recTask', async () => { throw new Error('Unexpected read'); })).fields['提交用户'], 'owner');
  assert.equal(durable.fields['进度'], undefined);
});
