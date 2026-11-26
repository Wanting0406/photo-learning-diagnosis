// Read-only latency checks. Never instantiate VisionService or write business records.
require('reflect-metadata');
const { performance } = require('node:perf_hooks');
const { HttpService } = require('@nestjs/axios');
const { FeishuService } = require('../server/modules/diagnosis-gateway/feishu.service');
const { CourseCatalogs, courseSubjects } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
const { ProductCapabilityCatalog } = require('../server/modules/diagnosis-gateway/product-capability-catalog');
const { ProductMaterialCatalog, parseProductMaterial, matchProductMaterials } = require('../server/modules/diagnosis-gateway/product-materials');
const { materialApproved } = require('../server/modules/diagnosis-gateway/material-approval');
const { TaskRecordCache } = require('../server/modules/diagnosis-gateway/diagnosis-performance');
const { eligibleCapabilities } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');
async function main() {
  const f = new FeishuService(new HttpService()); const courses = new CourseCatalogs(f);
  const subjects = process.argv.includes('--all-subjects') ? courseSubjects : ['数学'];
  const products = new ProductCapabilityCatalog(f); const times = {};
  let rows;
  const list = f.listRecords.bind(f);
  f.listRecords = async (...args) => {
    const result = await list(...args);
    if (args[0] === 'tblbIbCiWjza35RR') rows = result;
    return result;
  };
  const catalog = new ProductMaterialCatalog(f, Date.now, products);
  async function measure(key, fn) { const t = performance.now(); const value = await fn(); times[key] = +(performance.now() - t).toFixed(2); return value; }
  const [snapshot, library] = await measure('parallelColdTotalMs', () => Promise.all([
    measure('coursesColdMs', () => courses.read(subjects)), measure('productsColdMs', () => products.read()),
    measure('materialIndexPreloadMs', () => catalog.preload()),
  ]));
  if (!rows) throw new Error('Material preload failed');
  if (rows.pageToken) throw new Error('Unexpected pagination');
  const items = rows.items.map(r => parseProductMaterial(r, library)).filter(Boolean);
  await measure('coursesWarmMs', () => courses.read(subjects)); await measure('productsWarmMs', () => products.read());
  const eligible = eligibleCapabilities('初二', ['数学'], library).filter(p => p.category === '产品');
  const selected = eligible.filter(p => items.some(m => m.capabilityIds.includes(p.id) || m.searchText.includes(p.name))).slice(0, 2);
  const report = { grade: '初二', subjects: ['数学'], solutions: selected.map(p => ({ capabilityId: p.id, name: p.name,
    knowledgePoint: '三角形三边关系', sellingPoints: [] })) };
  const matches = await measure('materialMatchWarmMs', () => catalog.match(report));
  const samples = [];
  for (let i = 0; i < 200; i++) { const t = performance.now(); matchProductMaterials(items, report, library); samples.push(performance.now() - t); }
  times.textMatchP95Ms = +samples.sort((a, b) => a - b)[189].toFixed(3);
  const cache = new TaskRecordCache(); cache.put({ recordId: 'recSynthetic', fields: { '状态': 'running', '提交用户': 'synthetic' } });
  await measure('thirtyCachedStatusReadsMs', async () => { for (let i = 0; i < 30; i++) await cache.get('recSynthetic', async () => { throw new Error('Unexpected network'); }); });
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), subjects, modelCalls: 0, remoteWrites: 0, times,
    counts: { products: library.length, materialRows: rows.items.length, approved: rows.items.filter(materialApproved).length,
      searchableMaterials: items.length, matched: matches.items.length, courses: snapshot.math.length + snapshot.physics.length +
        (snapshot.junior?.length || 0) + (snapshot.senior?.length || 0) },
    excludedScopes: rows.items.filter(r => !parseProductMaterial(r, library)).map(r => ({
      stage: r.fields['适用学段'], hasAttachment: !!r.fields['原图附件']?.length,
      hasName: !!r.fields['素材名称'], validId: /^prod_[a-z0-9_]{3,60}$/u.test(r.fields['素材ID'] || '') })),
    failedSubjects: snapshot.failed }, null, 2));
}
main().catch(() => { console.error('Read-only benchmark failed; credentials and upstream response withheld'); process.exitCode = 1; });
