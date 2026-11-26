const path = require('node:path');
const { createServer } = require('node:http');
const { randomBytes } = require('node:crypto');
const { feishu, writeJson, readJson } = require('./materials-import.cjs');
const fields = ['目录ID', '知识点名称', '课程名称', '学科', '适用年级', '教材版本', '课程类型', '专题', '原目录链接', '审核状态'];
async function serve(work) {
  const state = await readJson(path.join(work, 'knowledge-table.json'));
  const route = '/' + randomBytes(24).toString('hex');
  let busy = false;
  const server = createServer(async (req, res) => {
    if (req.url !== route) { res.writeHead(404); res.end(); return; }
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'");
      res.end('<!doctype html><meta charset="utf-8"><title>知识点目录录入</title><style>body{max-width:800px;margin:32px auto;font:16px system-ui;padding:16px}textarea{box-sizing:border-box;width:100%;height:350px}button{margin:16px 0;padding:10px}output{display:block;white-space:pre-wrap}</style><h1>知识点目录录入</h1><label for="rows">目录信息</label><textarea id="rows"></textarea><button id="save">保存到飞书目录</button><output id="result"></output><script>document.getElementById("save").onclick=async()=>{const b=document.getElementById("save");b.disabled=true;document.getElementById("result").textContent="正在保存";try{const r=await fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:document.getElementById("rows").value});document.getElementById("result").textContent=await r.text()}catch{document.getElementById("result").textContent="保存失败"}finally{b.disabled=false}}</script>');
      return;
    }
    if (req.method !== 'POST' || req.headers.origin !== `http://${req.headers.host}` || busy) {
      res.writeHead(403); res.end('请求无效'); return;
    }
    busy = true;
    try {
      let body = '';
      for await (const part of req) { body += part.toString(); if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('Too large'); }
      const rows = JSON.parse(body);
      if (!Array.isArray(rows) || !rows.length || rows.length > 450) throw new Error('Invalid directory');
      for (const row of rows) {
        if (Object.keys(row).length !== fields.length || fields.some(f => typeof row[f] !== 'string' || row[f].length > 1000) ||
          !/^math_py_\d+$/u.test(row['目录ID']) || row['学科'] !== '数学' || !['初一', '初二', '初三'].includes(row['适用年级']) ||
          !['已核对', '待核实'].includes(row['审核状态']) || !row['知识点名称'] ||
          !/^https:\/\/guanghe\.feishu\.cn\/wiki\/DVRTwUhnzibdRRkLhzDccU29nUh\?sheet=azWo4G&range=A\d+:H\d+$/u.test(row['原目录链接'])) {
          throw new Error('Only verified directory fields are accepted');
        }
      }
      if (new Set(rows.map(r => r['目录ID'])).size !== rows.length) throw new Error('Duplicate directory ID');
      const existing = new Map(); let token = '';
      for (let p = 0; p < 20; p++) {
        const data = await feishu.listRecords(state.table, token, 500);
        data.items.forEach(r => existing.set(r.fields['目录ID'], r.recordId));
        if (!data.pageToken) break;
        if (data.pageToken === token || p === 19) throw new Error('Invalid pagination');
        token = data.pageToken;
      }
      const creates = rows.filter(r => !existing.has(r['目录ID'])).map(fields => ({ fields }));
      const updates = rows.filter(r => existing.has(r['目录ID'])).map(fields => ({ fields, record_id: existing.get(fields['目录ID']) }));
      for (const [action, records] of [['batch_create', creates], ['batch_update', updates]]) {
        for (let i = 0; i < records.length; i += 100) await feishu.request('POST', `${feishu.tablePath(state.table)}/records/${action}`, { records: records.slice(i, i + 100) });
      }
      res.end(`已保存 ${rows.length} 条目录信息，新增 ${creates.length} 条，更新 ${updates.length} 条。`);
    } catch { res.writeHead(400); res.end('保存失败，请检查目录字段或飞书连接。'); }
    finally { busy = false; }
  });
  server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}${route}`));
}
async function main() {
  const [work, mode] = process.argv.slice(2);
  if (work && mode === '--serve') return serve(work);
  if (!work || mode !== '--create') throw new Error('Usage: math-knowledge-table.cjs WORK --create');
  const base = `/bitable/v1/apps/${process.env.BITABLE_APP_TOKEN}/tables`;
  const result = await feishu.request('GET', base, undefined, { page_size: '100' });
  if (result.has_more) throw new Error('Inspect additional table pages before creating a table');
  const existing = result.items.find(item => item.name === '数学知识点目录');
  const table = existing?.table_id || (await feishu.request('POST', base, { table: {
    name: '数学知识点目录', default_view_name: '目录信息', fields: fields.map(field_name => ({ field_name, type: 1 })),
  } })).table_id;
  const state = { table, fields, url: `https://guanghe.feishu.cn/base/${process.env.BITABLE_APP_TOKEN}?table=${table}` };
  await writeJson(path.join(work, 'knowledge-table.json'), state);
  console.log(JSON.stringify(state));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
