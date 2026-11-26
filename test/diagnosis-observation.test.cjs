const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groundNarrative, groundDiagnosis } = require('../server/modules/diagnosis-gateway/diagnosis-observation');
const { normalizeDiagnosis } = require('../server/modules/diagnosis-gateway/diagnosis-normalize');
const { generatedPlanSchema, evidenceSchema } = require('../server/modules/diagnosis-gateway/learning-plan.validation');

const observed = '第2题算出180-50-60=70';
const advice = '到洋葱App看【初中数学同步课】中的三角形三边关系';
const failed = `${observed}，说明基础运算没问题。第1题把3+4=7当成能围成三角形；${advice}。`;

test('real production overclaim is bounded without changing observations, product guidance or length limits', () => {
  const text = groundNarrative(failed);
  assert.doesNotMatch(text, /基础运算没问题/u);
  assert.ok(text.includes(observed));
  assert.ok(text.includes('第1题把3+4=7当成能围成三角形'));
  assert.ok(text.includes(advice));
  const long = `${observed}。${advice}。`.repeat(30);
  assert.equal(groundNarrative(long), long);
  assert.equal(groundNarrative('一道题答对不能说明基础运算没问题。'), '一道题答对不能说明基础运算没问题。');
  assert.equal(groundNarrative(text), text);
});

test('exam report applies guard before deriving solutions, copying or exporting', () => {
  const { diagnosis } = normalizeDiagnosis({ overall: failed, parent_message: failed, plan: [advice],
    right_analysis: failed, strengths: ['公式运用很熟练'],
    diagnosis_board: { focus: failed, importance: '后续全等三角形会用到三边关系。', courseApproach: advice },
    problems: [{ item: '第1题', subject: '数学', knowledge_point: '三角形三边关系',
      root_cause: '孩子只会机械记忆', error_type: '存在逻辑漏洞', suggestion: advice }] },
  { grade: '初二', subject: '数学', wrongItems: ['第1题'] });
  assert.doesNotMatch(JSON.stringify(diagnosis), /基础运算没问题|公式运用很熟练|机械记忆|逻辑漏洞/u);
  assert.ok(diagnosis.parentMessage.includes(observed));
  assert.equal(diagnosis.problems[0].knowledgePoint, '三角形三边关系');
  assert.equal(diagnosis.problems[0].suggestion, advice);
});

test('learning report guards phone, parent, metrics and recommendations but keeps source evidence intact', () => {
  const report = generatedPlanSchema.parse({ parentMessage: failed, summary: failed,
    diagnosisBoard: { importance: '三角形是后续几何学习的基础。' },
    metricAnalyses: [{ label: '正确率', analysis: '说明基础计算能力扎实' }],
    phoneSteps: Array.from({ length: 5 }, () => ({ text: failed })),
    solutions: [{ knowledgePoint: '三角形三边关系', capabilityId: 'CAP-COURSE-01',
      evidenceIndexes: [0], recommendation: failed }] });
  assert.doesNotMatch(JSON.stringify(report), /基础运算没问题|基础计算能力扎实/u);
  assert.equal(report.solutions[0].capabilityId, 'CAP-COURSE-01');
  assert.ok(report.phoneSteps.every(step => step.text.includes(advice)));
  assert.equal(evidenceSchema.parse({ facts: [failed], uncertainties: [], knowledgePoints: [] }).facts[0], failed);
});

test('replay final production synonyms without suppressing specific correct and incorrect steps', () => {
  const text = '小明在本次测试中展现了基础的运算能力，但在几何概念的精确应用上存在偏差。第2题内角和计算正确，说明具备基本代数求解能力；第3题在求等腰三角形底角时遗漏了除以2，反映出对概念理解不够严谨。虽然掌握了内角和定理，但遗漏了将剩余角度平分的步骤。这表明孩子对几何定义的严谨性和解题的完整逻辑链条还需要进一步打磨。等腰三角形的性质用于中考几何计算，若在此处养成粗心漏步的习惯，将在复杂的综合题中导致连锁失分。';
  const result = groundNarrative(text);
  assert.doesNotMatch(result, /运算能力|代数求解能力|不够严谨|虽然掌握|这表明|习惯|连锁失分/u);
  assert.match(result, /第2题内角和计算正确/u);
  assert.match(result, /第3题在求等腰三角形底角时遗漏了除以2/u);
  assert.match(result, /等腰三角形的性质用于中考几何计算/u);
  assert.equal(groundNarrative(result), result);
  assert.doesNotMatch(result, /^但|，但在处理/u);
  assert.doesNotMatch(groundNarrative('他在基础的角度计算上没问题，比如第2题做得很好。'), /没问题/u);
  assert.equal(groundNarrative('看了孩子的测试，他在基础的角度计算上没问题，比如第2题做得很好。'), '看了孩子的测试，第2题做得很好。');
  assert.equal(groundNarrative('这道题的计算结果正确。课程帮助孩子逐步练习解题能力。'), '这道题的计算结果正确。课程帮助孩子逐步练习解题能力。');
});

test('historical diagnosis reads are bounded without mutating stored content or course identities', () => {
  const { diagnosis } = normalizeDiagnosis({ overall: observed, parent_message: advice, problems: [], plan: [] },
    { grade: '初二', subject: '数学', wrongItems: [] });
  diagnosis.overall = failed;
  diagnosis.solutions = [{ capabilityId: 'course-id', name: '初中数学同步课', knowledgePoint: '三角形',
    method: advice, reason: failed, acceptance: '课程练习', boundary: '' }];
  const safe = groundDiagnosis(diagnosis);
  assert.doesNotMatch(safe.overall + safe.solutions[0].reason, /基础运算没问题/u);
  assert.equal(safe.solutions[0].name, diagnosis.solutions[0].name);
  assert.equal(safe.solutions[0].method, advice);
  assert.equal(diagnosis.overall, failed);
});
