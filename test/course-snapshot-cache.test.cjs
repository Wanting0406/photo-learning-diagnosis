const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CourseSnapshotCache } = require('../server/modules/diagnosis-gateway/course-snapshot-cache');
const { CourseCatalogs, MathCourseCatalog } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('cold readers coalesce; background refresh keeps a complete warm snapshot and atomically replaces it', async () => {
  let now = 0; let reads = 0; let resolve;
  const cache = new CourseSnapshotCache(() => { reads++; return new Promise(r => { resolve = r; }); }, () => now);
  const a = cache.read(); const b = cache.read(); await tick(); assert.equal(reads, 1);
  resolve(['old']); assert.deepEqual(await a, ['old']); assert.deepEqual(await b, ['old']);
  now = 300001;
  assert.deepEqual(await cache.read(), ['old']); assert.deepEqual(await cache.read(), ['old']);
  assert.equal(reads, 2); resolve(['new']); await tick();
  assert.deepEqual(await cache.read(), ['new']); assert.equal(reads, 2);
});

test('failed background refresh backs off, cannot extend validity, and hard expiry never returns old data', async () => {
  let now = 0; let reads = 0; let fail = false;
  const cache = new CourseSnapshotCache(async () => { reads++; if (fail) throw new Error('offline'); return ['complete']; }, () => now);
  await cache.read(); fail = true; now = 300001;
  assert.deepEqual(await cache.read(), ['complete']); await tick();
  for (let i = 0; i < 10; i++) await cache.read(); assert.equal(reads, 2);
  now = 330002; await cache.read(); await tick(); assert.equal(reads, 3);
  now = 600000; await assert.rejects(cache.read(), /offline/);
  fail = false; assert.deepEqual(await cache.read(), ['complete']);
});

test('a failed second page never replaces the previous complete catalog, including after expiry', async () => {
  process.env.BITABLE_APP_TOKEN = 'baseTest'; process.env.BITABLE_MATH_TABLE_ID = 'tblMath';
  let now = 0; let fail = false;
  const record = { record_id: 'recCourse', fields: { 学科: '数学', 适用年级: '初二', 课程名称: '三角形', 审核状态: '已核对' } };
  const catalog = new MathCourseCatalog({ request: async (_method, _path, _data, params) => {
    if (params.page_token) { if (fail) throw new Error('page unavailable'); return { items: [] }; }
    return { items: [record], has_more: true, page_token: 'next' };
  } }, () => now);
  assert.equal((await catalog.read()).length, 1); fail = true; now = 300001;
  assert.equal((await catalog.read()).length, 1); await tick();
  now = 600000; await assert.rejects(catalog.read(), /page unavailable/);
});

test('report modules share catalog reads for one Feishu client, while other clients stay isolated', async () => {
  process.env.BITABLE_APP_TOKEN = 'baseTest'; process.env.BITABLE_MATH_TABLE_ID = 'tblMath';
  delete process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID;
  let reads = 0;
  const feishu = { request: async () => { reads++; await tick(); return { items: [] }; } };
  const first = new CourseCatalogs(feishu); const second = new CourseCatalogs(feishu);
  await Promise.all([first.read(['数学']), second.read(['数学'])]); assert.equal(reads, 1);
  await second.read(['数学']); assert.equal(reads, 1);
  await new CourseCatalogs({ request: feishu.request }).read(['数学']); assert.equal(reads, 2);
});
