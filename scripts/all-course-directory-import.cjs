const assert = require('node:assert/strict');
const path = require('node:path');
const { feishu, readJson, writeJson } = require('./materials-import.cjs');
const { parseAllCourses } = require('../server/modules/diagnosis-gateway/all-course-catalog');
const { CourseCatalogs } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
const SOURCE = 'https://guanghe.feishu.cn/wiki/IWxCwfiU5iZ50bkiqbmchaQSnIc';
const STAGES = ['小学', '初中', '高中'];
async function readRequest(method, url, data, params) {
  for (let attempt = 0; ; attempt++) {
    try { return await feishu.request(method, url, data, params); }
    catch (error) { if (attempt >= 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); }
  }
}
async function rows(table) {
  const result = []; const seen = new Set(); let token = '';
  for (let page = 0; page < 60; page++) {
    const data = await readRequest('GET', `${feishu.tablePath(table)}/records`, undefined,
      { page_size: '500', ...(token ? { page_token: token } : {}) });
    if (!data.items && data.total === 0 && !data.has_more) return result;
    assert.ok(Array.isArray(data.items));
    const { normalizeFields } = require('../server/modules/diagnosis-gateway/feishu.service');
    result.push(...data.items.map(r => ({ recordId: r.record_id, fields: normalizeFields(r.fields) })));
    if (!data.has_more) return result;
    assert.ok(data.page_token && !seen.has(data.page_token)); seen.add(data.page_token); token = data.page_token;
  }
  throw new Error('Directory exceeds bounded read');
}
function sameFields(stored, expected) {
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(k => [k, stored[k] ?? ''])), expected,
    `Source metadata differs for ${expected['目录ID']}; preserve manual changes`);
}
function validate(data) {
  assert.equal(data.source, SOURCE); assert.equal(data.records.length, 19890);
  assert.equal(data.inventory.length, 60); assert.equal(data.reused.length, 1938);
  const parsed = parseAllCourses(data.records.map((fields, i) => ({ record_id: `recCheck${i}`, fields })), 'baseTest', 'tblAll');
  assert.equal(parsed.length, data.records.length);
  assert.equal(new Set(data.records.map(r => r['目录ID'])).size, data.records.length);
  for (const r of data.records) {
    assert.match(r['目录ID'], /^all_q3_[a-f0-9]{24}$/u);
    assert.ok(r['原目录链接'].startsWith(SOURCE + '#'));
    assert.ok(STAGES.includes(r['适用学段']) && r['来源工作簿'].endsWith('.xlsx'));
    assert.equal(r['来源工作表'], '已发布目录'); assert.ok(Number(r['来源行']) >= 2);
    assert.equal(r['审核状态'], '已核对');
  }
  return parsed;
}
function verifyMatching(parsed) {
  const catalog = new CourseCatalogs(feishu);
  const snapshot = { math: [], physics: [], all: parsed, failed: [] };
  const cases = [];
  for (const stage of STAGES) {
    const subjects = [...new Set(parsed.filter(c => c.grade === stage || c.eligibleGrades.some(g =>
      stage === '小学' ? g <= 6 : stage === '初中' ? g >= 7 && g <= 9 : g >= 10)).map(c => c.subject))];
    for (const subject of subjects) {
      const candidates = parsed.filter(c => c.subject === subject && c.eligibleGrades.every(g =>
        stage === '小学' ? g <= 6 : stage === '初中' ? g >= 7 && g <= 9 : g >= 10));
      const row = candidates.find(c => c.title.length >= 4 && !c.region && !/导学|介绍|课前/u.test(c.title));
      assert.ok(row);
      const result = catalog.match(stage, [{ subject, name: row.title, keywords: [] }], snapshot);
      assert.ok(result.matches.some(c => c.title === row.title), JSON.stringify({ stage, subject, title: row.title, result }));
      assert.ok(result.matches.every(c => c.subject === subject));
      cases.push({ stage, subject, query: row.title, matches: result.matches });
    }
  }
  const point = name => [{ subject: '数学', name, keywords: [] }];
  const highThree = parsed.find(c => c.subject === '数学' && c.grade === '高三' && c.title.includes('集合必备'));
  assert.ok(highThree);
  const only = { ...snapshot, all: [highThree] };
  assert.equal(catalog.match('高一', point(highThree.title), only).matches.length, 0);
  assert.equal(catalog.match('高二', point(highThree.title), only).matches.length, 0);
  assert.equal(catalog.match('高三', point(highThree.title), only).matches.length, 1);
  const regional = parsed.filter(c => c.region && c.subject === '数学');
  const hubei = regional.find(c => c.region === '湖北省');
  const regions = catalog.match('初三', point(hubei.title), { ...snapshot, all: regional }, '湖北省');
  assert.ok(regions.matches.length > 0 && regions.matches.every(c => c.region === '湖北省'));
  const unknown = catalog.match('初三', point(hubei.title), { ...snapshot, all: regional });
  assert.ok(unknown.matches.length > 0 && unknown.matches.every(c => c.region === '本地化'));
  const times = [];
  for (let i = 0; i < 120; i++) {
    const at = performance.now(); catalog.match('初中', point('一元二次方程'), snapshot); times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[113] <= 200, `Warm matching P95 ${times[113]}ms`);
  return { cases, gradeRestriction: true, regionRestriction: true, warmP95Ms: times[113] };
}
async function main() {
  const [input, mode = '--plan'] = process.argv.slice(2);
  assert.ok(input && ['--plan', '--apply', '--verify'].includes(mode));
  const data = await readJson(input); const parsed = validate(data);
  const checks = verifyMatching(parsed);
  const dir = path.dirname(input); const stateFile = path.join(dir, 'tables.json');
  const state = await readJson(stateFile).catch(e => { if (e.code !== 'ENOENT') throw e; return {}; });
  const primary = await rows('tbly3Xg5AEdFRIm4');
  const reused = new Map(primary.map(r => [r.fields['目录ID'], r]));
  for (const row of data.reused) {
    const record = reused.get(row['目录ID']);
    assert.ok(record); assert.equal(record.fields['课程名称'], row['课程名称']);
    assert.equal(record.fields['审核状态'], '已核对');
  }
  const tablePath = `/bitable/v1/apps/${process.env.BITABLE_APP_TOKEN}/tables`;
  const listed = await readRequest('GET', tablePath, undefined, { page_size: '100' });
  assert.ok(!listed.has_more, 'Unexpected table count');
  const plans = [];
  for (const stage of STAGES) {
    const expected = data.records.filter(r => r['适用学段'] === stage);
    const name = `${stage}全学科课程目录（2026Q3）`;
    let table = state[stage] || listed.items?.find(t => t.name === name)?.table_id;
    if (!table && mode === '--apply') {
      const created = await feishu.request('POST', tablePath, { table: { name, default_view_name: '全部课程',
        fields: Object.keys(expected[0]).map(field_name => ({ field_name, type: 1 })) } });
      table = created.table_id; assert.match(table, /^tbl[A-Za-z0-9]+$/u);
    }
    if (table) { state[stage] = table; await writeJson(stateFile, state); }
    const existing = table ? await rows(table) : [];
    const ids = new Map(existing.map(r => [r.fields['目录ID'], r]));
    assert.equal(ids.size, existing.length, 'Duplicate record identities');
    for (const row of expected) if (ids.has(row['目录ID'])) sameFields(ids.get(row['目录ID']).fields, row);
    const creates = expected.filter(row => !ids.has(row['目录ID']));
    plans.push({ stage, table: table || '', name, sourceRows: expected.length, creates: creates.length, existing: existing.length });
    if (mode === '--apply') {
      for (let i = 0; i < creates.length; i += 200) {
        await feishu.request('POST', `${feishu.tablePath(table)}/records/batch_create`,
          { records: creates.slice(i, i + 200).map(fields => ({ fields })) });
        console.log(JSON.stringify({ stage, created: Math.min(i + 200, creates.length), total: creates.length }));
      }
    }
    if (mode !== '--plan') {
      assert.ok(table); const after = await rows(table);
      const actual = new Map(after.map(r => [r.fields['目录ID'], r]));
      assert.equal(actual.size, after.length);
      for (const row of expected) { assert.ok(actual.has(row['目录ID'])); sameFields(actual.get(row['目录ID']).fields, row); }
      for (const before of existing) assert.deepEqual(actual.get(before.fields['目录ID'])?.fields, before.fields);
      const live = parseAllCourses(after.map(r => ({ record_id: r.recordId, fields: r.fields })), process.env.BITABLE_APP_TOKEN, table);
      assert.equal(live.length, expected.length);
      await writeJson(path.join(dir, `${stage}-live.json`), live);
    }
  }
  const result = { at: new Date().toISOString(), mode, counts: data.counts, tables: plans, checks,
    urls: Object.fromEntries(Object.entries(state).map(([stage, table]) =>
      [stage, `https://guanghe.feishu.cn/base/${process.env.BITABLE_APP_TOKEN}?table=${table}`])) };
  await writeJson(path.join(dir, mode === '--plan' ? 'plan.json' : 'verification.json'), result);
  console.log(JSON.stringify({ ...result, checks: { ...checks, cases: checks.cases.map(c => ({ stage: c.stage, subject: c.subject, query: c.query })) } }));
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
