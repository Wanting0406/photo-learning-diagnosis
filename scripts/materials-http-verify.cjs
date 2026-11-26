const assert = require('node:assert/strict');
const path = require('node:path');
const { readJson, writeJson } = require('./materials-import.cjs');

async function main() {
  const work = process.argv[2];
  const fixtures = await readJson(path.join(work, 'ui-fixtures.json'));
  const candidates = await readJson(path.join(work, 'candidates.json'));
  const first = candidates.find(r => r.pilot);
  const checks = [];
  const userId = process.argv[3];
  if (!/^\d{10,30}$/u.test(userId || '')) throw new Error('Pass the local verification session user ID');
  async function check(name, route, roles, expected, owner = userId) {
    // This exercises the platform guards through their documented local gateway identity header.
    const response = await fetch(`http://localhost:3000/app/app_17dsmxamvns/api/diagnosis/${route}`, {
      headers: { cookie: 'suda-csrf-token=materials-local-verification', 'x-suda-csrf-token': 'materials-local-verification',
        'x-larkgw-suda-webuser': encodeURIComponent(JSON.stringify({ app_id: 'app_17dsmxamvns', env: 'dev',
          ...(roles === null ? {} : { user_id: owner, roles }) })) }, redirect: 'manual', signal: AbortSignal.timeout(45000),
    });
    assert.equal(response.status, expected, name);
    if (expected === 200 && route.includes('/image')) assert.ok(response.headers.get('content-type').startsWith('image/'));
    if (expected === 200 && route.endsWith('/materials')) assert.ok((await response.json()).items.length > 0);
    else await response.arrayBuffer();
    checks.push({ name, status: response.status });
  }
  const route = `jobs/${fixtures[0].recordId}/materials`;
  await check('unauthenticated', route, null, 403);
  await check('no business role', route, [], 403);
  await check('sales matching', route, ['sales'], 200);
  await check('admin matching', route, ['admin'], 200);
  await check('task ownership', route, ['sales'], 404, `${userId}1`);
  await check('sales image', `materials/${first.id}/image?thumbnail=1`, ['sales'], 200);
  await check('arbitrary attachment denied', 'materials/arbitrary-file-token/image', ['sales'], 404);
  await check('unknown material denied', 'materials/mat_00000000000000000000/image', ['sales'], 404);
  await check('invalid image flags', `materials/${first.id}/image?thumbnail=2`, ['sales'], 400);
  await check('sales admin config denied', 'admin/config', ['sales'], 403);
  await check('admin config allowed', 'admin/config', ['admin'], 200);
  await writeJson(path.join(work, 'verification-http.json'), { at: new Date().toISOString(), checks,
    identityMode: 'localhost-only gateway simulation; no production permission changes' });
  console.log(JSON.stringify(checks));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
