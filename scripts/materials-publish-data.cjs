const fs = require('node:fs/promises');
const path = require('node:path');
const { firstValueFrom } = require('rxjs');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson, digest, feishu, http } = require('./materials-import.cjs');
http.axiosRef.interceptors.response.use(response => {
  if (response.data?.code && response.data.code !== 0) console.error(`Feishu validation: ${response.data.code} ${response.data.msg}`);
  return response;
});

const schemas = {
  materials: ['素材ID', '原名称', '规范名称', ['原图附件', 17], ['缩略图', 17], '年度', '考试', '学科', '地区试卷',
    '版式', '来源链接', '来源区块', '去重标识', '同内容组', '审核状态', '审核说明'],
  mappings: ['映射ID', '标准知识点', '标注原文', '检索别名', '关联素材ID', '学科', '对应题号', '识别置信度',
    '审核状态', '审核说明', '证据素材ID', '证据定位'],
};
async function records(table) {
  const all = []; let token = '';
  do { const result = await feishu.listRecords(table, token, 500); all.push(...result.items); token = result.pageToken; } while (token);
  return all;
}
async function setup(work, state) {
  const base = `/bitable/v1/apps/${process.env.BITABLE_APP_TOKEN}/tables`;
  const listed = []; let pageToken = '';
  do {
    const page = await feishu.request('GET', base, undefined, { page_size: '100', ...(pageToken ? { page_token: pageToken } : {}) });
    listed.push(...(page.items || [])); pageToken = page.has_more ? page.page_token : '';
  } while (pageToken);
  for (const [key, name] of [['materials', '中高考长图素材'], ['mappings', '中高考知识点映射']]) {
    const fields = schemas[key].map(field => ({ field_name: Array.isArray(field) ? field[0] : field, type: Array.isArray(field) ? field[1] : 1 }));
    const found = listed.find(t => t.name === name);
    state[key] = found?.table_id || (await feishu.request('POST', base, { table: { name, default_view_name: '全部记录', fields } })).table_id;
    if (!state[key]) throw new Error('Table creation did not return ID');
    await writeJson(path.join(work, 'feishu-import.json'), state);
    const schema = await feishu.request('GET', `${base}/${state[key]}/fields`, undefined, { page_size: '100' });
    if (!fields.every(f => schema.items?.some(v => v.field_name === f.field_name && v.type === f.type))) throw new Error(`Schema mismatch ${name}`);
  }
  state.urls = Object.fromEntries(['materials', 'mappings'].map(k => [k, `https://guanghe.feishu.cn/base/${process.env.BITABLE_APP_TOKEN}?table=${state[k]}`]));
  await writeJson(path.join(work, 'feishu-import.json'), state);
  console.log(JSON.stringify({ tables: state.urls }));
}
async function upload(file, name, state, work) {
  const bytes = await fs.readFile(file); const hash = digest(bytes);
  if (state.uploads?.[hash]) return state.uploads[hash];
  const mime = bytes[0] === 137 ? 'image/png' : 'image/jpeg';
  name = name.replace(/\.(png|jpg|jpeg)$/u, mime === 'image/png' ? '.png' : '.jpg');
  const form = new FormData();
  form.set('file_name', name); form.set('parent_type', 'bitable_file');
  form.set('parent_node', process.env.BITABLE_APP_TOKEN); form.set('size', String(bytes.length));
  form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
  const response = await firstValueFrom(http.post('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', form, {
    headers: { Authorization: `Bearer ${await feishu.accessToken()}` }, timeout: 120000,
    maxBodyLength: 32 * 1024 * 1024, maxContentLength: 1024 * 1024, maxRedirects: 0,
  }));
  const token = response.data.data?.file_token;
  if (response.data.code !== 0 || !token) throw new Error(`Upload rejected (${response.data.code})`);
  state.uploads ||= {}; state.uploads[hash] = token;
  await writeJson(path.join(work, 'feishu-import.json'), state);
  return token;
}
async function main() {
  const [work, phase = 'tables'] = process.argv.slice(2);
  const state = await readJson(path.join(work, 'feishu-import.json')).catch(() => ({}));
  await setup(work, state); if (phase === 'tables') return;
  const rows = (await readJson(path.join(work, 'candidates.json'))).filter(r => r.group && (phase === 'all' || r.pilot));
  const assets = new Map((await records(state.materials)).map(r => [r.fields['素材ID'], r]));
  for (const row of rows) {
    if (assets.has(row.id) && row.metadataCorrection) {
      await feishu.updateRecord(state.materials, assets.get(row.id).recordId,
        { '规范名称': row.name, '学科': row.subjects.join('、'), '审核说明': row.scopeReview });
    }
    if (!assets.has(row.id)) {
      const original = path.join(work, 'originals', `${row.id}.image`);
      if (digest(await fs.readFile(original)) !== row.sha256) throw new Error('Original changed after review');
      const token = await upload(original, `${row.name}.png`, state, work);
      const thumb = await upload(path.join(work, 'prepared', row.id, 'thumbnail.jpg'), `${row.name}-缩略图.jpg`, state, work);
      await feishu.createRecord(state.materials, {
        '素材ID': row.id, '原名称': row.originalName, '规范名称': row.name,
        '原图附件': [{ file_token: token }], '缩略图': [{ file_token: thumb }], '年度': String(row.year), '考试': row.exam,
        '学科': row.subjects.join('、'), '地区试卷': row.region, '版式': row.orientation,
        '来源链接': row.sourceUrl, '来源区块': row.sourceBlock, '去重标识': row.sha256,
        '同内容组': row.group, '审核状态': '已审核', '审核说明': row.scopeReview,
      }, randomUUID());
      console.log(`Asset imported ${row.inventoryIndex}:${row.id}`);
    }
  }
  const reviewed = await readJson(path.join(work, 'approved-labels.json')).catch(() => []);
  const pending = (await readJson(path.join(work, 'label-review', 'manifest.json')).catch(() => []))
    .filter(label => !reviewed.some(r => r.key === label.key)).map(label => ({ ...label, status: '待复核',
      reviewMethod: '模型初提取；尚未通过题旁标签复核，不参与检索', aliases: [] }));
  const existing = new Map((await records(state.mappings)).map(r => [r.fields['映射ID'], r]));
  const toCreate = []; const toUpdate = [];
  for (const row of rows) {
    const labels = [...reviewed, ...(row.representative ? pending : [])].filter(l => l.materialId === row.group);
    for (const label of labels) {
      const id = digest(`${row.id}:${label.point}:${label.question}`).slice(0, 32);
      if (toCreate.some(r => r.fields['映射ID'] === id) || toUpdate.some(r => r.fields['映射ID'] === id)) continue;
      const fields = { '映射ID': id, '标准知识点': label.point, '标注原文': label.original,
        '检索别名': (label.aliases || []).join('、'), '关联素材ID': row.id, '学科': row.subjects[0],
        '对应题号': label.question || '', '识别置信度': label.confidence,
        '审核状态': label.status, '审核说明': label.reviewMethod, '证据素材ID': label.materialId,
        '证据定位': `${path.basename(label.evidenceTile)} ${JSON.stringify(label.box)}; ${label.key}` };
      const old = existing.get(id);
      if (!old) toCreate.push({ fields });
      else if ((old.fields['审核状态'] !== '已审核' && label.status === '已审核') ||
        (row.metadataCorrection && old.fields['学科'] !== row.subjects[0])) toUpdate.push({ record_id: old.recordId, fields });
    }
  }
  for (let i = 0; i < toCreate.length; i += 100) {
    await feishu.request('POST', `${feishu.tablePath(state.mappings)}/records/batch_create`, { records: toCreate.slice(i, i + 100) });
    console.log(`Mappings imported ${Math.min(i + 100, toCreate.length)}/${toCreate.length}`);
  }
  for (let i = 0; i < toUpdate.length; i += 100) {
    await feishu.request('POST', `${feishu.tablePath(state.mappings)}/records/batch_update`, { records: toUpdate.slice(i, i + 100) });
  }
  state.lastImport = { at: new Date().toISOString(), phase, assets: rows.length, newMappings: toCreate.length };
  await writeJson(path.join(work, 'feishu-import.json'), state);
}
main().catch(e => { console.error(`Import failed: ${e.response?.status || e.message}`); process.exitCode = 1; });
