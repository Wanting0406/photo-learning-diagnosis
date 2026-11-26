const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const environment = args[args.indexOf('--environment') + 1];
if (!['dev', 'online'].includes(environment)) throw new Error('Specify --environment dev or online');
const values = dotenv.parse(fs.readFileSync(path.join(root, '.env.local')));
const keys = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET',
  'BITABLE_APP_TOKEN', 'BITABLE_DIAGNOSIS_TABLE_ID', 'BITABLE_MAPPING_TABLE_ID', 'BITABLE_TASK_TABLE_ID',
  'BODY_SIZE_LIMIT', 'LOG_REQUEST_BODY', 'LOG_RESPONSE_BODY', 'LEARNING_SOURCE_PRIVATE_KEY'];
const dataWork = args.includes('--data-work') ? args[args.indexOf('--data-work') + 1] : '';
if (dataWork) {
  const state = (file) => JSON.parse(fs.readFileSync(path.join(dataWork, file), 'utf8'));
  const materials = state('materials-work/feishu-import.json');
  Object.assign(values, { BITABLE_MATH_TABLE_ID: state('math-work/feishu-import.json').table,
    BITABLE_MATH_KNOWLEDGE_TABLE_ID: state('math-work/knowledge-table.json').table,
    BITABLE_SENIOR_KNOWLEDGE_TABLE_ID: state('math-work/senior-other-table.json').table,
    BITABLE_MATERIAL_TABLE_ID: materials.materials, BITABLE_MATERIAL_MAPPING_TABLE_ID: materials.mappings });
  keys.push('BITABLE_MATH_TABLE_ID', 'BITABLE_MATH_KNOWLEDGE_TABLE_ID', 'BITABLE_SENIOR_KNOWLEDGE_TABLE_ID', 'BITABLE_MATERIAL_TABLE_ID', 'BITABLE_MATERIAL_MAPPING_TABLE_ID');
}
Object.assign(values, { BODY_SIZE_LIMIT: '18mb', LOG_REQUEST_BODY: 'false', LOG_RESPONSE_BODY: 'false' });
for (const key of keys) if (!values[key]) throw new Error(`Missing configuration: ${key}`);
// Optional tables synced only when explicitly provided.
if (values.BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID?.trim()) keys.push('BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID');
if (values.BITABLE_ALL_COURSE_TABLES?.trim()) keys.push('BITABLE_ALL_COURSE_TABLES');

for (const key of keys) {
  if (!args.includes('--apply')) { console.log(`${environment}: ${key} ready`); continue; }
  const result = spawnSync('lark-cli', ['apps', '+env-set', '--app-id', 'app_17dsmxamvns',
    '--environment', environment, '--key', key, '--value', '-', ...(environment === 'online' ? ['--yes'] : [])],
  { cwd: root, input: values[key], encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  let response;
  try { response = JSON.parse(result.status === 0 ? result.stdout : result.stderr); } catch { response = {}; }
  if (result.status !== 0 || response.ok !== true) {
    console.error(`${environment}: ${key} failed (exit=${result.status}, code=${response.error?.code ?? 'unknown'})`);
    process.exitCode = 1; break;
  }
  console.log(`${environment}: ${key} configured`);
}
