require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { HttpService } = require('@nestjs/axios');
const { FeishuService } = require('../server/modules/diagnosis-gateway/feishu.service');
const { productTableId, parseCapability, ProductCapabilityCatalog, linkedProductIds } = require('../server/modules/diagnosis-gateway/product-capability-catalog');
const { PRODUCT_CAPABILITIES, eligibleCapabilities } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');

const SOURCE_BASE = 'JTJZbdcNoa9qawsRAOecR0z2nGd';
const SOURCE_TABLE = 'tblKypBlapRltelO';
const SERVICE_TABLE = 'tbl35czcDFunft9g';
const SOURCE_URL = 'https://guanghe.feishu.cn/wiki/IGVEwjIdwiZPagkQqrZcNTLcnFc';
const allowedStages = ['小学', '初中', '高中'];
const allowedCategories = ['同步课', '培优课', '推荐课包', '衔接课', '试卷库'];
const knownIds = new Set(PRODUCT_CAPABILITIES.map(c => c.id));
const values = v => Array.isArray(v) ? v : v ? [v] : [];

function readSource(table) {
  const result = JSON.parse(execFileSync('/usr/local/bin/lark-cli', ['base', '+record-list',
    '--base-token', SOURCE_BASE, '--table-id', table, '--as', 'user', '--format', 'json', '--limit', '200'],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 }));
  if (!result.ok || result.data.has_more || result.data.query_context?.record_scope !== 'all_records') {
    throw new Error('Source read incomplete; no writes performed');
  }
  const d = result.data;
  assert.equal(d.data.length, d.record_id_list.length);
  return d.data.map((cells, i) => ({ recordId: d.record_id_list[i],
    fields: Object.fromEntries(d.fields.map((name, j) => [name, cells[j]])) }));
}

function gradeScope(f) {
  const name = f['文本']; const scope = f['推荐适用情况'] || '';
  const grades = { '新四年级': '四年级', '新五年级': '五年级', '新六年级': '六年级',
    '新七年级': '初一', '新八年级': '初二', '新九年级': '初三',
    '新高一': '高一', '新高二': '高二', '新高三': '高三', '1-3年级': '一年级、二年级、三年级' };
  if (grades[scope]) return grades[scope];
  if (scope && scope !== '多孩家庭') throw new Error('Review new audience constraint: ' + scope);
  if (name === '小升初衔接课') return '六年级';
  if (name === '初升高衔接课') return '初三';
  // Preserve the user-confirmed restriction for high-school math enrichment.
  if (/高中数学.*培优/u.test(name)) return '高三';
  return '全部';
}

function templateId(f) {
  const name = f['文本']; const kind = values(f['课程归属'])[0];
  if (kind === '试卷库') return 'CAP-PRACTICE-06';
  if (name === '21天计算训练营') return 'CAP-PRIMARY-01';
  if (name === '小学数学思维培优课') return 'CAP-PRIMARY-05';
  if (name === '小学数学总复习培优课') return 'CAP-PRIMARY-04';
  if (/一轮|二轮|总复习/u.test(name)) return 'CAP-COURSE-04';
  if (kind === '培优课') return 'CAP-COURSE-03';
  return 'CAP-COURSE-01';
}

function buildProducts(source, services, current) {
  const byRecord = new Map([...source, ...services].map(r => [r.recordId, r]));
  const templates = new Map(current.map(r => [r.fields['产品能力ID'], parseCapability(r)]));
  const skipped = []; const records = [];
  for (const row of source) {
    const f = row.fields; const name = f['文本']; const kind = values(f['课程归属'])[0];
    const stages = values(f['学段']);
    if (!name || !stages.length || stages.some(s => !allowedStages.includes(s)) ||
      (!allowedCategories.includes(kind) && name !== '21天计算训练营')) {
      skipped.push({ recordId: row.recordId, name: name || '', reason: name ? '不属于当前学段或课程推荐范围' : '空行' });
      continue;
    }
    const template = templates.get(templateId(f));
    if (!template) throw new Error('Missing reviewed teaching guidance: ' + templateId(f));
    const subjects = values(f['学科']);
    // The application has no high-school politics subject. Do not relabel it as junior civics.
    if (!subjects.length || subjects.includes('政治')) {
      skipped.push({ recordId: row.recordId, name, reason: '系统暂无对应学科入口，保留源表' }); continue;
    }
    const resolve = field => values(f[field]).map(link => {
      const target = byRecord.get(link.id);
      if (!target?.fields['文本']) throw new Error('Unresolved source relation: ' + row.recordId + '/' + field);
      return target.fields['文本'];
    });
    const servicesIncluded = resolve('赠送服务');
    const coursesIncluded = resolve('课程权益'); const gifts = resolve('赠送权益');
    const period = values(f['时限']).join('、'); const audience = f['推荐适用情况'] || '';
    if (typeof f['价格'] !== 'number' || f['价格'] <= 0 || !period) throw new Error('Review price/period: ' + name);
    const scope = gradeScope(f);
    const variant = kind === '推荐课包' ? [audience, period].filter(Boolean).join('，') : '';
    const productName = name + (variant ? `（${variant}）` : '');
    const blocks = values(f['内容付费板块']); const tools = values(f['内容免费板块']);
    const contents = [...new Set([...blocks, ...coursesIncluded])];
    const boundary = [
      '正式产品名称与包含内容以来源记录为准；有价格不代表孩子需要再次购买，先核实已有课程',
      contents.length ? `课程内容：${contents.join('、')}` : '具体课程内容使用前核实',
      servicesIncluded.length ? `源表关联辅助功能/服务：${servicesIncluded.join('、')}` : '源表未列附加服务，不自行承诺赠送',
      tools.length ? `源表列出的辅助学习板块：${tools.join('、')}` : '',
      gifts.length ? `源表关联赠品：${gifts.join('、')}；不替代主课程，也不额外承诺其他赠品` : '',
      audience ? `适用情况：${audience}` : '',
      contents.some(c => /高中数学.*培优/u.test(c)) || /高中数学.*培优/u.test(name)
        ? '沿用项目确认范围：高中数学培优内容仅高三推荐，不因包含在跨年级课包内而提前推荐' : '',
      '价格和期限仅供销售查表核对，未确认当前成交方案前不在家长话术中报价或承诺有效期',
      '具体知识点课程仍以知识点目录匹配结果为准，产品存在不代表同步课单节目录已接入',
    ].filter(Boolean).join('；');
    const bundle = kind === '推荐课包'; const bridge = kind === '衔接课';
    const fields = { '产品能力ID': `CAP-SKU-${row.recordId}`, '产品名称': productName,
      '类别': '产品', '适用学段': stages, '适用学科': subjects.includes('全科') ? ['全部'] : subjects,
      '适用年级': scope, '启用状态': '启用',
      '问题场景': bundle ? `${audience || stages.join('、')}；多个已验证的学习问题涉及课包内不同课程，需要组合使用；单一问题优先单科课程` :
        bridge ? '处于升学衔接阶段，需要核实新学段的前置知识与学习适应问题' : template.trigger,
      '作用说明': bundle ? '按孩子已验证的问题，从课包实际包含课程中选择少量适配内容，先补薄弱知识点，再练习验证；仅使用源表明确关联的辅助功能' :
        bridge ? '先核实升学节点与前置知识，再选对应衔接内容，完成基础验证题并复述方法' : template.sequence,
      '验收标准': bundle || bridge ? '所选薄弱知识点能独立解释，并在对应练习或变式题中验证；不承诺提分' : template.acceptance,
      '使用边界': boundary,
      '来源链接': `${SOURCE_URL}?table=${SOURCE_TABLE}&record=${row.recordId}`,
      '核对日期': '2026-09-20', '来源记录ID': row.recordId, '原产品名称': name,
      '参考价格': f['价格'], '有效期': period };
    if (!parseCapability({ recordId: 'recValidation', fields })) throw new Error('Invalid imported product: ' + name);
    records.push({ fields });
  }
  return { records, skipped };
}

async function allRows(f, table) {
  const rows = []; const cursors = new Set(); let token = '';
  for (let i = 0; i < 10; i++) {
    const result = await f.listRecords(table, token, 100); rows.push(...result.items);
    if (!result.pageToken) return rows;
    if (cursors.has(result.pageToken)) break;
    cursors.add(result.pageToken); token = result.pageToken;
  }
  throw new Error('Incomplete destination read');
}

async function linkCoursePosters(f, source, products, directory) {
  const table = process.env.BITABLE_PRODUCT_MATERIAL_TABLE_ID || 'tblbIbCiWjza35RR';
  const materials = await allRows(f, table);
  const backup = path.join(directory, 'official-products-materials-before.json');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(materials, null, 2));
  const rules = [
    { id: 'recvvtcUCPOikm', name: '初中同步与培优课程体系', stage: '初中' },
    { id: 'recvvtcVwlxeKE', name: '高中课程体系与产品内容', stage: '高中' },
    { id: 'recvvtcWALHhKc', name: '小学语文课程介绍', stage: '小学', subject: '语文' },
  ];
  const changed = [];
  for (const rule of rules) {
    const material = materials.find(r => r.recordId === rule.id);
    if (!material || material.fields['素材名称'] !== rule.name) throw new Error('Review changed poster: ' + rule.id);
    const sourceIds = new Set(source.filter(r => values(r.fields['学段']).includes(rule.stage) &&
      ['同步课', '培优课'].includes(values(r.fields['课程归属'])[0]) &&
      (!rule.subject || values(r.fields['学科']).includes(rule.subject))).map(r => r.recordId));
    const links = products.filter(r => sourceIds.has(r.fields['来源记录ID'])).map(r => r.recordId);
    const previous = linkedProductIds(material.fields['关联产品']);
    const union = [...new Set([...previous, ...links])];
    if (union.length > previous.length) await f.updateRecord(table, material.recordId, { '关联产品': union });
    const after = await f.getRecord(table, material.recordId);
    assert.deepEqual(new Set(linkedProductIds(after.fields['关联产品'])), new Set(union));
    for (const [key, value] of Object.entries(material.fields)) {
      if (key !== '关联产品') assert.deepEqual(after.fields[key], value, 'Poster changed: ' + key);
    }
    changed.push({ name: rule.name, addedLinks: union.length - previous.length, linkedCourseProducts: links.length });
  }
  return changed;
}

async function main() {
  const [mode, directory] = process.argv.slice(2);
  if (!['--check', '--apply'].includes(mode) || !directory) throw new Error('Usage: --check|--apply BACKUP_DIRECTORY');
  const f = new FeishuService(new HttpService()); const table = productTableId(); const base = f.tablePath(table);
  const source = readSource(SOURCE_TABLE); const services = readSource(SERVICE_TABLE);
  const before = await allRows(f, table);
  const fields = await f.request('GET', base + '/fields', undefined, { page_size: '100' });
  if (fields.has_more) throw new Error('Incomplete schema');
  const plan = buildProducts(source, services, before);
  const existing = new Set(before.map(r => r.fields['产品能力ID']));
  if (existing.size !== before.length) throw new Error('Duplicate existing IDs');
  const additions = plan.records.filter(r => !existing.has(r.fields['产品能力ID']));
  const categoryUpdates = before.filter(r => knownIds.has(r.fields['产品能力ID']) && r.fields['类别'] === '产品')
    .map(r => ({ record_id: r.recordId, fields: { '类别': '卖点' } }));
  fs.mkdirSync(directory, { recursive: true });
  const summary = { sourceRows: source.length, namedSourceRows: source.filter(r => r.fields['文本']).length,
    auxiliaryRows: services.length, selectedProducts: plan.records.length, newProducts: additions.length,
    reclassifiedCapabilities: categoryUpdates.length, excluded: plan.skipped };
  fs.writeFileSync(path.join(directory, 'official-products-plan.json'), JSON.stringify({ ...summary, products: plan.records }, null, 2));
  if (mode === '--check') { console.log(JSON.stringify(summary)); return; }
  const backup = path.join(directory, 'official-products-before.json');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify({ rows: before, fields: fields.items,
    source, services, capturedAt: new Date().toISOString() }, null, 2));
  for (const [name, type] of [['来源记录ID', 1], ['原产品名称', 1], ['参考价格', 2], ['有效期', 1]]) {
    const current = fields.items.find(field => field.field_name === name);
    if (current && current.type !== type) throw new Error('Incompatible field: ' + name);
    if (!current) await f.request('POST', base + '/fields', { field_name: name, type });
  }
  // Create real products first, then reclassify generic teaching capabilities.
  for (let i = 0; i < additions.length; i += 50) {
    await f.request('POST', base + '/records/batch_create', { records: additions.slice(i, i + 50) }, { client_token: randomUUID() });
  }
  if (categoryUpdates.length) await f.request('POST', base + '/records/batch_update', { records: categoryUpdates });
  const after = await allRows(f, table);
  assert.equal(after.length, before.length + additions.length);
  for (const previous of before) {
    const current = after.find(r => r.recordId === previous.recordId); assert.ok(current);
    for (const [key, value] of Object.entries(previous.fields)) {
      if (key !== '类别') assert.deepEqual(current.fields[key], value, previous.recordId + '/' + key);
    }
    assert.equal(current.fields['类别'], knownIds.has(previous.fields['产品能力ID']) ? '卖点' : previous.fields['类别']);
  }
  for (const item of plan.records) {
    assert.equal(after.filter(r => r.fields['产品能力ID'] === item.fields['产品能力ID']).length, 1);
  }
  const library = await new ProductCapabilityCatalog(f).read();
  const samples = [['二年级', '数学'], ['初二', '物理'], ['高一', '物理'], ['高三', '数学']]
    .map(([grade, subject]) => ({ grade, subject, products: eligibleCapabilities(grade, [subject], library)
      .filter(c => c.category === '产品').map(c => c.name) }));
  assert.ok(samples.every(s => s.products.length));
  assert.ok(!eligibleCapabilities('高一', ['数学'], library).some(c => /高中数学.*培优/u.test(c.name)));
  const result = { ...summary, verifiedAt: new Date().toISOString(), existingEditsPreserved: true,
    totalRows: after.length, categories: { '产品': library.filter(c => c.category === '产品').length,
      '卖点': library.filter(c => c.category === '卖点').length }, samples };
  fs.writeFileSync(path.join(directory, 'official-products-verification.json'), JSON.stringify(result, null, 2));
  result.coursePosters = await linkCoursePosters(f, source, after, directory);
  fs.writeFileSync(path.join(directory, 'official-products-verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

module.exports = { buildProducts, gradeScope };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
