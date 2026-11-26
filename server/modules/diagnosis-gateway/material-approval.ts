import { createHash } from 'node:crypto';
import type { FeishuRecord } from './feishu.service';
import { string, object } from './diagnosis-normalize';
import { linkedProductIds, productValues } from './product-capability-catalog';
import { reviewedMaterials } from './reviewed-product-materials';

export function materialFingerprint(record: FeishuRecord): string {
  const f = record.fields;
  return createHash('sha256').update(JSON.stringify({
    text: ['素材ID', '素材名称', '识别标题', '内容摘要', '使用边界', '来源链接'].map(key => string(f[key])),
    scope: ['适用学段', '适用学科', '适用年级'].map(key => productValues(f[key]).sort()),
    products: linkedProductIds(f['关联产品']).sort(),
    photos: (Array.isArray(f['原图附件']) ? f['原图附件'] : []).map(photo => string(object(photo).file_token)).sort(),
  })).digest('hex');
}
export function materialApproved(record: FeishuRecord): boolean {
  if (record.fields['审核状态'] != null) return record.fields['审核状态'] === '已核对';
  return reviewedMaterials[record.recordId] === materialFingerprint(record);
}
