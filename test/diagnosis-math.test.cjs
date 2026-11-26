require('reflect-metadata');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MathCourseCatalog, CourseCatalogs, parseMathCourses, rankMathKnowledge } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
const row = (id, fields = {}) => ({ record_id: id, fields: { '课程名称': '第13讲 因式分解', '学科': '数学',
  '适用年级': '初三', '教材版本': '通用版', '课程类型': '新中考一轮', '审核状态': '已核对', '检索关键词': '因式分解\n公式法分解因式', ...fields } });
const point = (name, subject = '数学') => ({ name, subject, keywords: [] });
const parse = rows => parseMathCourses(rows, 'baseTest', 'tblMath');
beforeEach(() => { process.env.BITABLE_APP_TOKEN = 'baseTest'; process.env.BITABLE_MATH_TABLE_ID = 'tblMath';
  delete process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID; });

test('directory node labels return real course names and strictly isolate junior grades', () => {
  const items = parse(['初一', '初二', '初三'].map((grade, i) => row(`recGrade${i}`, {
    '适用年级': grade, '知识点名称': '等积变形', '课程名称': `${grade}三角形面积训练`, '检索关键词': '',
    '课程类型': '重难点培优·重难点题型',
  })));
  for (const [query, expected] of [['初一', '初一'], ['七上', '初一'], ['八年级下学期', '初二'], ['中考', '初三']]) {
    const matches = rankMathKnowledge(query, [point('等积变形')], items);
    assert.equal(matches.length, 1); assert.equal(matches[0].match.grade, expected);
    assert.equal(matches[0].match.title, `${expected}三角形面积训练`);
  }
  for (const grade of ['一年级', '高一', '初一/初二']) assert.equal(rankMathKnowledge(grade, [point('等积变形')], items).length, 0);
  assert.equal(parse([row('recEmpty', { '课程名称': '', '知识点名称': '等积变形' })]).length, 0);
});

test('both math sources cache independently and a failed source preserves the other', async () => {
  process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID = 'tblKnowledge';
  for (const failing of ['', 'tblMath', 'tblKnowledge']) {
    const calls = {};
    const catalogs = new CourseCatalogs({ request: async (method, path) => {
      const table = path.includes('tblKnowledge') ? 'tblKnowledge' : 'tblMath';
      calls[table] = (calls[table] || 0) + 1;
      if (table === failing) throw new Error('private denial');
      return { items: [row('rec' + table, { '课程名称': table + '因式分解' })] };
    } });
    const [a, b] = await Promise.all([catalogs.read(['数学']), catalogs.read(['数学'])]);
    assert.deepEqual(a, b); assert.equal(a.math.length, failing ? 1 : 2);
    assert.equal(calls.tblMath, 1); assert.equal(calls.tblKnowledge, 1);
    await catalogs.read(['数学']);
    assert.equal(calls.tblMath, failing === 'tblMath' ? 2 : 1);
    assert.equal(calls.tblKnowledge, failing === 'tblKnowledge' ? 2 : 1);
    const result = catalogs.match('初三', [point('因式分解')], a);
    assert.equal(result.matches.length, failing ? 1 : 2);
    assert.doesNotMatch(result.note, /private denial/u);
  }
});

test('math catalog excludes unreviewed, wrong subject/grade and invalid provenance', () => {
  const items = parse([row('recValid'), row('recPending', { '审核状态': '待核实' }),
    row('recSubject', { '学科': '物理' }), row('recGrade', { '适用年级': '大学' }), row('../escape')]);
  assert.equal(items.length, 1); assert.match(items[0].sourceUrl, /table=tblMath&record=recValid$/u);
  assert.throws(() => parseMathCourses([row('recValid')], 'baseTest/evil', 'tblMath'));
});
test('math matches actual labels, honors round, and never maps other stages or broad terms', () => {
  const items = parse([row('recOne'), row('recTwo', { '课程名称': '第26讲 因式分解进阶', '课程类型': '新中考二轮' })]);
  assert.equal(rankMathKnowledge('初三', [point('公式法分解因式')], items)[0].match.title, '第13讲 因式分解');
  assert.equal(rankMathKnowledge('九年级', [point('因式分解')], items, '正在二轮复习')[0].match.title, '第26讲 因式分解进阶');
  for (const grade of ['初一', '初二', '高三', '三年级', '', '高三/初三']) {
    assert.deepEqual(rankMathKnowledge(grade, [point('因式分解')], items), []);
  }
  for (const name of ['数学', '函数', '计算', '概念', '光合作用']) assert.deepEqual(rankMathKnowledge('初三', [point(name)], items), []);
  assert.deepEqual(rankMathKnowledge('初三', [point('因式分解', '物理')], items), []);
});
test('math matching preserves mathematical numbers and distinguishes one-step from multi-step concepts', () => {
  const items = parse([row('recTwo', { '课程名称': '第1讲 y=x2', '检索关键词': '' }),
    row('recThree', { '课程名称': '第2讲 y=x3', '检索关键词': '' })]);
  assert.equal(rankMathKnowledge('初三', [point('y=x3')], items)[0].match.title, '第2讲 y=x3');
});
test('specific textbook revisions do not also select the shorter edition name', () => {
  const items = parse([
    row('recOld', { '适用年级': '四年级下册', '教材版本': '人教版', '课程名称': '小数的大小比较', '检索关键词': '' }),
    row('recNew', { '适用年级': '三年级下册', '教材版本': '人教版（2024）', '课程名称': '小数的大小比较', '检索关键词': '' }),
  ]);
  const query = [point('小数的大小比较')];
  for (const note of ['人教版（2024）', '人教版(2024)', '人教版2024']) {
    assert.equal(rankMathKnowledge('四年级', query, items, note).length, 0);
    assert.equal(rankMathKnowledge('三年级', query, items, note)[0].match.edition, '人教版（2024）');
  }
  for (const note of ['', '人教版', '人教版及人教版（2024）', '人教版（2024）及人教版']) {
    assert.equal(rankMathKnowledge('四年级', query, items, note)[0].match.edition, '人教版');
  }
});
test('auxiliary keyword fragments cannot recommend an unrelated application lesson', () => {
  const items = parse([
    row('recDecimal', { '适用年级': '四年级下册', '课程名称': '小数的大小比较', '检索关键词': '' }),
    row('recDistance', { '适用年级': '四年级下册', '课程名称': '根据倍数关系求全程', '检索关键词': '' }),
    row('recLowerGrade', { '适用年级': '二年级上册', '课程名称': '乘加和乘减', '检索关键词': '乘加混合运算应用' }),
  ]);
  const points = [point('小数的大小比较'),
    { ...point('乘加混合运算应用'), keywords: ['倍数关系', '两步计算'] }];
  assert.deepEqual(rankMathKnowledge('四年级', points, items).map(r => r.match.title), ['小数的大小比较']);
  assert.equal(rankMathKnowledge('四年级', [point('倍数关系求全程')], items)[0].match.title, '根据倍数关系求全程');
  const aliases = parse([row('recAlias', { '适用年级': '四年级下册', '课程名称': '对应课程', '检索关键词': '两步计算' })]);
  assert.equal(rankMathKnowledge('四年级', [points[1]], aliases)[0].match.title, '对应课程');
});
test('all twelve math grades match only their own records, including elementary and senior aliases', () => {
  const grades = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'];
  const items = parse(grades.map((grade, i) => row(`recAll${i}`, {
    '适用年级': grade, '课程名称': `${grade}数学目录样例`, '知识点名称': '相同检索词', '检索关键词': '',
  })));
  assert.equal(items.length, 12);
  for (const grade of grades) {
    const matches = rankMathKnowledge(grade, [point('相同检索词')], items);
    assert.equal(matches.length, 1); assert.equal(matches[0].match.grade, grade);
  }
  for (const [input, expected] of [['小学三年级上册', '三年级'], ['6年级下', '六年级'],
    ['高中一年级', '高一'], ['11年级下学期', '高二'], ['高考', '高三']]) {
    assert.equal(rankMathKnowledge(input, [point('相同检索词')], items)[0].match.grade, expected);
  }
  for (const grade of ['小学', '高中', '必修一', '高一/高二', '十三年级', '一年级至六年级']) {
    assert.equal(rankMathKnowledge(grade, [point('相同检索词')], items).length, 0);
  }
});
test('missing grade data is reported without claiming elementary or senior data has been connected', () => {
  const catalogs = new CourseCatalogs({ request: async () => { throw new Error('unused'); } });
  const snapshot = { math: parse([row('recJunior')]), physics: [], failed: [] };
  for (const grade of ['一年级', '高三']) {
    const result = catalogs.match(grade, [point('因式分解')], snapshot);
    assert.deepEqual(result.matches, []); assert.match(result.note, /当前年级暂无已核对/u);
  }
  assert.match(catalogs.match('高中', [point('因式分解')], snapshot).note, /当前学段未找到/u);
});
test('math cache coalesces, paginates and retries failed refresh without retaining partial data', async () => {
  let calls = 0; let time = 0; let fail = false;
  const catalog = new MathCourseCatalog({ request: async (method, path, body, query) => {
    calls++; assert.match(path, /tblMath/u);
    if (!query.page_token) return { items: [row('recFirst')], has_more: true, page_token: 'next' };
    if (fail) throw new Error('denied');
    return { items: [row('recSecond')], has_more: false };
  } }, () => time);
  const [a, b] = await Promise.all([catalog.read(), catalog.read()]);
  assert.equal(a.length, 2); assert.deepEqual(a, b); assert.equal(calls, 2);
  await catalog.read(); assert.equal(calls, 2);
  time = 600001; fail = true; await assert.rejects(catalog.read());
  fail = false; assert.equal((await catalog.read()).length, 2); assert.equal(calls, 6);
});
test('math pagination rejects missing/repeating cursor and invalid pages', async () => {
  for (const result of [{ items: [], has_more: true }, { items: [], has_more: true, page_token: 'repeat' }, {}]) {
    const catalog = new MathCourseCatalog({ request: async () => result });
    await assert.rejects(catalog.read());
  }
});
test('mixed-subject matching has one global two-course limit and a failed catalog preserves other results', async () => {
  const catalogs = new CourseCatalogs({ request: async (method, path) => {
    if (path.includes('YdJS')) throw new Error('private upstream');
    return { items: [row('recOne'), row('recCopy'), row('recOther', { '课程名称': '第1讲 中位数', '检索关键词': '中位数' }),
      row('recThird', { '课程名称': '第2讲 科学记数法', '检索关键词': '科学记数法' })], has_more: false };
  } });
  const data = await catalogs.read(['数学', '物理']);
  const result = catalogs.match('初三', [point('因式分解'), point('中位数'), point('科学记数法'), point('浮力', '物理')], data);
  assert.equal(result.matches.length, 2); assert.equal(new Set(result.matches.map(c => c.title)).size, 2);
  assert.match(result.note, /物理课程目录读取失败/u); assert.doesNotMatch(result.note, /private upstream/u);
});
