const fs = require('node:fs');
const { generateKeyPairSync } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const file = '.env.local';
if (process.argv[2] !== '--apply') throw new Error('Pass --apply to configure the report-link encryption key');
const existing = fs.readFileSync(file, 'utf8');
let key = dotenv.parse(existing).LEARNING_SOURCE_PRIVATE_KEY;
if (!key) {
  key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  fs.appendFileSync(file, '\nLEARNING_SOURCE_PRIVATE_KEY=' + JSON.stringify(key) + '\n');
}
for (const environment of ['dev', 'online']) {
  const result = spawnSync('lark-cli', ['apps', '+env-set', '--app-id', 'app_17dsmxamvns', '--environment', environment,
    '--key', 'LEARNING_SOURCE_PRIVATE_KEY', '--value', '-', ...(environment === 'online' ? ['--yes'] : [])],
  { input: key, encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0 || !JSON.parse(result.stdout).ok) throw new Error('Key configuration failed: ' + environment);
  console.log(environment + ': report-link encryption configured');
}
