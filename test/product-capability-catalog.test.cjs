require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ProductCapabilityCatalog, parseCapability, linkedProductIds } = require('../server/modules/diagnosis-gateway/product-capability-catalog');
const { normalizeFields } = require('../server/modules/diagnosis-gateway/feishu.service');
const { eligibleCapabilities } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');
const { parseProductMaterial, matchProductMaterials } = require('../server/modules/diagnosis-gateway/product-materials');
const { productRows } = require('./product-fixtures.cjs');
test('category controls product versus selling point; removed entitlement fields and legacy labels are ignored', () => {
  const { capabilityBoundary, ANALYSIS_PROMPT, PRODUCT_ACCESS_RULE } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');
  const { LEARNING_PLAN_PROMPT } = require('../server/modules/diagnosis-gateway/learning-plan.prompts');
  const row = structuredClone(productRows[0]);
  Object.assign(row.fields, { '原会员标记（历史参考）': ['免费'],
    '功能使用说明': '功能可直接使用', '类别': '卖点', '内容观看条件': '过时字段', '权益说明': '过时说明' });
  const product = parseCapability(row);
  assert.equal(product.functionAccess, '功能可直接使用');
  assert.equal(product.category, '卖点');
  assert.match(capabilityBoundary(product), /功能使用：功能可直接使用/u);
  assert.doesNotMatch(JSON.stringify(product) + capabilityBoundary(product), /过时字段|过时说明/u);
  row.fields['原会员标记（历史参考）'] = ['全科会员'];
  assert.deepEqual(parseCapability(row), product);
  row.fields['类别'] = '免费'; assert.equal(parseCapability(row), undefined);
  assert.ok(ANALYSIS_PROMPT.includes(PRODUCT_ACCESS_RULE));
  assert.match(LEARNING_PLAN_PROMPT, /卖点只辅助课程，不作独立付费产品/u);
  assert.match(LEARNING_PLAN_PROMPT, /遵守每项boundary.*不推断免费、会员权益、价格、包含关系或效果保证/u);
});
test('table edits replace product values; custom products and grade/subject restrictions participate without code edits', async () => {
  let now = 0; let reads = 0; let rows = structuredClone(productRows);
  const catalog = new ProductCapabilityCatalog({ listRecords: async () => {
    reads++; await new Promise(r => setTimeout(r, 2)); return { items: rows, pageToken: '' };
  } }, () => now);
  await Promise.all([catalog.read(), catalog.read()]); assert.equal(reads, 1);
  const first = rows[0]; first.fields['产品名称'] = '修改后的产品'; first.fields['适用年级'] = '高一、高二';
  first.fields['适用学段'] = ['高中']; first.fields['适用学科'] = ['物理'];
  const custom = structuredClone(first); custom.recordId = 'recNewProduct'; custom.fields['产品能力ID'] = '';
  custom.fields['产品名称'] = '新增专项产品'; rows.push(custom); rows[1].fields['启用状态'] = '停用';
  now = 60001; const products = await catalog.read();
  assert.equal(products[0].name, '修改后的产品');
  assert.ok(products.some(c => c.id === 'CAP-CUSTOM-recNewProduct'));
  assert.ok(!products.some(c => c.id === 'CAP-AI-02'));
  for (const [grade, subject] of [['高三', '物理'], ['高一', '数学'], ['初二', '物理']]) {
    assert.ok(!eligibleCapabilities(grade, [subject], products).some(c => c.id === first.fields['产品能力ID']));
  }
  assert.ok(eligibleCapabilities('高二', ['物理'], products).some(c => c.name === '修改后的产品'));
});
test('incomplete enabled rows, duplicate IDs and failed pages never resurrect the built-in library', async () => {
  for (const change of [{ '适用学段': [] }, { '适用学科': [] }, { '适用年级': '不限' }, { '作用说明': '' }]) {
    const row = { ...productRows[0], fields: { ...productRows[0].fields, ...change } };
    assert.equal(parseCapability(row), undefined);
    await assert.rejects(new ProductCapabilityCatalog({ listRecords: async () => ({ items: [row], pageToken: '' }) }).read());
  }
  await assert.rejects(new ProductCapabilityCatalog({ listRecords: async () => ({ items: [productRows[0], productRows[0]], pageToken: '' }) }).read());
  let calls = 0;
  const catalog = new ProductCapabilityCatalog({ listRecords: async () => {
    calls++; if (calls === 2) throw new Error('private upstream');
    return calls === 1 ? { items: [productRows[0]], pageToken: 'next' } : { items: [], pageToken: '' };
  } });
  await assert.rejects(catalog.read(), e => !e.message.includes('private upstream'));
  assert.deepEqual(await catalog.read(), []); assert.equal(calls, 3);
});
test('Feishu relationship rich text preserves record IDs and links survive product renames', () => {
  const custom = parseCapability({ recordId: 'recNewProduct', fields: { ...productRows[0].fields,
    '产品能力ID': '', '产品名称': '更名后的产品' } });
  const fields = normalizeFields({ '关联产品': [{ type: 'text', text: '旧产品名称', record_ids: ['recNewProduct'],
    table_id: 'products' }], '素材名称': [{ type: 'text', text: '新增宣传图' }] });
  assert.deepEqual(linkedProductIds(fields['关联产品']), ['recNewProduct']);
  assert.equal(fields['素材名称'], '新增宣传图');
  const row = { recordId: 'recNewPoster', fields: { ...fields, '适用学段': '初中', '适用学科': '数学',
    '审核状态': '已核对', '原图附件': [{ file_token: 'attachment' }], '产品能力ID': 'CAP-COURSE-01' } };
  const parsed = parseProductMaterial(row, [custom]);
  assert.equal(parsed.materialId, 'prod_recnewposter'); assert.deepEqual(parsed.capabilityIds, [custom.id]);
  const report = { grade: '初二', subjects: ['数学'], solutions: [{ capabilityId: custom.id }] };
  assert.equal(matchProductMaterials([parsed], report, [custom]).length, 1);
  const unlinked = parseProductMaterial({ ...row, fields: { ...row.fields, '关联产品': [] } }, [custom]);
  assert.deepEqual(unlinked.capabilityIds, []);
  assert.equal(matchProductMaterials([unlinked], report, [custom]).length, 0);
  assert.deepEqual(parseProductMaterial(row, []).capabilityIds, []);
});
