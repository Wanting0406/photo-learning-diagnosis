// Explicit opt-in; real model and Feishu calls with synthetic data only.
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { HttpService } = require('@nestjs/axios');
const axios = require('axios');
const { FeishuService } = require('../server/modules/diagnosis-gateway/feishu.service');
const { VisionService } = require('../server/modules/diagnosis-gateway/vision.service');
const { LearningPlanService } = require('../server/modules/diagnosis-gateway/learning-plan.service');
const { CourseCatalogs } = require('../server/modules/diagnosis-gateway/diagnosis-course-catalogs');
const { sharedProductCatalog } = require('../server/modules/diagnosis-gateway/product-capability-catalog');
const { sharedProductMaterials } = require('../server/modules/diagnosis-gateway/product-materials');

async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Requires --apply PHOTO OUTPUT_DIR for synthetic live testing');
  const [photoPath, outputDir] = process.argv.slice(process.argv.indexOf('--apply') + 1);
  if (!photoPath || !outputDir) throw new Error('Missing synthetic photo or output directory');
  if (path.basename(photoPath) !== 'report-fixture.png') throw new Error('Use the existing synthetic report-fixture.png only');
  const audit = JSON.parse(fs.readFileSync(path.join(outputDir, 'online-audit.json'), 'utf8'));
  if (!audit.config.sameModelAsLocal || !audit.config.sameEndpointAsLocal || !audit.config.sameApiKeyAsLocal) {
    throw new Error('Local model configuration must match audited production settings');
  }
  for (const [key, value] of Object.entries(audit.config.tableIds)) {
    if (/^BITABLE_[A-Z_]+_ID$/u.test(key) && /^tbl\w+$/u.test(value)) process.env[key] = value;
  }
  const feishuHttp = new HttpService(axios.create());
  const feishu = new FeishuService(feishuHttp);
  const catalog = new CourseCatalogs(feishu);
  const preflightStart = performance.now();
  const snapshot = await catalog.read(['数学']);
  const courseCount = snapshot.math.length + snapshot.physics.length + (snapshot.junior?.length || 0) + (snapshot.senior?.length || 0);
  if (snapshot.failed.length || !courseCount) throw new Error('Course preflight failed; no model calls made');
  const results = { checkedAt: new Date().toISOString(), coursePreflightMs: performance.now() - preflightStart,
    courseCount, modelCalls: [], runs: [], cleanup: [] };
  const modelHttp = new HttpService(axios.create());
  modelHttp.axiosRef.interceptors.request.use(config => {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    config.benchmark = { start: performance.now(), model: body.model,
      phase: body.messages[1].content.some(item => item.type === 'image_url') ? 'evidence' : 'report',
      requestBytes: Buffer.byteLength(JSON.stringify(body)), maxTokens: body.max_tokens,
      enableThinking: body.enable_thinking ?? null };
    return config;
  });
  modelHttp.axiosRef.interceptors.response.use(response => {
    const { start, ...meta } = response.config.benchmark;
    const usage = response.data?.usage || {};
    results.modelCalls.push({ ...meta, ms: performance.now() - start,
      promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
      reasoningCharacters: response.data?.choices?.[0]?.message?.reasoning_content?.length || 0,
      finishReason: response.data?.choices?.[0]?.finish_reason });
    fs.writeFileSync(path.join(outputDir, `synthetic-model-${results.modelCalls.length}.json`),
      JSON.stringify({ phase: meta.phase, content: response.data?.choices?.[0]?.message?.content }, null, 2));
    return response;
  }, error => {
    const { start, ...meta } = error.config?.benchmark || {};
    const code = error.response?.data?.error?.code || error.code;
    results.modelCalls.push({ ...meta, ms: start ? performance.now() - start : null, status: error.response?.status,
      errorCode: /^[A-Za-z0-9._-]{1,100}$/u.test(code || '') ? code : 'unclassified', failed: true });
    return Promise.reject(error);
  });
  // A new service/client pair measures an uncached production data path after the configuration check.
  const liveFeishu = process.argv.includes('--warm-only') ? feishu : new FeishuService(feishuHttp);
  const service = new LearningPlanService(liveFeishu, new VisionService(modelHttp));
  const identity = { userId: `latency-integration-${randomUUID()}`, userName: '非客户性能验证' };
  const photo = fs.readFileSync(photoPath);
  results.photoBytes = photo.length;
  const input = { studentName: '产品验证学生', grade: '初中', subject: '数学', attribute: '同步巩固与分层提升',
    note: '非客户合成数据，仅用于完整流程性能验证。',
    watchText: '观看记录：初二数学，三角形三边关系、三角形内角和、等腰三角形底角关系。', reportText: '', watchPhotos: [],
    reportPhotos: [{ name: 'synthetic-report.png', mimeType: 'image/png', dataBase64: photo.toString('base64') }] };
  const created = [];
  try {
    for (const cache of process.argv.includes('--warm-only') ? ['warm', 'warm-repeat'] : ['cold', 'warm']) {
      let prewarmMs = 0;
      if (cache.startsWith('warm')) {
        const at = performance.now();
        const products = sharedProductCatalog(liveFeishu);
        await Promise.all([new CourseCatalogs(liveFeishu).read(['数学']), products.read(), sharedProductMaterials(liveFeishu, products).preload()]);
        prewarmMs = performance.now() - at;
      }
      const start = performance.now();
      let job = await service.start({ requestId: randomUUID(), input }, identity);
      created.push(job.jobId);
      const acceptedMs = performance.now() - start;
      const deadline = Date.now() + 8 * 60 * 1000;
      while (job.status === 'running' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500));
        job = await service.job(job.jobId, identity.userId);
      }
      const run = { cache, prewarmMs, acceptedMs, observedMs: performance.now() - start,
        status: job.status, timings: job.timings };
      results.runs.push(run);
      if (job.status !== 'completed') throw new Error('Synthetic workflow did not complete');
      const materialAt = performance.now();
      const materials = await service.productMatches(job.jobId, identity.userId);
      run.materialMatchMs = performance.now() - materialAt;
      run.materialCount = materials.items.length;
      run.courseCount = job.report.courses.length;
      if (materials.items.length) {
        const imageAt = performance.now();
        const original = await service.productImage(job.jobId, materials.items[0].materialId, identity.userId);
        run.originalImageMs = performance.now() - imageAt;
        run.originalImageBytes = original.body.length;
      }
      fs.writeFileSync(path.join(outputDir, `synthetic-${cache}.json`), JSON.stringify({ report: job.report, materials }, null, 2));
      console.log(JSON.stringify({ event: 'synthetic_flow_complete', ...run }));
    }
  } finally {
    for (const id of created) {
      const record = await liveFeishu.getRecord(process.env.BITABLE_TASK_TABLE_ID, id);
      if (record.fields['提交用户'] !== identity.userId || record.fields['学生姓名'] !== input.studentName || record.fields['状态'] === 'running') {
        results.cleanup.push({ id, deleted: false });
        continue;
      }
      const token = await liveFeishu.accessToken();
      const response = await feishuHttp.axiosRef.delete(`https://open.feishu.cn/open-apis${liveFeishu.tablePath(process.env.BITABLE_TASK_TABLE_ID)}/records/${id}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 20000, maxRedirects: 0 });
      results.cleanup.push({ id, deleted: response.data.code === 0 });
    }
    fs.writeFileSync(path.join(outputDir, 'learning-flow-results.json'), JSON.stringify(results, null, 2));
  }
}
main().catch(error => { console.error(`Benchmark stopped: ${error.name}; upstream details withheld`); process.exitCode = 1; });
