import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createPrivateKey, createPublicKey, createDecipheriv, privateDecrypt, constants } from 'node:crypto';
import { z } from 'zod';
import type { LearningSourceKey } from '@shared/api.interface';

const base64 = (max: number) => z.string().min(4).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/u);
const envelopeSchema = z.object({ keyId: z.string().length(24), encryptedKey: base64(512), iv: base64(24),
  ciphertext: base64(40000) }).strict();

@Injectable()
export class LearningSourceCrypto {
  private keys() {
    try {
      const privateKey = createPrivateKey(process.env.LEARNING_SOURCE_PRIVATE_KEY || '');
      const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
      return { privateKey, publicKey, keyId: createHash('sha256').update(publicKey).digest('hex').slice(0, 24) };
    } catch { throw new ServiceUnavailableException('报告链接安全读取尚未配置，请使用截图'); }
  }
  publicKey(userId: string): LearningSourceKey {
    const { publicKey, keyId } = this.keys();
    return { publicKey, keyId, userId, expiresAt: Date.now() + 120000 };
  }
  open(value: unknown, userId: string): string {
    const { privateKey, keyId } = this.keys();
    try {
      const envelope = envelopeSchema.parse(value);
      if (envelope.keyId !== keyId) throw new Error('Key changed');
      const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(envelope.encryptedKey, 'base64'));
      const iv = Buffer.from(envelope.iv, 'base64'); const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
      if (key.length !== 32 || iv.length !== 12 || ciphertext.length <= 16) throw new Error('Invalid envelope');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(`${keyId}:${userId}`)); decipher.setAuthTag(ciphertext.subarray(-16));
      const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8');
      const payload = z.object({ url: z.string().max(6000), expiresAt: z.number() }).strict().parse(JSON.parse(plain));
      if (payload.expiresAt < Date.now() || payload.expiresAt > Date.now() + 150000) throw new Error('Expired');
      return payload.url;
    } catch { throw new BadRequestException('报告链接安全请求已失效，请重试读取'); }
  }
}
