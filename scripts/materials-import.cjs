require('reflect-metadata');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { HttpService } = require('@nestjs/axios');
const { FeishuService } = require('../server/modules/diagnosis-gateway/feishu.service');

const ROOT = 'UGjtdlnuDombT1x2zXScsYR4nid';
const ROOT_URL = 'https://guanghe.feishu.cn/wiki/Ls24w0CnoiUVYnk9OtGchGbmnhc';
const LONG25 = 'U5EBdwCFtoICFCx81klcIg9Tnth';
const LONG25_URL = 'https://guanghe.feishu.cn/wiki/Ia9jwKznRiAamQksFMAcDyrNnRg';
const http = new HttpService();
const feishu = new FeishuService(http);
const textOf = block => Object.values(block || {}).filter(v => v && typeof v === 'object' && Array.isArray(v.elements))
  .flatMap(v => v.elements).map(e => e.text_run?.content || '').join('').trim();
const digest = value => createHash('sha256').update(value).digest('hex');
async function writeJson(file, value) { await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }

async function blocksFor(doc, isRoot) {
  const blocks = new Map(); let token = '';
  for (let page = 0; page < 20; page++) {
    const result = await feishu.request('GET', `/docx/v1/documents/${doc}/blocks`, undefined,
      { page_size: '500', ...(token ? { page_token: token } : {}) });
    for (const block of result.items || []) blocks.set(block.block_id, block);
    // The selected root sections precede stories. Stop once their complete subtrees are available.
    const root = blocks.get(doc);
    if (isRoot && root) {
      const cutoff = root.children.indexOf('CgCUdh71ro3uewxBLFxc0VIDnBh');
      const complete = id => blocks.has(id) && (blocks.get(id).children || []).every(complete);
      if (cutoff > 0 && root.children.slice(0, cutoff).every(complete)) break;
    }
    if (!result.has_more) break;
    if (!result.page_token || token === result.page_token) throw new Error('Invalid document pagination');
    token = result.page_token;
    if (page === 19) throw new Error('Document exceeds bounded import');
  }
  return blocks;
}
async function inventory(work) {
  const rows = [];
  for (const source of [{ doc: ROOT, url: ROOT_URL }, { doc: LONG25, url: LONG25_URL }]) {
    const blocks = await blocksFor(source.doc, source.doc === ROOT);
    let section = source.doc === ROOT ? '' : '25高考'; let subsection = '';
    for (const id of blocks.get(source.doc)?.children || []) {
      const block = blocks.get(id); if (!block) throw new Error('Missing selected block');
      const title = textOf(block);
      if (source.doc === ROOT && /^(26高考|26中考|25高考|25中考)$/u.test(title)) { section = title; subsection = ''; }
      else if (block.block_type >= 3 && block.block_type <= 11) subsection = title;
      if (source.doc === ROOT && id === 'CgCUdh71ro3uewxBLFxc0VIDnBh') break;
      if (!section || /散点|故事|喜报|视频/u.test(subsection)) continue;
      const walk = childId => {
        const child = blocks.get(childId); if (!child) throw new Error(`Missing block ${childId}`);
        if (child.image) {
          let parent = blocks.get(child.parent_id); let caption = child.image.caption?.content || '';
          for (let level = 0; !caption && parent && parent.block_type !== 1 && level < 2; level++, parent = blocks.get(parent.parent_id)) {
            caption = (parent.children || []).map(i => textOf(blocks.get(i))).filter(Boolean).join(' / ');
          }
          rows.push({ id: `mat_${digest(child.image.token).slice(0, 20)}`, sourceDoc: source.doc,
            sourceBlock: childId, sourceUrl: `${source.url}#${childId}`, sourceToken: child.image.token,
            year: section.startsWith('26') ? 2026 : 2025, exam: section.includes('中考') ? '中考' : '高考',
            section, subsection, originalName: caption || title || '未命名长图',
            width: child.image.width, height: child.image.height, status: '候选待筛选' });
        }
        for (const nested of child.children || []) walk(nested);
      };
      walk(id);
    }
  }
  const unique = [...new Map(rows.map(row => [row.sourceToken, row])).values()];
  await writeJson(path.join(work, 'candidates.json'), unique);
  console.log(JSON.stringify({ candidates: unique.length, groups: unique.reduce((out, r) => {
    out[r.section] = (out[r.section] || 0) + 1; return out;
  }, {}) }));
}
async function download(work) {
  const candidates = await readJson(path.join(work, 'candidates.json'));
  await fs.mkdir(path.join(work, 'originals'), { recursive: true });
  let cursor = 0;
  async function worker() { while (cursor < candidates.length) {
    const row = candidates[cursor++];
    if (row.status === '排除') continue;
    const file = path.join(work, 'originals', `${row.id}.image`);
    try { await fs.access(file); } catch {
      const bytes = await feishu.downloadPhoto(row.sourceToken, 32 * 1024 * 1024);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(bytes.contentType)) throw new Error('Unsupported original');
      await fs.writeFile(file, bytes.body);
    }
    const bytes = await fs.readFile(file);
    row.sha256 = digest(bytes); row.bytes = bytes.length;
    console.log(`Downloaded ${row.id} (${row.bytes} bytes)`);
  } }
  await Promise.all(Array.from({ length: 3 }, worker));
  await writeJson(path.join(work, 'candidates.json'), candidates);
  console.log(`Originals ready: ${candidates.filter(row => row.sha256).length}`);
}
async function main() {
  const [command, work] = process.argv.slice(2);
  if (!work || !path.isAbsolute(work)) throw new Error('Pass an absolute work directory');
  await fs.mkdir(work, { recursive: true });
  if (command === 'inventory') await inventory(work);
  else if (command === 'download') await download(work);
  else throw new Error('Use inventory or download');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readJson, writeJson, digest, feishu, http };
