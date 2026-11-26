require('reflect-metadata');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { CourseCatalogs, parseJuniorCourses, rankMathKnowledge } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');

const point = (subject, name) => ({ subject, name, keywords: [] });
const row = (id, subject, title, fields = {}) => ({ record_id: id, fields: {
  '学科': subject, '课程名称': title, '知识点名称': title, '审核状态': '已核对',
  '适用年级': '初二', '课程类型': '重难点培优', '教材版本': '人教版', ...fields,
} });
const parse = rows => parseJuniorCourses(rows, 'baseTest', 'tblJunior');
const keys = ['BITABLE_APP_TOKEN', 'BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID', 'BITABLE_SENIOR_KNOWLEDGE_TABLE_ID'];
let before;
beforeEach(() => {
  before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { BITABLE_APP_TOKEN: 'baseTest', BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID: 'tblJunior',
    BITABLE_SENIOR_KNOWLEDGE_TABLE_ID: 'tblSenior' });
});
afterEach(() => {
  for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
});

test('junior directories match six subjects within their recorded grades and include source references', () => {
  for (const [subject, title] of [['物理', '欧姆定律'], ['化学', '质量守恒定律'], ['生物', '光合作用'],
    ['英语', '定语从句'], ['语文', '说明文阅读'], ['地理', '经纬网定位']]) {
    const courses = parse([row('recOne', subject, title)]);
    for (const grade of ['初二', '八年级', '八上']) {
      const result = rankMathKnowledge(grade, [point(subject, title)], courses, '', subject);
      assert.equal(result[0].match.title, title); assert.equal(result[0].match.subject, subject);
      assert.match(result[0].match.sourceUrl, /table=tblJunior&record=recOne$/u);
    }
    for (const grade of ['初一', '初三', '高一', '高三', '二年级', '初中']) {
      assert.equal(rankMathKnowledge(grade, [point(subject, title)], courses, '', subject).length, 0);
    }
    assert.equal(rankMathKnowledge('初二', [point('其他', title)], courses, '', subject).length, 0);
  }
});

test('junior parsing excludes pending, withdrawn, unknown and mixed-stage grade records', () => {
  const courses = parse([
    row('recGood', '地理', '经纬网定位', { '适用年级': '初一、初二' }),
    row('recPending', '地理', '经纬网定位', { '审核状态': '待核实' }),
    row('recOld', '地理', '经纬网定位', { '审核状态': '停用' }),
    row('recMixed', '地理', '经纬网定位', { '适用年级': '初二、高一' }),
    row('recUnknown', '地理', '经纬网定位', { '适用年级': '初中' }),
    row('recSenior', '地理', '经纬网定位', { '适用年级': '高一' }),
  ]);
  assert.equal(courses.length, 1);
  assert.equal(rankMathKnowledge('初一', [point('地理', '经纬网定位')], courses, '', '地理').length, 1);
  assert.equal(rankMathKnowledge('初三', [point('地理', '经纬网定位')], courses, '', '地理').length, 0);
});

test('explicit textbook edition and generic-term rejection prevent unrelated recommendations', () => {
  const courses = parse([row('recA', '生物', '光合作用实验', { '教材版本': '人教版' }),
    row('recB', '生物', '光合作用实验', { '教材版本': '北师大版' })]);
  const result = rankMathKnowledge('初二', [point('生物', '光合作用')], courses, '北师大版', '生物');
  assert.equal(result.length, 1); assert.equal(result[0].match.edition, '北师大版');
  for (const word of ['生物', '实验', '中考', '培优', '总复习']) {
    assert.equal(rankMathKnowledge('初二', [point('生物', word)], courses, '', '生物').length, 0);
  }
});

test('junior and senior sources coalesce, remain separate and share the global result limit', async () => {
  const calls = { junior: 0, senior: 0 };
  const catalogs = new CourseCatalogs({ request: async (method, path) => {
    const junior = path.includes('tblJunior'); calls[junior ? 'junior' : 'senior']++;
    return { items: [row(junior ? 'recJ' : 'recS', '化学', '质量守恒定律', { '适用年级': junior ? '初三' : '高一' }),
      ...(junior ? [row('recGeo', '地理', '经纬网定位', { '适用年级': '初三' }),
        row('recEnglish', '英语', '定语从句', { '适用年级': '初三' })] : [])] };
  } });
  const [a, b] = await Promise.all([catalogs.read(['化学']), catalogs.read(['地理'])]);
  assert.equal(a.junior.length, 1); assert.equal(b.junior.length, 1);
  assert.deepEqual(calls, { junior: 1, senior: 1 });
  for (const grade of ['初三', '高一']) {
    const result = catalogs.match(grade, [point('化学', '质量守恒定律')], a);
    assert.equal(result.matches.length, 1); assert.equal(result.matches[0].grade, grade);
    assert.equal(result.note, '');
  }
  const snapshot = await catalogs.read(['化学', '地理', '英语']);
  const result = catalogs.match('初三', [point('化学', '质量守恒定律'), point('地理', '经纬网定位'),
    point('英语', '定语从句')], snapshot);
  assert.equal(result.matches.length, 2); assert.deepEqual(calls, { junior: 1, senior: 1 });
});

test('five-four curricula require an explicit edition and normalize edition punctuation', () => {
  const courses = parse([row('rec54', '化学', '蜡烛燃烧及其探究改进实验题', {
    '教材版本': '鲁教(五四制)', '适用年级': '初二',
  })]);
  const points = [point('化学', '蜡烛燃烧')];
  assert.equal(rankMathKnowledge('初二', points, courses, '', '化学').length, 0);
  assert.equal(rankMathKnowledge('初二', points, courses, '鲁教（五四制）', '化学').length, 1);
  assert.equal(rankMathKnowledge('初二', points, courses, '人教版', '化学').length, 0);
  const physics = parse([row('rec54physics', '物理', '后视镜问题', { '教材版本': '沪科版（五·四学制）' })]);
  assert.equal(rankMathKnowledge('初二', [point('物理', '后视镜问题')], physics, '', '物理').length, 0);
  assert.equal(rankMathKnowledge('初二', [point('物理', '后视镜问题')], physics, '沪科五四制', '物理').length, 1);
});

test('junior source failures preserve existing senior and physics matches', async () => {
  const catalogs = new CourseCatalogs({ request: async (method, path) => {
    if (path.includes('tblJunior')) throw Error('private upstream');
    if (path.includes('tblSenior')) return { items: [row('recSenior', '化学', '可逆反应', { '适用年级': '高一' })] };
    return { items: [{ record_id: 'recPhysics', fields: { '视频名': '欧姆定律', '年级': '八上' } }] };
  } });
  const snapshot = await catalogs.read(['化学', '物理']);
  assert.equal(catalogs.match('高一', [point('化学', '可逆反应')], snapshot).matches.length, 1);
  assert.equal(catalogs.match('初二', [point('物理', '欧姆定律')], snapshot).matches.length, 1);
  assert.doesNotMatch(catalogs.match('初三', [point('化学', '质量守恒定律')], snapshot).note, /private/u);
});
