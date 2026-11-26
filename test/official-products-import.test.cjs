require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildProducts } = require('../scripts/official-products-import.cjs');
const { productRows } = require('./product-fixtures.cjs');
const { parseCapability } = require('../server/modules/diagnosis-gateway/product-capability-catalog');
const { eligibleCapabilities } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');
function source(id, name, overrides = {}) {
  return { recordId: id, fields: { '文本': name, '课程归属': ['同步课'], '学段': ['初中'],
    '学科': ['数学'], '价格': 498, '时限': ['12个月'], '内容付费板块': ['教材同步'], ...overrides } };
}
test('official product names are preserved; source service relations are resolved without inferring universal free access', () => {
  const row = source('recMath', '初中数学同步课', { '赠送服务': [{ id: 'recAI' }] });
  const result = buildProducts([row], [{ recordId: 'recAI', fields: { '文本': 'AI私教' } }], productRows);
  const fields = result.records[0].fields;
  assert.equal(fields['产品名称'], '初中数学同步课');
  assert.equal(fields['类别'], '产品');
  assert.equal(fields['参考价格'], 498);
  assert.match(fields['使用边界'], /源表关联辅助功能\/服务：AI私教/u);
  assert.doesNotMatch(fields['使用边界'], /所有.*免费|不限次|保证提分/u);
  assert.match(fields['来源链接'], /record=recMath/u);
  assert.ok(!('内容观看条件' in fields)); assert.ok(!('权益说明' in fields));
  assert.ok(parseCapability({ recordId: 'recDestination', fields }));
});
test('same-name bundle variants retain grade and term and cannot leak across grades', () => {
  const rows = [source('recG7', '初中同步培优课', { '课程归属': ['推荐课包'], '推荐适用情况': '新七年级', '时限': ['2029.6.30到期'] }),
    source('recG8', '初中同步培优课', { '课程归属': ['推荐课包'], '推荐适用情况': '新八年级', '时限': ['2028.6.30到期'] })];
  const result = buildProducts(rows, [], productRows);
  const parsed = result.records.map((r, i) => parseCapability({ recordId: 'recDest' + i, fields: r.fields }));
  assert.equal(new Set(parsed.map(p => p.name)).size, 2);
  assert.equal(eligibleCapabilities('初二', ['数学'], parsed).length, 1);
  assert.match(eligibleCapabilities('初二', ['数学'], parsed)[0].name, /新八年级/u);
  assert.equal(eligibleCapabilities('初二', ['物理'], parsed).length, 0);
});
test('high-school math enrichment restriction survives import; other sciences remain available to all high-school grades', () => {
  const rows = [source('recSeniorMath', '高中数学一轮复习培优课', { '课程归属': ['培优课'], '学段': ['高中'] }),
    source('recSeniorPhysics', '高中物理一轮复习培优课', { '课程归属': ['培优课'], '学段': ['高中'], '学科': ['物理'] })];
  const parsed = buildProducts(rows, [], productRows).records.map(r => parseCapability({ recordId: 'recD', fields: r.fields }));
  assert.equal(eligibleCapabilities('高一', ['数学'], parsed).length, 0);
  assert.equal(eligibleCapabilities('高三', ['数学'], parsed).length, 1);
  assert.equal(eligibleCapabilities('高一', ['物理'], parsed).length, 1);
});
test('unsupported commercial categories and subject scopes are excluded; dangling links and unknown restrictions block writes', () => {
  const skipped = buildProducts([source('recHardware', '学习机', { '课程归属': ['学习机'] }),
    source('recVocational', '中职数学', { '学段': ['中职'] }),
    source('recPolitics', '高中思想政治同步课', { '学段': ['高中'], '学科': ['政治'] })], [], productRows);
  assert.equal(skipped.records.length, 0); assert.equal(skipped.skipped.length, 3);
  assert.throws(() => buildProducts([source('recBadLink', '初中数学同步课', { '赠送服务': [{ id: 'recMissing' }] })], [], productRows), /Unresolved/u);
  assert.throws(() => buildProducts([source('recUnknownGrade', '初中同步培优课', { '推荐适用情况': '仅九年级特殊班' })], [], productRows), /audience/u);
});
