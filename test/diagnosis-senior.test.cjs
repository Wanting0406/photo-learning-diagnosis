require('reflect-metadata');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { CourseCatalogs, MathCourseCatalog, parseSeniorCourses, parseMathDirectory, rankMathKnowledge } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
const row = (id, subject = '化学', title = '第30讲 化学平衡与可逆反应', fields = {}) => ({ record_id: id, fields: {
  '课程名称': title, '知识点名称': title.replace(/^第\d+讲 /u, ''), '学科': subject,
  '适用年级': '高一、高二、高三', '审核状态': '已核对', '课程类型': '一轮培优', ...fields,
} });
const parse = rows => parseSeniorCourses(rows, 'baseTest', 'tblSenior');
const point = (subject, name, keywords = []) => ({ subject, name, keywords });
beforeEach(() => {
  process.env.BITABLE_APP_TOKEN = 'baseTest'; process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID = 'tblSenior';
});
test('four senior subjects match actual terms with provenance and preserve pending review boundaries', () => {
  for (const [subject, title, query] of [['物理', '动能定理及其应用', '动能定理'], ['化学', '化学平衡与可逆反应', '可逆反应'],
    ['生物', '光合作用的过程与场所', '光合作用'], ['英语', '记叙文-介绍人物类', '记叙文']]) {
    const courses = parse([row('recOne', subject, title)]);
    const result = rankMathKnowledge('高三', [point(subject, query)], courses, '', subject);
    assert.equal(result[0].match.title, title); assert.equal(result[0].match.subject, subject);
    assert.equal(result[0].match.reviewNote, undefined);
    assert.match(result[0].match.sourceUrl, /table=tblSenior&record=recOne$/u);
    for (const grade of ['高一', '高二', '高三']) {
      assert.equal(rankMathKnowledge(grade, [point(subject, query)], courses, '', subject).length, 1);
    }
    for (const grade of ['一年级', '初三', '高中', '高三/初三']) {
      assert.equal(rankMathKnowledge(grade, [point(subject, query)], courses, '', subject).length, 0);
    }
    assert.equal(rankMathKnowledge('高三', [point('数学', query)], courses, '', subject).length, 0);
  }
});
test('exam-only and conflicting records require full title evidence, never keyword-only matching', () => {
  const courses = parse([row('recExam', '化学', '2024全国甲卷', { '知识点名称': '', '课程类型': '真题精讲' }),
    row('recConflict', '化学', '电磁感应与动力学、能量综', { '核对说明': '原图标题疑似截断' })]);
  for (const query of ['全国甲卷', '2024', '电磁感应', '能量', '化学', '实验']) {
    assert.equal(rankMathKnowledge('高三', [point('化学', query)], courses, '', '化学').length, 0);
  }
  assert.equal(rankMathKnowledge('高三', [point('化学', '氧化还原', ['2024全国甲卷'])], courses, '', '化学').length, 0);
  assert.match(rankMathKnowledge('高三', [point('化学', '2024全国甲卷')], courses, '', '化学')[0].match.reviewNote, /未确认对应知识点/u);
});
test('previously imported pending math rows are exact-name references and keep legacy curriculum warnings', () => {
  const courses = parseMathDirectory([row('recLegacy', '数学', '旧课标线性规划', {
    '适用年级': '高三', '专题': '旧课标文理科专区：待核实', '知识点名称': '', '审核状态': '待核实',
  })], 'baseTest', 'tblMathKnowledge');
  assert.equal(courses.length, 1);
  assert.equal(rankMathKnowledge('高三', [point('数学', '线性规划')], courses).length, 0);
  const match = rankMathKnowledge('高三', [point('数学', '旧课标线性规划')], courses)[0].match;
  assert.match(match.reviewNote, /旧课标/u);
});
test('withdrawn, malformed, unknown-grade records are excluded and explicit reviewed grade takes precedence', () => {
  assert.throws(() => parseSeniorCourses([], 'base/evil', 'tblSenior'));
  const courses = parse([row('recDeleted', '化学', '氧化还原', { '审核状态': '停用' }), row('../escape'),
    row('recWrong', '语文'), row('recGrade', '化学', '氧化还原', { '适用年级': '大学' }),
    row('recReviewed', '化学', '氧化还原', { '适用年级': '高二', '审核状态': '已核对' })]);
  assert.equal(courses.length, 1);
  assert.equal(rankMathKnowledge('高二', [point('化学', '氧化还原')], courses, '', '化学')[0].match.reviewNote, undefined);
});
test('multi-subject table loads once for concurrent readers and isolates same-title records by subject', async () => {
  let reads = 0;
  const catalogs = new CourseCatalogs({ request: async (method, path) => {
    assert.match(path, /tblSenior/u); reads++;
    return { items: [row('recChem', '化学', '同名课程'), row('recBio', '生物', '同名课程')] };
  } });
  const [a, b] = await Promise.all([catalogs.read(['化学']), catalogs.read(['生物'])]);
  assert.equal(reads, 1); assert.equal(a.senior.length, 1); assert.equal(b.senior.length, 1);
  const snapshot = await catalogs.read(['生物', '化学']);
  const match = catalogs.match('高三', [point('化学', '同名课程'), point('生物', '同名课程')], snapshot);
  assert.equal(match.matches.length, 2); assert.equal(reads, 1);
  assert.equal(new Set(match.matches.map(c=>c.subject)).size, 2);
});
test('senior cache paginates, refreshes after ten minutes and discards partial failures', async () => {
  let now = 0; let calls = 0; let fail = false;
  const catalog = new MathCourseCatalog({ request: async (method, path, body, query) => {
    calls++;
    if (!query.page_token) return { items: [row('recFirst')], has_more: true, page_token: 'next' };
    if (fail) throw Error('upstream secret');
    return { items: [row('recSecond')] };
  } }, () => now, 'BITABLE_SENIOR_KNOWLEDGE_TABLE_ID', parseSeniorCourses);
  await Promise.all([catalog.read(), catalog.read()]); assert.equal(calls, 2);
  await catalog.read(); assert.equal(calls, 2);
  now = 600001; fail = true; await assert.rejects(catalog.read());
  fail = false; assert.equal((await catalog.read()).length, 2); assert.equal(calls, 6);
});
test('failed senior source retains original physics results and surfaces an unavailable message', async () => {
  const catalogs = new CourseCatalogs({ request: async (method, path) => {
    if (path.includes('tblSenior')) throw Error('private upstream');
    return { items: [{ record_id: 'recJunior', fields: { '视频名': '长度单位换算', '年级': '八上' } }] };
  } });
  const data = await catalogs.read(['物理', '化学']);
  const match = catalogs.match('初二', [point('物理', '长度单位换算')], data);
  assert.equal(match.matches[0].title, '长度单位换算');
  assert.match(match.note, /目录读取失败/u); assert.doesNotMatch(match.note, /private upstream/u);
});
