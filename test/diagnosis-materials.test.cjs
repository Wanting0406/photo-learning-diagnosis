require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MaterialCatalog, parseMaterialIndex, matchMaterials } = require('../server/modules/diagnosis-gateway/diagnosis-materials');
const { DiagnosisGatewayService } = require('../server/modules/diagnosis-gateway/diagnosis-gateway.service');
const { DiagnosisGatewayController } = require('../server/modules/diagnosis-gateway/diagnosis-gateway.controller');
const id = n => `mat_${String(n).padStart(20, '0')}`;
const asset = (n, fields = {}) => ({ recordId: `recAsset${n}`, fields: { '素材ID': id(n), '规范名称': '2026中考-数学-湖北-竖版',
  '年度': '2026', '考试': '中考', '学科': '数学', '地区试卷': '湖北', '版式': '竖版',
  '来源链接': 'https://guanghe.feishu.cn/wiki/source#block', '同内容组': id(n),
  '原图附件': [{ file_token: `original-${n}` }], '缩略图': [{ file_token: `thumb-${n}` }], '审核状态': '已审核', ...fields } });
const mapping = (n, point = '一元二次方程', fields = {}) => ({ recordId: `recMapping${n}`, fields: {
  '关联素材ID': id(n), '标准知识点': point, '标注原文': `第1题 ${point}`, '学科': '数学',
  '检索别名': '一元二次方程的解法', '审核状态': '已审核', ...fields } });
const point = (name = '一元二次方程', subject = '数学', keywords = []) => ({ name, subject, keywords });
const run = (assets, mappings, points = [point()], grade = '初三', note = '') =>
  matchMaterials(parseMaterialIndex(assets, mappings), grade, points, [], note);
const { materialHistoryText, appendMaterialHistory } = require('../shared/material-history');

test('exam references use the matched original label and its actual subject, year and paper', () => {
  const [hit] = run([asset(1)], [mapping(1)], [point('一元二次方程的解法')]);
  assert.deepEqual(hit.examReferences, [{ knowledgePoint: '一元二次方程', paperName: '2026年中考数学（湖北卷）' }]);
  assert.equal(materialHistoryText([hit], new Set([hit.materialId])), '一元二次方程知识点在【2026年中考数学（湖北卷）】考过。');
  const [senior] = run([asset(2, { '年度': '2025', '考试': '高考', '地区试卷': '新高考I卷' })], [mapping(2)], [point()], '高三');
  assert.equal(senior.examReferences[0].paperName, '2025年高考数学（新高考I卷）');
  const [mixed] = run([asset(3, { '学科': ['数学', '物理'] })], [mapping(3, '电磁感应', { '学科': '物理' })], [point('电磁感应', '物理')]);
  assert.equal(mixed.examReferences[0].paperName, '2026年中考物理（湖北卷）');
});
test('no image, no reliable paper or no reviewed mapping means no exam-history sentence', () => {
  for (const region of ['', '未标注', '待确认', '多地区汇总', '全国']) {
    const [hit] = run([asset(1, { '地区试卷': region })], [mapping(1)]);
    assert.deepEqual(hit.examReferences, []);
    assert.equal(materialHistoryText([hit], new Set([hit.materialId])), '');
  }
  const [hit] = run([asset(1)], [mapping(1)]);
  assert.equal(materialHistoryText([hit], new Set()), '');
  assert.equal(materialHistoryText([], new Set([hit.materialId])), '');
  assert.equal(materialHistoryText([{ ...hit, examReferences: undefined }], new Set([hit.materialId])), '');
  assert.equal(materialHistoryText(run([asset(1, { '原图附件': [] })], [mapping(1)]), new Set([id(1)])), '');
  assert.equal(materialHistoryText(run([asset(1)], [mapping(1, '一元二次方程', { '审核状态': '待复核' })]), new Set([id(1)])), '');
  assert.equal(appendMaterialHistory('原家长话术', ''), '原家长话术');
});
test('only available images contribute to copied text; removing availability removes the claim', () => {
  const hits = run([asset(1), asset(2, { '地区试卷': '上海' })], [mapping(1), mapping(2)]);
  const ready = new Set([id(1)]); const line = materialHistoryText(hits, ready);
  assert.match(line, /湖北/u); assert.doesNotMatch(line, /上海/u);
  assert.equal(appendMaterialHistory('给家长的话', line), `给家长的话\n\n${line}`);
  ready.delete(id(1)); assert.equal(materialHistoryText(hits, ready), '');
  assert.equal(materialHistoryText([hits[0], hits[0]], new Set([id(1)])), line);
  assert.equal(materialHistoryText([{ ...hits[0], matchedKnowledgePoints: [] }], new Set([id(1)])), '');
});

test('exact matches precede aliases and conservative keywords; all work without courses', () => {
  const assets = [asset(1), asset(2), asset(3)];
  const mappings = [mapping(1), mapping(2, '解一元二次方程', { '检索别名': '一元二次方程' }),
    mapping(3, '一元二次方程应用', { '检索别名': '' })];
  assert.deepEqual(run(assets, mappings).map(r => r.materialId), [id(1), id(2), id(3)]);
  assert.equal(run([asset(1)], [mapping(1)], [point('一元二次方程的解法')]).length, 1);
  assert.equal(run([asset(1)], [mapping(1)], [point('其他知识点', '数学', ['一元二次方程'])]).length, 1);
});
test('subjects, exam stage, generic queries and unreviewed evidence cannot cross-match', () => {
  assert.equal(run([asset(1)], [mapping(1)], [point('一元二次方程', '物理')]).length, 0);
  assert.equal(run([asset(1)], [mapping(1)], [point()], '高三').length, 0);
  assert.equal(run([asset(1)], [mapping(1)], [point()], '').length, 0);
  for (const word of ['计算', '函数', '方程', '图形', '综合']) assert.equal(run([asset(1)], [mapping(1, word)], [point(word)]).length, 0);
  assert.equal(run([asset(1)], [mapping(1, '一元二次方程', { '审核状态': '待复核' })]).length, 0);
  assert.equal(run([asset(1, { '审核状态': '待复核' })], [mapping(1)]).length, 0);
  assert.equal(run([asset(1)], [mapping(1, '一元二次方程', { '标注原文': '' })]).length, 0);
  assert.equal(run([asset(1, { '年度': '2024' })], [mapping(1)]).length, 0);
  assert.equal(run([asset(1, { '来源链接': 'https://evil.example/source' })], [mapping(1)]).length, 0);
});
test('same-image hits merge; content groups prefer vertical; year and explicit region break ties', () => {
  const assets = [asset(1, { '版式': '整卷对比海报', '同内容组': 'group' }), asset(2, { '同内容组': 'group' }),
    asset(3, { '年度': '2025', '地区试卷': '上海' }), asset(4), asset(5)];
  const mappings = assets.map((_, i) => mapping(i + 1));
  assert.deepEqual(run(assets, mappings).map(r => r.materialId), [id(2), id(4), id(5)]);
  assert.equal(run(assets, mappings, [point()], '初三', '上海卷')[0].materialId, id(3));
  mappings.push(mapping(5, '因式分解'), mapping(5, '因式分解'));
  const hits = run(assets, mappings, [point(), point('因式分解')]);
  assert.equal(hits[0].materialId, id(5));
  assert.deepEqual(hits[0].matchedKnowledgePoints, ['一元二次方程', '因式分解']);
  assert.equal(run([asset(1, { '去重标识': 'a'.repeat(64) }), asset(2, { '去重标识': 'a'.repeat(64) })],
    [mapping(1), mapping(2)]).length, 1);
});
test('10-minute index coalesces concurrent callers, paginates, and retries failures without caching a partial index', async () => {
  process.env.BITABLE_MATERIAL_TABLE_ID = 'assets'; process.env.BITABLE_MATERIAL_MAPPING_TABLE_ID = 'mappings';
  let now = 1000; let calls = 0; let fail = false;
  const service = new MaterialCatalog({ async listRecords(table, token) {
    calls++; await new Promise(resolve => setImmediate(resolve));
    if (fail && table === 'mappings') throw new Error('offline');
    return table === 'assets' ? { items: token ? [asset(2)] : [asset(1)], pageToken: token ? '' : 'page2' }
      : { items: [mapping(1), mapping(2)], pageToken: '' };
  } }, () => now);
  const indices = await Promise.all(Array.from({ length: 10 }, () => service.index()));
  assert.equal(calls, 3); assert.equal(indices[0].materials.length, 2);
  assert.ok(indices.every(i => i === indices[0]));
  now += 599999; await service.index(); assert.equal(calls, 3);
  now++; fail = true; assert.equal((await service.match('初三', [point()], [], '')).status, 'unavailable');
  fail = false; assert.equal((await service.match('初三', [point()], [], '')).status, 'ready');
});
test('image reads use approved material IDs and recheck approval; no arbitrary attachment tokens', async () => {
  process.env.BITABLE_MATERIAL_TABLE_ID = 'assets'; process.env.BITABLE_MATERIAL_MAPPING_TABLE_ID = 'mappings';
  let current = asset(1); const downloads = [];
  const catalog = new MaterialCatalog({ async listRecords(table) { return { items: table === 'assets' ? [current] : [mapping(1)], pageToken: '' }; },
    async getRecord() { return current; }, async downloadPhoto(token, limit) {
      downloads.push(token); assert.equal(limit, 32 * 1024 * 1024);
      return { body: Buffer.from([137, 80, 78, 71]), contentType: 'image/png' };
    } });
  await assert.rejects(catalog.image('arbitrary-file-token', false), e => e.getStatus() === 404);
  assert.equal((await catalog.image(id(1), true)).name, '2026中考-数学-湖北-竖版.png');
  await catalog.image(id(1), false); assert.deepEqual(downloads, ['thumb-1', 'original-1']);
  current = asset(1, { '审核状态': '待复核' });
  await assert.rejects(catalog.image(id(1), false), e => e.getStatus() === 404);
  assert.equal(downloads.length, 2);
});
test('matching references the current users completed recognition task and never calls the model', async () => {
  let modelCalls = 0;
  const record = { recordId: 'recOwner1', fields: { '提交用户': 'owner', '模式': 'extract-wrong', '状态': 'completed',
    '结果': JSON.stringify({ grade: '初三', knowledgePoints: [point()], courseMatches: [] }) } };
  const service = new DiagnosisGatewayService({ analyze() { modelCalls++; } }, { async getRecord() { return record; } });
  service.materials = { async match(grade, points) { return { status: 'ready', items: points, grade }; } };
  await assert.rejects(service.materialMatches('recOwner1', 'other'), e => e.getStatus() === 404);
  await assert.rejects(service.materialMatches('../file-token', 'owner'), e => e.getStatus() === 400);
  assert.equal((await service.materialMatches('recOwner1', 'owner')).items.length, 1);
  assert.equal(modelCalls, 0);
});
test('a broken attachment leaves the approved index and subsequent matching usable', async () => {
  process.env.BITABLE_MATERIAL_TABLE_ID = 'assets'; process.env.BITABLE_MATERIAL_MAPPING_TABLE_ID = 'mappings';
  let broken = true;
  const catalog = new MaterialCatalog({ async listRecords(table) { return { items: table === 'assets' ? [asset(1)] : [mapping(1)], pageToken: '' }; },
    async getRecord() { return asset(1); }, async downloadPhoto() {
      if (broken) throw new Error('attachment expired');
      return { body: Buffer.from('not an image'), contentType: 'application/octet-stream' };
    } });
  await assert.rejects(catalog.image(id(1), false), /attachment expired/u);
  assert.equal((await catalog.match('初三', [point()], [], '')).status, 'ready');
  broken = false; await assert.rejects(catalog.image(id(1), false), e => e.getStatus() === 404);
  assert.equal((await catalog.match('初三', [point('不相关知识点')], [], '')).status, 'empty');
});
test('reopened analysis reports match saved diagnosis points without another model call', async () => {
  const record = { recordId: 'recReport1', fields: { '提交用户': 'owner', '模式': 'analyze', '状态': 'completed',
    '结果': JSON.stringify({ format: 'diagnosis-v2', result: { diagnosis: { grade: '初三', subjects: ['数学'],
      problems: [{ subject: '数学', knowledgePoint: '一元二次方程' }], weakPoints: [], courseMatches: [] } } }) } };
  let reads = 0;
  const service = new DiagnosisGatewayService({ analyze() { assert.fail('No new model calls'); } },
    { async getRecord() { return structuredClone(record); } });
  service.materials = { async match(grade, points) {
    reads++; return { status: 'ready', items: run([asset(1)], [mapping(1)], points, grade), note: '' };
  } };
  await assert.rejects(service.materialMatches(record.recordId, 'other'), e => e.getStatus() === 404);
  assert.equal(reads, 0);
  assert.equal((await service.materialMatches(record.recordId, 'owner')).items[0].materialId, id(1));
  record.fields['结果'] = JSON.stringify({ format: 'diagnosis-v2', result: { diagnosis: { grade: '初三',
    subjects: ['数学'], problems: [], weakPoints: [], courseMatches: [] } },
    artifact: { context: { note: '' }, recognition: { knowledgePoints: [point()] } } });
  const restarted = new DiagnosisGatewayService({}, { async getRecord() { return record; } });
  restarted.materials = service.materials;
  assert.equal((await restarted.materialMatches(record.recordId, 'owner')).items.length, 1);
});
test('material image flags and UTF-8 download filename are validated with sales/admin authorization', async () => {
  let result; const res = { status() { return this; }, set(headers) { result = headers; return this; }, send() {} };
  const controller = new DiagnosisGatewayController({ async materialImage() { return { contentType: 'image/png', body: Buffer.alloc(0), name: '中考长图.png' }; } });
  const req = { userContext: { userId: 'owner' } };
  await assert.rejects(controller.materialImage(id(1), 'arbitrary-token', '0', req, res));
  await controller.materialImage(id(1), '0', '1', req, res);
  assert.ok(result['Content-Disposition'].includes(encodeURIComponent('中考长图.png')));
  for (const name of ['materialMatches', 'materialImage']) {
    assert.ok(Reflect.getMetadata('authnpaas:needLogin', controller[name]));
    assert.deepEqual(Reflect.getMetadata('authzpaas:roles', controller[name]).roles, ['sales', 'admin']);
  }
});
