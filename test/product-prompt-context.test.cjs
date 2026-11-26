require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectPromptProducts, productPromptData, coursePromptData } = require('../server/modules/diagnosis-gateway/product-prompt-context');
const { productCapabilities } = require('./product-fixtures.cjs');
const { diagnosisBoardHtml, learningPlanText } = require('../shared/learning-plan-format');
const query = { grade: '初二', subjects: ['数学'], facts: ['三角形题作答错误，需要复盘'],
  points: [{ subject: '数学', name: '三角形三边关系', keywords: ['三边关系'] }], courses: [], attribute: '基础修复' };

test('candidate selection is bounded, preserves eligibility and never mutates the library used by materials', () => {
  const before = structuredClone(productCapabilities);
  const restricted = [
    { ...before[0], id: 'CAP-SENIOR-ONLY', category: '产品', name: '高中数学培优课', stages: ['高中'], grades: ['高三'] },
    { ...before[0], id: 'CAP-ENGLISH-ONLY', category: '产品', name: '初中英语同步课', subjects: ['英语'] },
  ];
  const selected = selectPromptProducts([...productCapabilities, ...restricted], query);
  assert.ok(selected.length > 0 && selected.length <= 8);
  assert.ok(selected.filter(p => p.category === '产品').length <= 4);
  assert.ok(selected.filter(p => p.category === '卖点').length <= 4);
  assert.ok(selected.some(p => /同步/u.test(p.name)));
  assert.ok(selected.some(p => /错题|拍题/u.test(p.name)));
  assert.ok(selected.every(p => !restricted.some(r => r.id === p.id)));
  assert.deepEqual(productCapabilities, before);
  assert.deepEqual(selectPromptProducts([restricted[0]], { ...query, grade: '高中' }), []);
  assert.equal(selectPromptProducts([restricted[0]], { ...query, grade: '高三' }).length, 1);
});

test('specific problem intent outranks general products and preserves custom catalog products', () => {
  const custom = { ...productCapabilities.find(p => p.category === '产品'), id: 'CAP-CUSTOM-CALCULATION',
    name: '小学计算专题', stages: ['小学'], subjects: ['数学'], grades: undefined,
    trigger: '进退位错误、口算不稳', sequence: '讲解计算方法，再独立尝试' };
  const selected = selectPromptProducts([...productCapabilities, custom], { ...query, grade: '小学',
    facts: ['口算和竖式进退位出错'], points: [{ subject: '数学', name: '进退位计算', keywords: ['竖式'] }] });
  assert.ok(selected.some(p => p.id === custom.id));
  assert.match(selected[0].name, /计算/u);
});

test('prompt projection retains full product boundaries and verified values but omits retrieval metadata', () => {
  const product = { ...productCapabilities[0], functionAccess: '仅限实际开放入口',
    boundary: '基础未稳不优先培优；具体教材须核实', recordId: 'recPrivate', sourceUrl: 'https://example.com/private',
    verifiedAt: '2026-09-22', valueEvidence: { points: ['已核对特点及限制'], materialIds: ['internal-image'],
      sourceUrl: 'https://example.com/evidence', verifiedAt: '2026-09-22' } };
  const projected = productPromptData([product])[0];
  assert.equal(projected.id, product.id);
  assert.ok(projected.boundary.includes(product.boundary));
  assert.ok(projected.boundary.includes(product.functionAccess));
  assert.deepEqual(projected.valueEvidence, { points: product.valueEvidence.points });
  assert.doesNotMatch(JSON.stringify(projected), /recordId|sourceUrl|verifiedAt|materialIds|recPrivate|https:/u);
  const course = { title: '对应课', subject: '数学', grade: '初二', edition: '人教版', courseType: '培优',
    knowledgePoint: '三角形', reviewNote: '教材待核实', sourceUrl: 'https://example.com/course' };
  assert.deepEqual(coursePromptData([course]), [{ ...course, sourceUrl: undefined }].map(({ sourceUrl, ...rest }) => rest));
});

test('new reports reuse diagnosis and course copy once per export while old reports retain their content', () => {
  const summary = '唯一的针对性诊断'; const recommendation = '唯一的产品价值与观看建议';
  const report = { studentName: '示例', grade: '初二', subjects: ['数学'], createdAt: '2026-09-22', parentMessage: '家长总述',
    summary, diagnosisBoard: { focus: summary, importance: '重要性', courseApproach: '' },
    evidence: { metrics: [] }, courses: [], phoneSteps: [{ title: '问诊定位', text: '电话专属问题' }],
    solutions: [{ capabilityId: 'CAP-COURSE-01', name: '同步概念课', knowledgePoint: '三角形',
      reason: '', method: recommendation, acceptance: '观察独立作答' }] };
  const image = diagnosisBoardHtml(report); const text = learningPlanText(report);
  assert.equal(image.split(summary).length - 1, 1);
  assert.equal(image.split(recommendation).length - 1, 1);
  assert.equal(text.split(recommendation).length - 1, 1);
  assert.match(text, /电话专属问题/u);
  assert.doesNotMatch(image, /专业诊断依据|同步打底，培优进阶|电话专属问题/u);
  const legacy = { ...report, diagnosisBoard: { focus: '原来的关注点', importance: '原来的重要性', courseApproach: '原来的课程承接' } };
  for (const value of Object.values(legacy.diagnosisBoard)) assert.ok(diagnosisBoardHtml(legacy).includes(value));
});
