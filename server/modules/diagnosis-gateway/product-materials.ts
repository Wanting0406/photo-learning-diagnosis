import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { LearningPlanReport, ProductMaterialMatch, ProductMaterialResult } from '@shared/api.interface';
import type { FeishuRecord, FeishuService } from './feishu.service';
import { object, string } from './diagnosis-normalize';
import { eligibleCapabilities, PRODUCT_CAPABILITIES, type ProductCapability } from './diagnosis-product-library';
import { ProductCapabilityCatalog, linkedProductIds, productValues } from './product-capability-catalog';
import { schoolStage, stageGrades } from '@shared/diagnosis-scope';
import { materialApproved } from './material-approval';
import { materialSalesIntroduction } from './material-sales-copy';

interface ProductMaterial extends ProductMaterialMatch {
  recordId: string; token: string; stages: string[]; subjects: string[]; hash: string;
  searchText: string; titleText: string; grades: string[];
}
const values = productValues;
export function parseProductMaterial(record: FeishuRecord,
  products: ProductCapability[] = PRODUCT_CAPABILITIES): ProductMaterial | undefined {
  const f = record.fields; const id = string(f['素材ID']) || `prod_${record.recordId.toLowerCase()}`;
  const token = string(object(Array.isArray(f['原图附件']) ? f['原图附件'][0] : undefined).file_token);
  const linked = linkedProductIds(f['关联产品']);
  const capabilityIds = products.filter(c => linked.includes(c.recordId || '')).map(c => c.id);
  const source = string(f['来源链接']).trim();
  // Some reviewed rows contain a source title; link to the maintained record in that case.
  const sourceUrl = /^[a-z][a-z0-9+.-]*:/iu.test(source) ? source
    : `https://guanghe.feishu.cn/base/${process.env.BITABLE_APP_TOKEN || ''}?table=${process.env.BITABLE_PRODUCT_MATERIAL_TABLE_ID || 'tblbIbCiWjza35RR'}&record=${record.recordId}`;
  const stages = values(f['适用学段']);
  if (!materialApproved(record) || !/^prod_[a-z0-9_]{3,60}$/u.test(id) ||
    !/^[A-Za-z0-9_-]{1,256}$/u.test(token) || !string(f['素材名称']) ||
    !stages.length || stages.some(s => !['小学', '初中', '高中'].includes(s))) return;
  try { if (new URL(sourceUrl).origin !== 'https://guanghe.feishu.cn') return; } catch { return; }
  return { materialId: id, recordId: record.recordId, token, name: string(f['素材名称']), capabilityIds,
    titleText: [string(f['素材名称']), string(f['识别标题'])].join(' '),
    searchText: [string(f['素材名称']), string(f['识别标题']), string(f['内容摘要'])].join(' '),
    grades: values(f['适用年级']),
    sourceUrl, stages, subjects: values(f['适用学科']), hash: string(f.SHA256),
    summary: string(f['内容摘要']), boundary: string(f['使用边界']) };
}
export function matchProductMaterials(materials: ProductMaterial[], report: LearningPlanReport,
  products: ProductCapability[] = PRODUCT_CAPABILITIES): ProductMaterial[] {
  const stage = schoolStage(report.grade);
  const eligible = eligibleCapabilities(report.grade, report.subjects, products);
  const preferred = new Set(report.solutions.flatMap(s => [s.capabilityId, ...(s.sellingPoints || []).map(p => p.capabilityId)]));
  const compact = (text: string): string => text.normalize('NFKC').replace(/\s/gu, '').toLowerCase();
  const candidates = materials.filter(m => {
    const declared = m.grades?.filter(g => g !== '全部') || [];
    const titleGrades = Object.values(stageGrades).flat().filter(g => m.titleText?.includes(g));
    const grades = declared.length ? declared : titleGrades;
    return m.stages.includes(stage) && (!m.subjects.length || m.subjects.includes('全部') ||
      report.subjects.some(s => m.subjects.includes(s))) && (!grades.length || grades.includes(report.grade) ||
      (stageGrades[report.grade]?.every(g => grades.includes(g)) ?? false));
  });
  const ranked = candidates.map(material => {
    const text = compact(material.searchText || material.name + material.summary);
    const matched = eligible.filter(product => {
      const subjects = product.subjects?.filter(s => report.subjects.includes(s)) || report.subjects;
      if (material.subjects.length && !material.subjects.includes('全部') &&
        !subjects.some(s => material.subjects.includes(s))) return false;
      const name = compact(product.name);
      return material.capabilityIds.includes(product.id) || (name.length >= 4 && text.includes(name));
    });
    const recommended = matched.some(p => preferred.has(p.id));
    const score = (recommended ? 1000 : 0) + matched.filter(p => material.capabilityIds.includes(p.id)).length * 10;
    const names = matched.map(p => p.name);
    const introduction = materialSalesIntroduction(matched, material.titleText);
    const productIds = [...new Set([...matched.filter(p => p.category === '产品').map(p => p.id),
      ...report.solutions.filter(s => matched.some(p => p.id === s.capabilityId ||
        s.sellingPoints?.some(point => point.capabilityId === p.id))).map(s => s.capabilityId)])];
    return { score, material: { ...material, capabilityIds: matched.map(p => p.id), productIds,
      capabilityNames: names, introduction, recommendation: recommended ? 'recommended' as const : 'optional' as const,
      matchedText: recommended ? '与本次推荐相关' : '同学段学科备选，需结合孩子需求选择' } };
  }).filter(r => r.material.capabilityIds.length)
    .sort((a, b) => b.score - a.score || a.material.materialId.localeCompare(b.material.materialId));
  const selected: ProductMaterial[] = [];
  const seen = new Set<string>();
  for (const { material } of ranked) {
    const key = material.hash || material.materialId;
    if (seen.has(key)) continue;
    seen.add(key); selected.push(material);
  }
  return selected;
}
export class ProductMaterialCatalog {
  private cached?: { items: FeishuRecord[]; expires: number };
  private pending?: Promise<FeishuRecord[]>;
  private readonly products: ProductCapabilityCatalog;
  constructor(private readonly feishu: Pick<FeishuService, 'listRecords' | 'getRecord' | 'downloadPhoto'>,
    private readonly now = Date.now, products?: ProductCapabilityCatalog) {
    this.products = products || new ProductCapabilityCatalog(feishu, now);
  }
  async preload(refresh = false): Promise<void> {
    await Promise.allSettled([this.products.read(refresh), this.index(refresh)]);
  }
  private get table(): string { return process.env.BITABLE_PRODUCT_MATERIAL_TABLE_ID || 'tblbIbCiWjza35RR'; }
  private async index(refresh = false): Promise<FeishuRecord[]> {
    if (!this.table) throw new ServiceUnavailableException('产品物料表尚未配置');
    if (!refresh && this.cached && this.cached.expires > this.now()) return this.cached.items;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const rows: FeishuRecord[] = []; const seen = new Set<string>(); let token = '';
      for (let page = 0; page < 10; page++) {
        const result = await this.feishu.listRecords(this.table, token, 500); rows.push(...result.items);
        if (!result.pageToken) {
          this.cached = { items: rows, expires: this.now() + 60000 }; return rows;
        }
        if (seen.has(result.pageToken)) throw new Error('Invalid product material pagination');
        seen.add(result.pageToken); token = result.pageToken;
      }
      throw new Error('Product material index too large');
    })();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  async match(report: LearningPlanReport): Promise<ProductMaterialResult> {
    try {
      const [products, records] = await Promise.all([this.products.read(), this.index()]);
      const materials = records.map(r => parseProductMaterial(r, products))
        .filter((m): m is ProductMaterial => Boolean(m));
      const matches = matchProductMaterials(materials, report, products);
      const items: ProductMaterialMatch[] = matches.map(m => ({ materialId: m.materialId, name: m.name,
        productIds: m.productIds, matchedText: m.matchedText,
        introduction: m.introduction, recommendation: m.recommendation, capabilityNames: m.capabilityNames,
        capabilityIds: m.capabilityIds, sourceUrl: m.sourceUrl, summary: m.summary, boundary: m.boundary }));
      return { items, status: items.length ? 'ready' : 'empty', note: items.length ? '' : '暂无符合当前学段和学科的宣传物料。' };
    } catch { return { items: [], status: 'unavailable', note: '产品物料暂时不可用，推荐内容仍可查看。' }; }
  }
  async image(id: string, report: LearningPlanReport): Promise<{ body: Buffer; contentType: string; name: string }> {
    if (!/^prod_[a-z0-9_]{3,60}$/u.test(id)) throw new NotFoundException('产品物料不存在');
    const products = await this.products.read();
    const materials = (await this.index()).map(r => parseProductMaterial(r, products))
      .filter((m): m is ProductMaterial => Boolean(m));
    const selected = matchProductMaterials(materials, report, products).find(m => m.materialId === id);
    if (!selected) throw new NotFoundException('产品物料不属于本次推荐');
    const current = parseProductMaterial(await this.feishu.getRecord(this.table, selected.recordId), products);
    if (!current || current.materialId !== id || !matchProductMaterials([current], report, products).length) {
      throw new NotFoundException('产品物料已撤销或不适用');
    }
    const photo = await this.feishu.downloadPhoto(current.token, 16 * 1024 * 1024);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(photo.contentType)) throw new NotFoundException('附件无效');
    return { ...photo, name: `${current.name.replace(/[\\/:*?"<>|\r\n]/gu, '_').slice(0, 80)}.${photo.contentType.split('/')[1]}` };
  }
}

const sharedMaterials = new WeakMap<Pick<FeishuService, 'listRecords' | 'getRecord' | 'downloadPhoto'>,
  { scope: string; catalog: ProductMaterialCatalog }>();
export function sharedProductMaterials(feishu: Pick<FeishuService, 'listRecords' | 'getRecord' | 'downloadPhoto'>,
  products: ProductCapabilityCatalog): ProductMaterialCatalog {
  const scope = `${process.env.BITABLE_APP_TOKEN || ''}:${process.env.BITABLE_PRODUCT_MATERIAL_TABLE_ID || 'tblbIbCiWjza35RR'}`;
  const existing = sharedMaterials.get(feishu);
  if (existing?.scope === scope) return existing.catalog;
  const catalog = new ProductMaterialCatalog(feishu, Date.now, products);
  sharedMaterials.set(feishu, { scope, catalog });
  return catalog;
}
