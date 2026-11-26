import type { LearningSourceKey, LearningSourceEnvelope } from '@shared/api.interface';

export async function sealLearningSource(url: string, metadata: LearningSourceKey): Promise<LearningSourceEnvelope> {
  const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const encode = (value: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(value)));
  const publicKey = await crypto.subtle.importKey('spki', decode(metadata.publicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode(`${metadata.keyId}:${metadata.userId}`) }, key,
  new TextEncoder().encode(JSON.stringify({ url, expiresAt: metadata.expiresAt })));
  const encryptedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, await crypto.subtle.exportKey('raw', key));
  return { keyId: metadata.keyId, iv: encode(iv), encryptedKey: encode(encryptedKey), ciphertext: encode(ciphertext) };
}
