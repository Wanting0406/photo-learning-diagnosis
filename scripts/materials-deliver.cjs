const fs = require('node:fs/promises');
const path = require('node:path');
const { readJson, writeJson, feishu } = require('./materials-import.cjs');
async function allRecords(table) {
  const rows = []; let token = '';
  do { const page = await feishu.listRecords(table, token, 500); rows.push(...page.items); token = page.pageToken; } while (token);
  return rows;
}
async function main() {
  const work = process.argv[2]; const destination = path.resolve(work, '..', 'deliverables', 'long-material-matching');
  await fs.mkdir(destination, { recursive: true });
  const state = await readJson(path.join(work, 'feishu-import.json'));
  const rows = await readJson(path.join(work, 'candidates.json'));
  const [assets, mappings] = await Promise.all([allRecords(state.materials), allRecords(state.mappings)]);
  const approved = mappings.filter(r => r.fields['审核状态'] === '已审核');
  for (const row of rows.filter(r => r.group)) {
    row.status = '已导入，有已复核映射';
    row.approvedMappings = approved.filter(m => m.fields['关联素材ID'] === row.id).length;
  }
  await writeJson(path.join(work, 'candidates.json'), rows);
  const candidates = rows.map(({ sourceToken, ...r }) => r);
  await writeJson(path.join(destination, 'candidates.json'), candidates);
  const safeAssets = assets.map(({ recordId, fields }) => ({ recordId, ...Object.fromEntries(Object.entries(fields)
    .filter(([k]) => !['原图附件', '缩略图'].includes(k))) }));
  await writeJson(path.join(destination, 'materials.json'), safeAssets);
  await writeJson(path.join(destination, 'knowledge-mappings.json'), mappings.map(r => ({ recordId: r.recordId, ...r.fields })));
  const verification = await readJson(path.join(work, 'verification-all.json'));
  const http = await readJson(path.join(work, 'verification-http.json'));
  const summary = { candidates: rows.length, selected: assets.length, groups: new Set(rows.filter(r => r.group).map(r => r.group)).size,
    reviewedMappings: approved.length, pendingMappings: mappings.length - approved.length, tables: state.urls,
    verification, http, publication: '未发布上线；仅本地验证；正式环境未配置新表ID' };
  await writeJson(path.join(destination, 'acceptance.json'), summary);
  const escape = text => String(text || '').replace(/\|/gu, ' / ').replace(/\n/gu, ' ');
  const markdown = ['# 中高考宣传长图候选清单', '', `候选 ${rows.length} 张，选定 ${assets.length} 张，归为 ${summary.groups} 组内容。`, '',
    `已审核映射 ${approved.length} 条；待复核 ${summary.pendingMappings} 条，不参与匹配。`, '',
    `- [长图素材表](${state.urls.materials})`, `- [知识点映射表](${state.urls.mappings})`, '',
    '| 编号 | 年度考试 | 图片名称 | 状态 | 已审核映射 | 来源及说明 |', '| --- | --- | --- | --- | --- | --- |',
    ...candidates.map(r => `| ${r.inventoryIndex} | ${r.year}${r.exam} | ${escape(r.name || r.originalName)} | ${r.status} | ${r.approvedMappings || 0} | [来源](${r.sourceUrl}) ${escape(r.metadataCorrection || r.reason)} |`), '',
    '原图保存在飞书附件中。目录不导出附件令牌；图片读取由应用中的登录权限接口完成。', ''];
  await fs.writeFile(path.join(destination, 'candidate-inventory.md'), markdown.join('\n'));
  console.log(JSON.stringify({ destination, assets: assets.length, approved: approved.length, pending: summary.pendingMappings }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
