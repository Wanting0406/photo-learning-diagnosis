import { ServiceUnavailableException } from '@nestjs/common';
import type { FeishuRecord, FeishuService } from './feishu.service';
import type { ProductCapability } from './diagnosis-product-library';
import { object, string } from './diagnosis-normalize';

export const PRODUCT_TABLE_ID = 'tblggOwW4EDlOjKt';
export const productTableId = (): string => process.env.BITABLE_MAPPING_TABLE_ID || PRODUCT_TABLE_ID;
export const productValues = (v: unknown): string[] => (Array.isArray(v) ? v.map(string) : string(v).split(/[,，、；;\n]/u))
  .map(s => s.trim()).filter(Boolean);
const stages = ['小学', '初中', '高中'];
const subjects = ['数学', '语文', '英语', '物理', '化学', '生物', '地理', '历史', '道德与法治', '政治', '科学', '其他'];
const grades = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'];
export function parseCapability(record: FeishuRecord): ProductCapability | undefined {
  const f = record.fields;
  if (string(f['启用状态']) !== '启用') return;
  const id = string(f['产品能力ID']).trim() || `CAP-CUSTOM-${record.recordId}`;
  const scope = productValues(f['适用学段']); const subjectScope = productValues(f['适用学科']);
  const gradeScope = productValues(f['适用年级']);
  const capability: ProductCapability = { id, name: string(f['产品名称']).trim(), trigger: string(f['问题场景']).trim(),
    sequence: string(f['作用说明']).trim(), acceptance: string(f['验收标准']).trim(), boundary: string(f['使用边界']).trim(),
    recordId: record.recordId, stages: scope,
    sourceUrl: string(f['来源链接']).trim() || `https://guanghe.feishu.cn/base/${process.env.BITABLE_APP_TOKEN || ''}?table=${productTableId()}&record=${record.recordId}`,
    verifiedAt: string(f['核对日期']).trim() };
  capability.functionAccess = string(f['功能使用说明']).trim();
  const category = string(f['类别']);
  if (!['产品', '卖点'].includes(category) || capability.functionAccess.length > 1500) return;
  capability.category = category as '产品' | '卖点';
  if (!/^CAP-[A-Za-z0-9-]{3,80}$/u.test(id) || !scope.length || scope.some(s => !stages.includes(s)) ||
    !subjectScope.length || !gradeScope.length ||
    subjectScope.some(s => s !== '全部' && !subjects.includes(s)) ||
    gradeScope.some(g => g !== '全部' && !grades.includes(g)) ||
    [capability.name, capability.trigger, capability.sequence, capability.acceptance, capability.boundary]
      .some(v => !v || v.length > 1500) || capability.name.length > 100) return;
  if (!subjectScope.includes('全部')) capability.subjects = subjectScope;
  if (!gradeScope.includes('全部')) capability.grades = gradeScope;
  if (capability.sourceUrl) {
    try { if (new URL(capability.sourceUrl).origin !== 'https://guanghe.feishu.cn') return; } catch { return; }
  }
  return capability;
}
export function linkedProductIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : object(value).record_ids;
  return Array.isArray(raw) ? raw.flatMap(v => {
    if (typeof v === 'string') return [v];
    const part = object(v);
    return Array.isArray(part.record_ids) ? part.record_ids.map(string) : [string(part.record_id)];
  }).filter(v => /^rec[A-Za-z0-9]+$/u.test(v)) : [];
}

export class ProductCapabilityCatalog {
  private cached?: { items: ProductCapability[]; expires: number };
  private pending?: Promise<ProductCapability[]>;
  constructor(private readonly feishu: Pick<FeishuService, 'listRecords'>, private readonly now = Date.now) {}
  async read(refresh = false): Promise<ProductCapability[]> {
    if (!refresh && this.cached && this.cached.expires > this.now()) return this.cached.items;
    if (this.pending) return this.pending;
    this.pending = this.load();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  private async load(): Promise<ProductCapability[]> {
    try {
      const rows: FeishuRecord[] = []; const cursors = new Set<string>(); let token = '';
      for (let page = 0; page < 10; page++) {
        const result = await this.feishu.listRecords(productTableId(), token, 100);
        rows.push(...result.items);
        if (!result.pageToken) {
          const enabled = rows.filter(r => string(r.fields['启用状态']) === '启用');
          const items = enabled.map(parseCapability); const ids = new Set<string>();
          for (const item of items) {
            if (!item || ids.has(item.id)) throw new Error('Incomplete or duplicate enabled product');
            ids.add(item.id);
          }
          const valid = items.filter((c): c is ProductCapability => Boolean(c));
          this.cached = { items: valid, expires: this.now() + 60000 }; return valid;
        }
        if (cursors.has(result.pageToken)) throw new Error('Product pagination repeated');
        cursors.add(result.pageToken); token = result.pageToken;
      }
      throw new Error('Product table too large');
    } catch { throw new ServiceUnavailableException('产品映射表读取失败，或启用产品字段不完整/编号重复，请核对后重试'); }
  }
}

const sharedProducts = new WeakMap<Pick<FeishuService, 'listRecords'>, { scope: string; catalog: ProductCapabilityCatalog }>();
export function sharedProductCatalog(feishu: Pick<FeishuService, 'listRecords'>): ProductCapabilityCatalog {
  const scope = `${process.env.BITABLE_APP_TOKEN || ''}:${productTableId()}`;
  const existing = sharedProducts.get(feishu);
  if (existing?.scope === scope) return existing.catalog;
  const catalog = new ProductCapabilityCatalog(feishu);
  sharedProducts.set(feishu, { scope, catalog });
  return catalog;
}
