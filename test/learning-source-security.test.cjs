require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { LearningSourceCrypto } = require('../server/modules/diagnosis-gateway/learning-source-crypto');
const { sealLearningSource } = require('../client/src/api/learning-source-seal');

test('browser envelope protects report URLs in platform logs and binds decryption to user and lifetime', async (t) => {
  const previous = process.env.LEARNING_SOURCE_PRIVATE_KEY;
  t.after(() => { if (previous === undefined) delete process.env.LEARNING_SOURCE_PRIVATE_KEY;
    else process.env.LEARNING_SOURCE_PRIVATE_KEY = previous; });
  process.env.LEARNING_SOURCE_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const service = new LearningSourceCrypto(); const metadata = service.publicKey('owner');
  const url = 'https://xxgj.yangcongxing.com/onion-learning/study-report/?token=Bearer%20test.secret.signature';
  const envelope = await sealLearningSource(url, metadata);
  assert.doesNotMatch(JSON.stringify(envelope), /Bearer|test\.secret|yangcongxing/u);
  assert.equal(service.open(envelope, 'owner'), url);
  assert.throws(() => service.open(envelope, 'other-user'));
  assert.throws(() => service.open({ url }, 'owner'));
  const bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[0] ^= 1;
  assert.throws(() => service.open({ ...envelope, ciphertext: bytes.toString('base64') }, 'owner'));
  assert.throws(() => service.open({ ...envelope, keyId: '0'.repeat(24) }, 'owner'));
  const expired = await sealLearningSource(url, { ...metadata, expiresAt: Date.now() - 1000 });
  assert.throws(() => service.open(expired, 'owner'));
});
