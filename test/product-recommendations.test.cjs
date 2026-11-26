require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifiedMetrics } = require('../server/modules/diagnosis-gateway/learning-metrics');
const { evidenceSchema } = require('../server/modules/diagnosis-gateway/learning-plan.validation');
const { ProductMaterialCatalog, parseProductMaterial, matchProductMaterials } = require('../server/modules/diagnosis-gateway/product-materials');
const { LearningPlanController } = require('../server/modules/diagnosis-gateway/learning-plan.controller');
const { learningBoardHtml, learningPlanText, diagnosisBoardHtml } = require('../shared/learning-plan-format');
const { materialSelectionHtml, materialSelectionText, materialBoardHtml } = require('../shared/diagnosis-presentation');
const { productRows, productCapabilities, productTableId } = require('./product-fixtures.cjs');
const metric = { label: '累计正确率', value: '60', unit: '%', period: '累计', quote: '累计正确率60%',
  source: 'report', sourceIndex: 0, confidence: 'clear' };
const report = { studentName: '非客户验证', grade: '初二', subjects: ['数学'], attribute: '基础修复',
  parentMessage: '根据孩子的实际问题选择产品。', summary: '先确认三角形三边关系。', phoneSteps: [],
  evidence: { facts: ['三角形三边关系作答错误'], uncertainties: [], knowledgePoints: [], metrics: [metric] },
  professionalBasis: [], warnings: [], courses: [], createdAt: '2026-09-17',
  solutions: [{ knowledgePoint: '三角形三边关系', capabilityId: 'CAP-COURSE-01', name: '同步概念课',
    reason: '概念需复核', method: '学后独立验证', acceptance: '能解释条件', boundary: '权益需核实' }] };
const row = (id, change = {}) => ({ recordId: 'rec_' + id, fields: { '素材ID': 'prod_' + id,
  '素材名称': '初中同步课程', '关联产品': ['recCAPCOURSE01'], '适用学段': '初中', '适用学科': '数学',
  '来源链接': 'https://guanghe.feishu.cn/wiki/source', '审核状态': '已核对', 'SHA256': id,
  '原图附件': [{ file_token: 'token-' + id }], ...change } });
test('metrics preserve exact figures, real zero, periods and source; uncertain or unsupported numbers are omitted', () => {
  const input = { reportText: '累计正确率60%，累计练习0题', watchText: '', reportPhotos: [], watchPhotos: [] };
  const zero = { ...metric, label: '累计练习', value: '0', unit: '题', quote: '累计练习0题' };
  assert.deepEqual(verifiedMetrics([metric, zero], input), [metric, zero]);
  for (const change of [{ value: '6' }, { unit: '分' }, { confidence: 'uncertain' }, { sourceIndex: 1 },
    { quote: '累计正确率60%增长' }, { source: 'watch' }]) assert.equal(verifiedMetrics([{ ...metric, ...change }], input).length, 0);
  assert.equal(verifiedMetrics([metric, metric], input).length, 1);
  const duration = { ...metric, label: '学习时长', value: '60', unit: '小时14分钟', quote: '学习时长60小时14分钟' };
  assert.deepEqual(verifiedMetrics([duration], { ...input, reportText: duration.quote }), [duration]);
  assert.equal(evidenceSchema.parse({ facts: ['信息不足'], uncertainties: [], knowledgePoints: [], metrics: [{ value: 'bad' }] }).metrics.length, 0);
});
test('product images require approved capability IDs, matching stage/subject and distinct content', () => {
  const rows = [row('course'), row('copy', { SHA256: 'course' }), row('senior', { '适用学段': '高中' }),
    row('chinese', { '适用学科': '语文' }), row('unreviewed', { '审核状态': '待复核' }),
    row('unknown', { '关联产品': ['fake'] }), row('foreign', { '来源链接': 'https://evil.test' })];
  const parsed = rows.map(r => parseProductMaterial(r, productCapabilities)).filter(Boolean);
  assert.equal(parsed.length, 5);
  assert.equal(matchProductMaterials(parsed, report).length, 1);
  assert.equal(matchProductMaterials(parsed, { ...report, solutions: [] }).length, 1);
  assert.equal(matchProductMaterials(parsed, { ...report, solutions: [] })[0].recommendation, 'optional');
  assert.equal(matchProductMaterials(parsed, { ...report, grade: '未知' }).length, 0);
});
test('product material cache coalesces reads, rechecks approval and does not cache partial failures', async () => {
  let reads = 0; let revoked = false; let fail = false; let downloaded = 0; let now = 0;
  const feishu = {
    listRecords: async table => { reads++; await new Promise(r => setTimeout(r, 5)); if (fail) throw new Error('offline');
      return { items: table === productTableId() ? productRows : [row('course')], pageToken: '' }; },
    getRecord: async () => row('course', revoked ? { '审核状态': '待复核' } : {}),
    downloadPhoto: async () => { downloaded++; return { body: Buffer.from('png'), contentType: 'image/png' }; },
  };
  const catalog = new ProductMaterialCatalog(feishu, () => now);
  const matches = await Promise.all([catalog.match(report), catalog.match(report)]);
  assert.equal(reads, 2); assert.equal(matches[0].status, 'ready');
  assert.doesNotMatch(JSON.stringify(matches), /file_token|token-course|recordId/u);
  await catalog.image('prod_course', report); assert.equal(downloaded, 1);
  await assert.rejects(catalog.image('arbitrary-token', report));
  await assert.rejects(catalog.image('prod_course', { ...report, grade: '高一' }));
  revoked = true; await assert.rejects(catalog.image('prod_course', report)); assert.equal(downloaded, 1);
  now = 600001; fail = true; assert.equal((await catalog.match(report)).status, 'unavailable');
  fail = false; assert.equal((await catalog.match(report)).status, 'ready'); assert.equal(reads, 5);
});
test('a course can match its supporting selling-point poster without recommending that point as a product', () => {
  const poster = parseProductMaterial(row('aipoint', { '关联产品': ['recCAPAI02'] }), productCapabilities);
  const supported = { ...report, solutions: [{ ...report.solutions[0],
    sellingPoints: [{ capabilityId: 'CAP-AI-02', name: 'AI 错题本', boundary: '辅助复习' }] }] };
  assert.equal(matchProductMaterials([poster], report, productCapabilities)[0].recommendation, 'optional');
  assert.equal(matchProductMaterials([poster], supported, productCapabilities).length, 1);
  assert.match(learningBoardHtml(supported, [{ ...poster, imageDataUrl: 'data:image/png;base64,YQ==' }]), /<img /u);
});
test('material gallery returns multiple posters and optional products while preserving scope, ranking and image authorization', async () => {
  const rows = [row('first'), row('second'), row('advanced', { '关联产品': ['recCAPCOURSE03'], '内容摘要': '培优课程介绍。基础扎实后进一步学习。' }),
    row('point', { '关联产品': ['recCAPAI02'] }), row('sameimage', { SHA256: 'first' }),
    row('senior', { '适用学段': '高中' }), row('wronggrade', { '适用年级': ['初三'] })];
  const parsed = rows.map(r => parseProductMaterial(r, productCapabilities)).filter(Boolean);
  const matches = matchProductMaterials(parsed, report, productCapabilities);
  assert.equal(matches.length, 4);
  assert.equal(matches.filter(m => m.recommendation === 'recommended').length, 2);
  assert.equal(matches[0].recommendation, 'recommended');
  assert.ok(matches.every(m => m.introduction && m.capabilityNames.length));
  assert.ok(matches.every(m => /给您介绍一下/u.test(m.introduction)));
  assert.ok(matches.every(m => !/本图|该图|该物料/u.test(m.introduction)));
  assert.ok(matches.some(m => m.capabilityIds.includes('CAP-COURSE-03') && m.recommendation === 'optional'));
  let revoked = false; let downloads = 0;
  const catalog = new ProductMaterialCatalog({
    listRecords: async table => ({ items: table === productTableId() ? productRows : rows, pageToken: '' }),
    getRecord: async (_table, id) => ({ ...rows.find(r => r.recordId === id),
      fields: { ...rows.find(r => r.recordId === id).fields, ...(revoked ? { '适用年级': ['初三'] } : {}) } }),
    downloadPhoto: async () => { downloads++; return { body: Buffer.from('png'), contentType: 'image/png' }; },
  });
  await catalog.image('prod_advanced', report);
  assert.equal(downloads, 1);
  revoked = true; await assert.rejects(catalog.image('prod_advanced', report));
  assert.equal(downloads, 1);
});
test('diagnosis export includes course viewing advice without parent pitch or posters; rich material copy preserves each original', () => {
  const html = diagnosisBoardHtml(report);
  assert.match(html, /非客户验证|先确认三角形三边关系/u);
  assert.match(html, /60<span>%/u);
  assert.doesNotMatch(html, /根据孩子的实际问题选择产品|<img /u);
  assert.match(html, /洋葱课程 · 从这里开始学/u);
  assert.match(html, /同步概念课/u); assert.match(html, /学后独立验证/u);
  const materials = ['one', 'two'].map(id => ({ materialId: id, name: `<${id}>`, introduction: `介绍${id}`,
    imageDataUrl: 'data:image/png;base64,YQ==', summary: '', capabilityIds: [], sourceUrl: '', boundary: '' }));
  const copied = materialSelectionHtml(materials);
  assert.equal((copied.match(/<img /gu) || []).length, 2);
  assert.equal((copied.match(/src="data:image\/png;base64,YQ=="/gu) || []).length, 2);
  assert.match(materialSelectionHtml([{ ...materials[0], introduction: '第一段\n第二段' }]), /第一段<br>第二段/u);
  assert.doesNotMatch(copied, /&lt;one&gt;|<one>|<h3>/u); assert.match(copied, /介绍two/u);
  assert.equal(materialSelectionText(materials), '介绍one\n\n介绍two');
  assert.match(materialSelectionHtml([{ ...materials[0], introduction: '<script>x</script>' }]), /&lt;script&gt;/u);
  assert.doesNotMatch(materialSelectionHtml([{ ...materials[0], imageDataUrl: 'https://evil.test/image' }]), /<img |evil.test/u);
  const board = materialBoardHtml(materials);
  assert.match(board, /介绍one/u); assert.match(board, /介绍two/u);
  assert.equal((board.match(/<img /gu) || []).length, 2);
  assert.doesNotMatch(board, /非客户验证|先确认三角形三边关系/u);
});
test('sales emphasis is safely rendered and omitted from plain text; course names retain their actual types', () => {
  const { salesTextParts, plainSalesText } = require('../shared/diagnosis-presentation');
  const text = '约**3—6分（经验估算，非固定占分）**，<script>bad</script>';
  assert.equal(plainSalesText(text), '约3—6分（经验估算，非固定占分），<script>bad</script>');
  assert.equal(salesTextParts(text).filter(p => p.strong).length, 1);
  const enhanced = { ...report, diagnosisBoard: { focus: '当前学习三边关系', importance: text, courseApproach: '先同步后培优' },
    courses: [{ title: '测试同步课', knowledgePoint: '三角形三边关系', courseType: '同步', subject: '数学', sourceUrl: 'test-sync' },
      { title: '不可混为同步课的培优课', knowledgePoint: '三角形三边关系', courseType: '培优', subject: '数学', sourceUrl: 'test-advanced' }] };
  const html = diagnosisBoardHtml(enhanced);
  assert.match(html, /<strong>3—6分（经验估算，非固定占分）<\/strong>/u);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/u);
  assert.match(html, /测试同步课/u);
  assert.doesNotMatch(html, /<script>|不可混为同步课的培优课/u);
  assert.doesNotMatch(learningPlanText({ ...report, parentMessage: text }), /\*\*/u);
});
test('structured diagnosis board retains focus, importance and course combination through generation and export', () => {
  const { generatedPlanSchema } = require('../server/modules/diagnosis-gateway/learning-plan.validation');
  const { normalizeDiagnosis } = require('../server/modules/diagnosis-gateway/diagnosis-normalize');
  const diagnosisBoard = { focus: '正在学习三角形三边关系', importance: '关系到后续几何条件判断',
    courseApproach: '同步课先打底，再用适合水平的培优课承接应用' };
  const generated = generatedPlanSchema.parse({ parentMessage: '孩子家长您好', summary: '关注当前内容', diagnosisBoard,
    phoneSteps: Array.from({ length: 5 }, () => ({ text: '沟通话术' })), professionalBasis: ['观看记录'], solutions: [] });
  assert.deepEqual(generated.diagnosisBoard, { importance: diagnosisBoard.importance });
  assert.equal(generated.professionalBasis, undefined);
  const normalized = normalizeDiagnosis({ overall: '当前内容', problems: [], plan: [], diagnosis_board: diagnosisBoard },
    { grade: '初二', subject: '数学', wrongItems: [] });
  assert.deepEqual(normalized.diagnosis.diagnosisBoard, diagnosisBoard);
  const html = diagnosisBoardHtml({ ...report, diagnosisBoard });
  for (const value of Object.values(diagnosisBoard)) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /根据孩子的实际问题选择产品|<img /u);
});
test('both report flows retain verified courses for a second diagnosed point without crossing subject or product type', () => {
  const { solutionCourses, examDiagnosisReport } = require('../shared/diagnosis-presentation');
  const matched = { title: '等腰三角形', knowledgePoint: '等腰三角形的性质', courseType: '教材同步',
    subject: '数学', grade: '初二', book: '八年级上册', edition: '人教版', sourceUrl: 'verified-isosceles' };
  const learning = { ...report, courses: [matched,
    { ...matched, title: '不能归入同步的培优课', courseType: '培优', sourceUrl: 'advanced' },
    { ...matched, title: '不能混入的物理课', subject: '物理', sourceUrl: 'physics' }] };
  assert.deepEqual(solutionCourses(learning, 0), [matched]);
  const exam = examDiagnosisReport({ grade: report.grade, subjects: report.subjects,
    parentMessage: report.parentMessage, overall: report.summary, problems: [], strengths: [],
    rightAnalysis: '', scopeNote: '', solutions: report.solutions, courseMatches: learning.courses }, report.studentName);
  for (const r of [learning, exam]) {
    assert.deepEqual(solutionCourses(r, 0), [matched]);
    const html = diagnosisBoardHtml(r), text = learningPlanText(r);
    for (const content of [html, text]) {
      assert.match(content, /等腰三角形/u);
      assert.match(content, /八年级上册/u);
      assert.match(content, /对应知识点：等腰三角形的性质/u);
      assert.doesNotMatch(content, /不能归入|不能混入/u);
    }
  }
  const multi = { ...learning, subjects: ['数学', '物理'],
    solutions: [{ ...report.solutions[0], name: '初中数学同步课' }] };
  assert.deepEqual(solutionCourses(multi, 0), [matched]);
  assert.deepEqual(solutionCourses({ ...learning, courses: [] }, 0), []);
  const pending = { ...matched, reviewNote: '原目录待核实' };
  assert.match(diagnosisBoardHtml({ ...report, courses: [pending] }), /可以和老师一起确认这节课/u);
});
test('exam product recommendations cover all confirmed problems of the applicable subject', () => {
  const { recommend } = require('../server/modules/diagnosis-gateway/diagnosis-recommendation');
  const diagnosis = { grade: '初二', subjects: ['数学'], photoQuality: { assessment: '清晰' },
    parentMessage: '孩子家长您好', plan: [], weakPoints: [], overall: '本次作答',
    problems: [
      { subject: '数学', knowledgePoint: '三角形三边关系', item: '第1题', rootCause: '本题将等于用作构成条件' },
      { subject: '数学', knowledgePoint: '等腰三角形的性质', item: '第3题', rootCause: '本题将两底角和作为一个底角' },
    ] };
  assert.equal(recommend(diagnosis, ['CAP-COURSE-01'], productCapabilities), true);
  assert.equal(diagnosis.solutions[0].knowledgePoint, '三角形三边关系、等腰三角形的性质');
});
test('product labels stay bracketed across text and image export without nesting or changing product keys', () => {
  const { bracketProductNames } = require('../shared/diagnosis-presentation');
  const names = ['培优课', '初中数学培优课', '课程(A)+'];
  const text = '先看初中数学培优课，再看【培优课】，也可看课程(A)+。';
  const expected = '先看【初中数学培优课】，再看【培优课】，也可看【课程(A)+】。';
  assert.equal(bracketProductNames(text, names), expected);
  assert.equal(bracketProductNames(expected, names), expected);
  assert.equal(bracketProductNames(text, []), text);
  const example = { ...report, parentMessage: '可以从同步概念课开始。',
    phoneSteps: [{ title: '建议', text: '先看同步概念课。' }] };
  assert.match(learningPlanText(example), /可以从【同步概念课】开始/u);
  assert.match(learningPlanText(example), /先看【同步概念课】/u);
  assert.match(diagnosisBoardHtml(example), /<h3>【同步概念课】<\/h3>/u);
  assert.equal(example.solutions[0].name, '同步概念课');
  const { materialSalesIntroduction } = require('../server/modules/diagnosis-gateway/material-sales-copy');
  const introduction = materialSalesIntroduction([{ id: 'test', name: '初中数学同步课', category: '产品' }], '课程介绍');
  assert.match(introduction, /【初中数学同步课】/u);
  assert.match(materialSelectionHtml([{ introduction, imageDataUrl: 'data:image/png;base64,YQ==' }]), /【初中数学同步课】/u);
});
test('metric evaluations survive parsing and export only beside supplied clear report metrics', () => {
  const { generatedPlanSchema } = require('../server/modules/diagnosis-gateway/learning-plan.validation');
  const metrics = [
    { ...metric, label: '累计主动学习时长', value: '60', unit: '小时14分钟' },
    { ...metric, label: '刷题正确率', value: '65', unit: '%' },
    { ...metric, label: '累计刷题数', value: '240', unit: '题' },
  ];
  const analyses = metrics.map((m, i) => ({ label: m.label, analysis: `数据评价${i}<不作为单知识点结论>` }));
  const parsed = generatedPlanSchema.parse({ parentMessage: '家长您好', summary: '当前学习表现',
    diagnosisBoard: { importance: '与后续学习有关' },
    metricAnalyses: [...analyses, { label: '未提供的指标', analysis: '不应显示的评价' }],
    phoneSteps: Array.from({ length: 5 }, () => ({ text: '沟通话术' })), professionalBasis: ['报告数据'], solutions: [] });
  const rated = { ...report, metricAnalyses: parsed.metricAnalyses, evidence: { ...report.evidence, metrics } };
  const html = diagnosisBoardHtml(rated); const text = learningPlanText(rated, ['metrics']);
  analyses.forEach((a, i) => {
    assert.ok(text.includes(a.analysis));
    assert.ok(html.includes(`数据评价${i}&lt;不作为单知识点结论&gt;`));
    assert.ok(text.includes(`${metrics[i].value}${metrics[i].unit}`));
  });
  assert.doesNotMatch(html + text, /不应显示的评价/u);
  const withoutClearMetrics = { ...rated, evidence: { ...rated.evidence,
    metrics: metrics.map(m => ({ ...m, confidence: 'uncertain' })) } };
  assert.doesNotMatch(diagnosisBoardHtml(withoutClearMetrics) + learningPlanText(withoutClearMetrics, ['metrics']), /数据评价/u);
  assert.doesNotMatch(diagnosisBoardHtml(report), /<p class="metric-analysis">/u);
});
test('sales material introductions deduplicate overlapping course names without copying metadata summaries', () => {
  const { materialSalesIntroduction } = require('../server/modules/diagnosis-gateway/material-sales-copy');
  const copy = materialSalesIntroduction([
    { name: '培优课', category: '产品' }, { name: '初中数学培优课', category: '产品' },
    { name: 'AI 拍题精学', category: '卖点' },
  ], '培优课课程大纲');
  assert.equal((copy.match(/在基础理解清楚后/gu) || []).length, 1);
  assert.match(copy, /给您介绍一下【初中数学培优课】/u);
  assert.match(copy, /AI 拍题精学/u);
  assert.doesNotMatch(copy, /本图|该图|课程大纲/u);
});
test('reviewed course value evidence reaches matching captions without leaking junior claims to other stages', () => {
  const { eligibleCapabilities } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');
  const { materialSalesIntroduction } = require('../server/modules/diagnosis-gateway/material-sales-copy');
  const sync = { id: 'CAP-SKU-test-sync', name: '初中数学同步课', category: '产品', stages: ['初中'], subjects: ['数学'] };
  const advanced = { id: 'CAP-SKU-test-advanced', name: '初中数学培优课', category: '产品', stages: ['初中'], subjects: ['数学'] };
  const junior = eligibleCapabilities('初二', ['数学'], [sync, advanced]);
  assert.equal(junior.length, 2);
  assert.ok(junior.every(p => p.valueEvidence.materialIds.length && p.valueEvidence.sourceUrl.startsWith('https://guanghe.feishu.cn/')));
  assert.match(materialSalesIntroduction(junior, '初中数学课程'), /动画微课/u);
  assert.match(materialSalesIntroduction(junior, '初中数学课程'), /中考命题人带领教研团队/u);
  const mixed = materialSalesIntroduction([
    { id: 'CAP-COURSE-03', name: '培优课', category: '卖点' }, ...junior,
  ], '培优课');
  assert.equal((mixed.match(/在基础理解清楚后/gu) || []).length, 1);
  assert.match(mixed, /初中数学培优课/u);
  assert.match(mixed, /动画微课/u);
  assert.equal(sync.valueEvidence, undefined);
  assert.equal(advanced.valueEvidence, undefined);
  for (const grade of ['小学', '高中', '高三', '未知']) {
    assert.equal(eligibleCapabilities(grade, ['数学'], [sync, advanced]).length, 0);
    assert.ok(eligibleCapabilities(grade, ['数学']).every(p => !p.valueEvidence));
  }
  const unsupported = [
    { ...advanced, id: 'CAP-CUSTOM-test', name: '自建培优课' },
    { ...advanced, id: 'CAP-SKU-test-history', name: '初中历史培优课', subjects: ['历史'] },
    { ...sync, category: '卖点' },
  ];
  assert.ok(eligibleCapabilities('初中', ['数学', '历史'], unsupported).every(p => !p.valueEvidence));
});
test('both product material routes retain platform login and sales/admin checks', () => {
  for (const method of ['productMaterials', 'productImage']) {
    assert.ok(Reflect.getMetadata('authnpaas:needLogin', LearningPlanController.prototype[method]));
    assert.deepEqual(Reflect.getMetadata('authzpaas:roles', LearningPlanController.prototype[method]).roles, ['sales', 'admin']);
  }
});
test('product board displays source numbers and applicable posters; old plans and untrusted URLs stay out', () => {
  const legacy = { ...report, plans: [{ period: '未来7天', goal: '旧目标', actions: [], acceptance: '' }],
    allocation: '40% + 60%', allocationNote: '旧配比' };
  const material = { materialId: 'prod_course', name: '课程原图', capabilityIds: ['CAP-COURSE-01'],
    imageDataUrl: 'data:image/png;base64,YQ==', summary: '同步介绍', boundary: '核实权益', sourceUrl: 'https://guanghe.feishu.cn' };
  const html = learningBoardHtml(legacy, [material]);
  assert.match(html, /60<span>%/u); assert.match(html, /学习概况/u);
  assert.doesNotMatch(html + learningPlanText(legacy), /<small>累计<\/small>|（累计）/u);
  const dated = { ...report, evidence: { ...report.evidence,
    metrics: report.evidence.metrics.map(m => ({ ...m, period: '2026年9月' })) } };
  assert.match(learningBoardHtml(dated), /<small>2026年9月<\/small>/u);
  assert.match(learningPlanText(dated), /（2026年9月）/u);
  assert.match(html, /data:image\/png;base64,YQ==/u); assert.match(html, /课程介绍/u);
  assert.doesNotMatch(html, /原报告关键数据|来源|学情报告正文|推荐理由：|怎么用：|验收：|辅助卖点：/u);
  assert.doesNotMatch(html + learningPlanText(legacy), /未来7天|旧目标|旧配比|40% \+ 60%/u);
  const noMetrics = learningBoardHtml({ ...report, evidence: { ...report.evidence, metrics: undefined } });
  assert.doesNotMatch(noMetrics, /学习概况|暂无可确认/u);
  const unsafe = learningBoardHtml({ ...report, studentName: '<script>x</script>' }, [{ ...material, imageDataUrl: 'https://evil.test/x' }]);
  assert.doesNotMatch(unsafe, /<script>|evil\.test/u);
  assert.doesNotMatch(learningBoardHtml(report, [{ ...material, capabilityIds: ['CAP-AI-03'] }]), /<img /u);
});
