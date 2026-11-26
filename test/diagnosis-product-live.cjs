require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { HttpService } = require('@nestjs/axios');
const { VisionService } = require('../server/modules/diagnosis-gateway/vision.service');
const { normalizeDiagnosis } = require('../server/modules/diagnosis-gateway/diagnosis-normalize');
const { recommend } = require('../server/modules/diagnosis-gateway/diagnosis-recommendation');
const { PRODUCT_SOURCE } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');

// Opt-in model-only check using a synthetic worksheet; no Feishu records or releases are created.
async function main() {
  const [flag, photoPath] = process.argv.slice(2);
  assert.equal(flag, '--model-only');
  assert.ok(photoPath, 'Pass the synthetic physics-sample.jpg path');
  const input = { studentName: '产品库本地验证', grade: '初二', subject: '物理',
    note: '人教版，重点关注长度单位换算，每天可安排20分钟。',
    wrongItems: ['第1题：2.5 m = ( ) cm，学生填25 cm', '第3题：0.08 km = ( ) m，学生填8 m'],
    photos: [{ name: 'physics-sample.jpg', mimeType: 'image/jpeg', dataBase64: fs.readFileSync(photoPath).toString('base64') }] };
  const http = new HttpService();
  http.axiosRef.interceptors.response.use(response => response, error => {
    console.error(`Model transport: ${error.code || 'unknown'}, HTTP ${error.response?.status || 'unavailable'}`);
    return Promise.reject(error);
  });
  let calls = 0;
  http.axiosRef.interceptors.request.use(config => { calls++; return config; });
  const start = Date.now();
  const generated = await new VisionService(http).analyze('analyze', input);
  const { diagnosis } = normalizeDiagnosis(generated.data, input);
  assert.equal(recommend(diagnosis, generated.data.selected_capability_ids), true);
  assert.equal(calls, 1, 'Product selection must share the existing analysis model request');
  assert.equal(diagnosis.membership, '待定');
  assert.ok(diagnosis.onionRecommendation.includes(PRODUCT_SOURCE));
  assert.ok(diagnosis.parentMessage.length > 40);
  assert.ok(diagnosis.salesTips.length > 10);
  assert.doesNotMatch(diagnosis.parentMessage + diagnosis.salesTips,
    /免费体验|保证提分|一定考上|所有孩子都适合|全科会员|AI 私教|拍照即出|CAP-[A-Z]+-\d+/u);
  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), elapsedMs: Date.now() - start,
    calls, selectedCapabilityIds: generated.data.selected_capability_ids,
    parentMessage: diagnosis.parentMessage, salesTips: diagnosis.salesTips,
    recommendation: diagnosis.onionRecommendation }, null, 2));
  console.log('PASS product-library model-only verification; no business records written');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
