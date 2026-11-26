const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { readJson, writeJson, digest, feishu } = require('./materials-import.cjs');
const { MaterialCatalog, matchMaterials } = require('../server/modules/diagnosis-gateway/diagnosis-materials');

async function main() {
  const [work, phase = 'pilot'] = process.argv.slice(2);
  const state = await readJson(path.join(work, 'feishu-import.json'));
  process.env.BITABLE_MATERIAL_TABLE_ID = state.materials;
  process.env.BITABLE_MATERIAL_MAPPING_TABLE_ID = state.mappings;
  const catalog = new MaterialCatalog(feishu);
  const start = performance.now(); const index = await catalog.index();
  const coldIndexMs = performance.now() - start;
  const selected = (await readJson(path.join(work, 'candidates.json'))).filter(r => r.group && (phase === 'all' || r.pilot));
  const results = [];
  await fs.mkdir(path.join(work, 'verified'), { recursive: true });
  for (const row of selected) {
    const mappings = index.mappings.filter(m => m.materialId === row.id);
    assert.ok(mappings.length, `Missing approved labels: ${row.inventoryIndex}`);
    const p = { name: mappings[0].point, subject: row.subjects[0], keywords: [] };
    const matches = await catalog.match(row.exam === '中考' ? '初三' : '高三', [p], [], row.region);
    assert.equal(matches.status, 'ready'); assert.ok(matches.items.length <= 3);
    assert.ok(matches.items.some(m => m.materialId === row.id || selected.find(s => s.id === m.materialId)?.group === row.group));
    const image = await catalog.image(row.id, false);
    assert.equal(digest(image.body), row.sha256, 'Original attachment must be byte-exact');
    await fs.writeFile(path.join(work, 'verified', `${row.id}.${image.contentType.split('/')[1]}`), image.body);
    results.push({ id: row.id, index: row.inventoryIndex, name: image.name, approvedMappings: mappings.length,
      matched: matches.items.map(m => m.materialId), originalVerified: true });
    console.log(`Verified ${row.inventoryIndex}: ${mappings.length} mappings, original unchanged`);
  }
  const times = [];
  for (let i = 0; i < 1000; i++) {
    const row = index.mappings[i % index.mappings.length];
    const now = performance.now(); matchMaterials(index, i % 2 ? '高三' : '初三', [{ name: row.point, subject: row.subject, keywords: row.aliases }]);
    times.push(performance.now() - now);
  }
  times.sort((a, b) => a - b); const p95Ms = times[949]; assert.ok(p95Ms <= 200);
  const report = { at: new Date().toISOString(), phase, coldIndexMs, p95Ms, warmRuns: 1000,
    indexAssets: index.materials.length, indexMappings: index.mappings.length, samples: results };
  await writeJson(path.join(work, `verification-${phase}.json`), report);
  console.log(JSON.stringify({ ...report, samples: results.length }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
