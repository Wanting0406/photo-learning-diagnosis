require('reflect-metadata');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { AllCourseCatalog, parseAllCourses } = require('../server/modules/diagnosis-gateway/all-course-catalog');
const { CourseCatalogs } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
const { coursePromptData } = require('../server/modules/diagnosis-gateway/product-prompt-context');
const record = (id, overrides = {}) => ({ record_id: id, fields: {
  课程名称: '集合与元素', 知识点名称: '集合与元素', 适用学段: '高中', 适用年级: '高中',
  教材版本: '人教A版', 册别: '必修第一册', 学科: '数学', 课程类型: '教材同步', 审核状态: '已核对', ...overrides,
} });
const parse = rows => parseAllCourses(rows, 'baseTest', 'tblAll');
const snapshot = rows => ({ math: [], physics: [], all: parse(rows), failed: [] });
const point = (name, subject = '数学') => [{ name, subject, keywords: [] }];
const catalogs = () => new CourseCatalogs({ request: async () => { throw new Error('unused'); } });
beforeEach(() => {
  process.env.BITABLE_APP_TOKEN = 'baseTest'; delete process.env.BITABLE_ALL_COURSE_TABLES;
  delete process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID; delete process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID;
  delete process.env.BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID;
});

test('all-subject directory preserves book and stage scope without inventing a specific high school year', () => {
  const data = snapshot([record('recHigh'), record('recJunior', { 适用学段: '初中', 适用年级: '初一' })]);
  for (const grade of ['高一', '高二', '高三', '高中']) {
    const result = catalogs().match(grade, point('集合与元素'), data);
    assert.equal(result.matches.length, 1); assert.equal(result.matches[0].grade, '高中');
    assert.equal(result.matches[0].book, '必修第一册');
    assert.match(result.matches[0].reviewNote, /未标具体年级/u);
    assert.doesNotMatch(result.note, /暂无.*数学/u);
  }
  assert.equal(catalogs().match('一年级', point('集合与元素'), data).matches.length, 0);
  assert.equal(catalogs().match('初二', point('集合与元素'), data).matches.length, 0);
});

test('primary extension subjects, junior history/civics and senior politics match only their subject and stage', () => {
  for (const [subject, stage, grade, name] of [
    ['语文', '小学', '二年级', '如何看图'], ['英语', '小学', '三年级', '字母组合发音'],
    ['物理', '小学', '四年级', '什么是沸腾'], ['生物', '小学', '五年级', '孢子植物'],
    ['地理', '小学', '六年级', '地球家园'], ['历史', '初中', '初一', '北京人'],
    ['道德与法治', '初中', '初一', '规划初中生活'], ['政治', '高中', '高一', '原始社会生产关系'],
  ]) {
    const data = snapshot([record('recOther', { 学科: subject, 适用学段: stage, 适用年级: grade, 课程名称: name, 知识点名称: name })]);
    const found = catalogs().match(grade, point(name, subject), data);
    assert.equal(found.matches.length, 1); assert.doesNotMatch(found.note, /尚未接入|暂无/u);
    assert.equal(catalogs().match(grade, point(name, '数学'), data).matches.length, 0);
    assert.equal(catalogs().match(stage === '高中' ? '初中' : '高中', point(name, subject), data).matches.length, 0);
  }
});

test('strict senior grade restrictions and review exclusions survive the additional source', () => {
  const data = snapshot([record('recReview', { 适用年级: '高三' }),
    record('recPending', { 审核状态: '待复核' }), record('recMixed', { 适用年级: '初三、高一' }),
    record('recUnknown', { 适用年级: '' }), record('../invalid')]);
  assert.equal(data.all.length, 1);
  assert.equal(catalogs().match('高一', point('集合与元素'), data).matches.length, 0);
  assert.equal(catalogs().match('高三', point('集合与元素'), data).matches.length, 1);
});

test('region selection never guesses a province and duplicate regional titles do not occupy both slots', () => {
  const data = snapshot(['湖北省', '湖南省', '本地化'].map((region, i) => record(`recRegion${i}`, {
    适用学段: '初中', 适用年级: '初三', 课程名称: '实数的分类', 知识点名称: '实数的分类', 地区: region,
  })));
  for (const [note, region] of [['', '本地化'], ['湖北中考', '湖北省'], ['湖南省', '湖南省']]) {
    const result = catalogs().match('初中', point('实数的分类'), data, note);
    assert.equal(result.matches.length, 1); assert.equal(result.matches[0].region, region);
  }
});

test('specific edition filtering spans old and new sources and supplementary keyword fragments stay conservative', () => {
  const data = snapshot([record('recNew', { 教材版本: '人教版（2024）', 适用学段: '小学', 适用年级: '三年级' })]);
  data.math = [{ recordId: 'recOld', title: '集合与元素', grade: '四年级', edition: '人教版',
    courseType: '教材同步', terms: ['集合与元素'], sourceUrl: 'https://example.com/old' }];
  assert.equal(catalogs().match('四年级', point('集合与元素'), data, '人教版（2024）').matches.length, 0);
  const keywordOnly = [{ name: '集合判断', subject: '数学', keywords: ['元素'] }];
  assert.equal(catalogs().match('三年级', keywordOnly, data).matches.length, 0);
});
test('stage and subject suffixes in edition names do not hide high school courses from ordinary textbook notes', () => {
  const data = snapshot([
    record('recHighPhysics', { 学科: '物理', 教材版本: '人教版高中物理', 课程名称: '质点', 知识点名称: '质点' }),
    record('recJuniorPhysics', { 学科: '物理', 教材版本: '人教版', 适用学段: '初中', 适用年级: '初二' }),
    record('recHighNew', { 学科: '物理', 教材版本: '人教版（2024）高中物理', 课程名称: '质点', 知识点名称: '质点' }),
  ]);
  for (const note of ['人教版', '人教版高中物理']) {
    const found = catalogs().match('高一', point('质点', '物理'), data, note);
    assert.equal(found.matches.length, 1); assert.equal(found.matches[0].edition, '人教版高中物理');
  }
  const newer = catalogs().match('高一', point('质点', '物理'), data, '人教版（2024）');
  assert.equal(newer.matches.length, 1); assert.equal(newer.matches[0].edition, '人教版（2024）高中物理');
});
test('triangle name variants match the ordinary lesson, exclude special triangles, and cover both observed topics', () => {
  const rows = ['三角形的三边关系', '特殊直角三角形的三边关系', '等腰三角形', '三角形的三边关系应用']
    .map((name, index) => record(`recTriangle${index}`, { 适用学段: '初中', 适用年级: '初二',
      教材版本: '人教版', 课程名称: name, 知识点名称: name }));
  const data = snapshot(rows);
  for (const grade of ['初二', '初中']) {
    for (const name of ['三角形三边关系', '三角形的三边关系']) {
      const result = catalogs().match(grade, [...point(name), ...point('等腰三角形的性质')], data, '人教版');
      assert.deepEqual(result.matches.map(c => c.title), ['三角形的三边关系', '等腰三角形']);
      assert.ok(catalogs().match(grade, point(name), data).matches.every(c => !c.title.includes('特殊直角')));
    }
  }
  assert.equal(catalogs().match('初二', point('特殊直角三角形的三边关系'), data).matches[0].title,
    '特殊直角三角形的三边关系');
});

test('all directories load concurrently, coalesce, read past 20 pages and preserve other tables after failure', async () => {
  process.env.BITABLE_ALL_COURSE_TABLES = JSON.stringify({ 小学: 'tblPrimary', 初中: 'tblJunior', 高中: 'tblSenior' });
  const calls = { tblPrimary: 0, tblJunior: 0, tblSenior: 0 };
  let time = 0; let fail = false;
  const api = { request: async (_method, url, _data, params) => {
    const table = url.split('/').at(-2); calls[table]++;
    if (table === 'tblPrimary') return { total: 0, has_more: false };
    if (table === 'tblSenior') { if (fail) throw new Error('offline'); return { items: [record('recSenior')] }; }
    const page = Number(params.page_token || 0);
    return { items: [record(`recPage${page}`)], has_more: page < 24, page_token: String(page + 1) };
  } };
  const catalog = new AllCourseCatalog(api, () => time);
  const [a, b] = await Promise.all([catalog.read(), catalog.read()]);
  assert.deepEqual(a, b); assert.equal(a.courses.length, 26); assert.equal(calls.tblJunior, 25);
  await catalog.read(); assert.equal(calls.tblJunior, 25);
  time = 600001; fail = true;
  const partial = await catalog.read(); assert.equal(partial.courses.length, 25); assert.equal(partial.failed, true);
});

test('bad table configuration and pagination surface as unavailable without leaking partial results', async () => {
  for (const config of ['invalid', '{"unknown":"tblX"}', '{"高中":"../escape"}']) {
    process.env.BITABLE_ALL_COURSE_TABLES = config;
    assert.equal((await new AllCourseCatalog({ request: async () => { throw new Error('should not query'); } }).read()).failed, true);
  }
  process.env.BITABLE_ALL_COURSE_TABLES = '{"高中":"tblHigh"}';
  const catalog = new AllCourseCatalog({ request: async () => ({ items: [record('recA')], has_more: true, page_token: 'same' }) });
  assert.deepEqual(await catalog.read(), { courses: [], failed: true });
});

test('book and region are retained in the compact model context while source identifiers stay out', () => {
  const course = catalogs().match('高一', point('集合与元素'), snapshot([record('recA')])).matches[0];
  const context = coursePromptData([course])[0];
  assert.equal(context.book, '必修第一册'); assert.equal(context.grade, '高中');
  assert.ok(!('sourceUrl' in context));
});
