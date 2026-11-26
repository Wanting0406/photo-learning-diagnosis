const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const source = dotenv.parse(fs.readFileSync(path.resolve(root, '../.env')));
const envFile = path.join(root, '.env.local');
const local = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
const allowed = ['FEISHU_APP_ID',
  'FEISHU_APP_SECRET', 'BITABLE_APP_TOKEN', 'BITABLE_DIAGNOSIS_TABLE_ID', 'BITABLE_MAPPING_TABLE_ID'];
for (const key of allowed) if (!source[key]) throw new Error(`Missing ${key}`);

async function main() {
  const auth = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: source.FEISHU_APP_ID, app_secret: source.FEISHU_APP_SECRET }),
    signal: AbortSignal.timeout(15000),
  });
  const authBody = await auth.json();
  if (!auth.ok || authBody.code !== 0 || !authBody.tenant_access_token) throw new Error('Feishu authentication failed');
  const call = async (method, suffix, body) => {
    const response = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${source.BITABLE_APP_TOKEN}${suffix}`, {
      method, headers: { Authorization: `Bearer ${authBody.tenant_access_token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0) throw new Error(`Feishu operation failed (${result.code})`);
    return result.data;
  };
  const name = '诊断任务';
  const tables = await call('GET', '/tables?page_size=100');
  let table = tables.items.find((item) => item.name === name);
  const columns = ['请求编号', '提交用户', '学生姓名', '模式', '状态', '进度', '输入摘要', '结果', '错误'];
  const schema = { table: { name, default_view_name: '全部任务', fields: [
    ...columns.map((field_name) => ({ field_name, type: 1 })), { field_name: '开始时间', type: 2 },
  ] } };
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ action: table ? 'reuse-task-table' : 'create-task-table', appToken: source.BITABLE_APP_TOKEN,
      tableName: name, fieldNames: [...columns, '开始时间'], existingTableId: table?.table_id || null,
      localEnvKeys: [...allowed, 'BITABLE_TASK_TABLE_ID', 'BODY_SIZE_LIMIT'] }, null, 2));
    return;
  }
  if (!table) {
    const created = await call('POST', '/tables', schema);
    table = { table_id: created.table_id, name };
  }
  const fields = await call('GET', `/tables/${table.table_id}/fields?page_size=100`);
  for (const expected of schema.table.fields) {
    if (!fields.items.some((field) => field.field_name === expected.field_name && field.type === expected.type)) {
      throw new Error(`Task field mismatch: ${expected.field_name}`);
    }
  }
  for (const key of allowed) local[key] = source[key];
  local.BITABLE_TASK_TABLE_ID = table.table_id;
  local.BODY_SIZE_LIMIT = '18mb';
  const text = Object.entries(local).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
  fs.writeFileSync(envFile, text, { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);
  console.log(JSON.stringify({ taskTableId: table.table_id, configuration: 'saved to ignored .env.local', secretsPrinted: false }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
