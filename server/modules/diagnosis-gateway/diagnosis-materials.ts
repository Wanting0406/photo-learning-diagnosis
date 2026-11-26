import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { InitialKnowledgePoint, CourseMatch, MaterialMatch, MaterialMatchesResult } from '@shared/api.interface';
import type { FeishuService, FeishuRecord } from './feishu.service';
import { object, string } from './diagnosis-normalize';

interface Material {
  id: string; recordId: string; name: string; year: number; exam: '中考' | '高考';
  subjects: string[]; region: string; orientation: string; sourceUrl: string;
  group: string; hash: string; token: string; thumbnail: string;
}
interface Mapping { materialId: string; subject: string; point: string; aliases: string[] }
export interface MaterialIndex { materials: Material[]; mappings: Mapping[] }
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((v): v is string => typeof v === 'string') : string(value).split(/[\n、,，;；]/u).map(v => v.trim()).filter(Boolean);
const normalize = (value: string): string => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const useful = (value: string): boolean => value.length >= 2 &&
  !['计算', '方法', '概念', '解题', '应用', '分析', '理解', '基础', '知识点', '实验', '数学', '物理',
    '化学', '生物', '函数', '方程', '图形', '性质', '综合', '习题册', '概念回顾'].includes(value);
const tokenOf = (value: unknown): string => {
  const token = string(object(Array.isArray(value) ? value[0] : undefined).file_token);
  return /^[A-Za-z0-9_-]{1,256}$/u.test(token) ? token : '';
};
export function parseMaterial(record: FeishuRecord): Material | undefined {
  const f = record.fields; const id = string(f['素材ID']); const year = Number(f['年度']); const exam = string(f['考试']);
  const token = tokenOf(f['原图附件']); const sourceUrl = string(f['来源链接']);
  if (f['审核状态'] !== '已审核' || !/^mat_[a-f0-9]{20}$/u.test(id) || ![2025, 2026].includes(year) ||
    !['中考', '高考'].includes(exam) || !token || !string(f['规范名称'])) return;
  try { const url = new URL(sourceUrl); if (url.origin !== 'https://guanghe.feishu.cn') return; } catch { return; }
  return { id, recordId: record.recordId, name: string(f['规范名称']), year, exam: exam as Material['exam'],
    subjects: strings(f['学科']), region: string(f['地区试卷']), orientation: string(f['版式']), sourceUrl,
    group: string(f['同内容组']) || string(f['去重标识']) || id,
    hash: /^[a-f0-9]{64}$/u.test(string(f['去重标识'])) ? string(f['去重标识']) : '',
    token, thumbnail: tokenOf(f['缩略图']) };
}
export function parseMaterialIndex(assets: FeishuRecord[], rows: FeishuRecord[]): MaterialIndex {
  const materials = assets.map(parseMaterial).filter((m): m is Material => Boolean(m));
  const known = new Map(materials.map(m => [m.id, m]));
  const mappings = rows.flatMap(({ fields: f }) => {
    const materialId = string(f['关联素材ID']); const point = string(f['标准知识点']); const subject = string(f['学科']);
    if (f['审核状态'] !== '已审核' || !known.get(materialId)?.subjects.includes(subject) || !useful(normalize(point)) ||
      !string(f['标注原文'])) return [];
    return [{ materialId, subject, point, aliases: strings(f['检索别名']) }];
  });
  return { materials, mappings };
}
function scoreTerm(query: string, point: string, aliases: string[]): number {
  const q = normalize(query); const p = normalize(point);
  if (!useful(q)) return 0;
  if (q === p) return 100;
  const names = aliases.map(normalize).filter(useful);
  if (names.includes(q)) return 90;
  return [p, ...names].some(term => term.length >= 3 && q.length >= 3 &&
    (term.includes(q) || q.includes(term)) && Math.min(term.length, q.length) / Math.max(term.length, q.length) >= 0.65) ? 60 : 0;
}
export function matchMaterials(index: MaterialIndex, grade: string, points: InitialKnowledgePoint[],
  courses: CourseMatch[] = [], note = ''): MaterialMatch[] {
  const exam = /^(初[一二三]|[七八九]年级)$/u.test(grade) ? '中考' : /^高[一二三]$/u.test(grade) ? '高考' : '';
  if (!exam) return [];
  const eligible = index.materials.filter(m => m.exam === exam);
  const ranked = eligible.map(material => {
    const hits: { point: string; subject: string; score: number }[] = [];
    for (const mapping of index.mappings.filter(row => row.materialId === material.id)) {
      let best = 0;
      for (const point of points.filter(p => p.subject === mapping.subject)) {
        best = Math.max(best, scoreTerm(point.name, mapping.point, mapping.aliases),
          ...point.keywords.map(k => scoreTerm(k, mapping.point, mapping.aliases) * 0.8));
        // A course title is supplementary evidence only when its associated visual knowledge point exists.
        for (const course of courses.filter(c => c.knowledgePoint === point.name && !c.reviewNote &&
          (!c.subject || c.subject === point.subject))) {
          best = Math.max(best, scoreTerm(course.title, mapping.point, mapping.aliases) * 0.7);
        }
      }
      if (best > 0) hits.push({ point: mapping.point, subject: mapping.subject, score: best });
    }
    const region = material.region.replace(/省|市|卷/gu, '');
    return { material, hits, best: Math.max(0, ...hits.map(h => h.score)),
      coverage: new Set(hits.map(h => h.point)).size, regionMatch: region.length >= 2 && note.includes(region) ? 1 : 0 };
  }).filter(r => r.hits.length).sort((a, b) => b.best - a.best || b.coverage - a.coverage ||
    b.regionMatch - a.regionMatch || b.material.year - a.material.year ||
    Number(b.material.orientation === '竖版') - Number(a.material.orientation === '竖版') || a.material.id.localeCompare(b.material.id));
  const seen = new Set<string>(); const results: MaterialMatch[] = [];
  for (const { material: m, hits } of ranked) {
    if (seen.has(m.group) || (m.hash && seen.has(m.hash))) continue;
    seen.add(m.group); if (m.hash) seen.add(m.hash);
    const imageUrl = `/api/diagnosis/materials/${m.id}/image`;
    const region = m.region.trim();
    const paperKnown = region && !/未知|未标注|待确认|待核实|不详|汇总|多地区|全国通用|^全国$/u.test(region);
    const examReferences = paperKnown ? hits.filter((hit, i) => hits.findIndex((other) =>
      other.point === hit.point && other.subject === hit.subject) === i).map((hit) => ({
      knowledgePoint: hit.point,
      paperName: `${m.year}年${m.exam}${hit.subject}（${region.endsWith('卷') ? region : `${region}卷`}）`,
    })) : [];
    results.push({ materialId: m.id, name: m.name, year: m.year, exam: m.exam, subjects: m.subjects,
      region: m.region, orientation: m.orientation, sourceUrl: m.sourceUrl,
      matchedKnowledgePoints: [...new Set(hits.map(h => h.point))], examReferences,
      imageUrl, previewUrl: `${imageUrl}?thumbnail=1` });
    if (results.length === 3) break;
  }
  return results;
}

export class MaterialCatalog {
  private cached?: { index: MaterialIndex; expires: number };
  private pending?: Promise<MaterialIndex>;
  constructor(private readonly feishu: Pick<FeishuService, 'listRecords' | 'getRecord' | 'downloadPhoto'>,
    private readonly now = Date.now) {}
  get configured(): boolean { return Boolean(process.env.BITABLE_MATERIAL_TABLE_ID && process.env.BITABLE_MATERIAL_MAPPING_TABLE_ID); }
  async index(): Promise<MaterialIndex> {
    if (!this.configured) throw new ServiceUnavailableException('宣传长图表尚未配置');
    if (this.cached && this.cached.expires > this.now()) return this.cached.index;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const [assets, mappings] = await Promise.all([this.readAll(process.env.BITABLE_MATERIAL_TABLE_ID!),
        this.readAll(process.env.BITABLE_MATERIAL_MAPPING_TABLE_ID!)]);
      const index = parseMaterialIndex(assets, mappings);
      this.cached = { index, expires: this.now() + 600000 }; return index;
    })();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  private async readAll(table: string): Promise<FeishuRecord[]> {
    const rows: FeishuRecord[] = []; let token = ''; const used = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const page = await this.feishu.listRecords(table, token, 500); rows.push(...page.items);
      if (!page.pageToken) return rows;
      if (used.has(page.pageToken)) throw new Error('Invalid material pagination');
      used.add(page.pageToken); token = page.pageToken;
    }
    throw new Error('Material index exceeds 10000 rows');
  }
  async match(grade: string, points: InitialKnowledgePoint[], courses: CourseMatch[], note: string): Promise<MaterialMatchesResult> {
    try {
      const items = matchMaterials(await this.index(), grade, points, courses, note);
      return { items, status: items.length ? 'ready' : 'empty', note: items.length ? '' : '未找到可靠匹配的中高考长图。' };
    } catch { return { items: [], status: 'unavailable', note: '宣传长图暂时不可用，可继续生成学情报告。' }; }
  }
  async image(id: string, thumbnail: boolean): Promise<{ body: Buffer; contentType: string; name: string }> {
    if (!/^mat_[a-f0-9]{20}$/u.test(id)) throw new NotFoundException('长图不存在');
    const cached = (await this.index()).materials.find(m => m.id === id);
    if (!cached) throw new NotFoundException('长图不存在或未审核');
    // Recheck approval before every attachment read, including during the index cache lifetime.
    const current = parseMaterial(await this.feishu.getRecord(process.env.BITABLE_MATERIAL_TABLE_ID!, cached.recordId));
    if (!current || current.id !== id) throw new NotFoundException('长图不存在或未审核');
    const photo = await this.feishu.downloadPhoto(thumbnail ? current.thumbnail || current.token : current.token, 32 * 1024 * 1024);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.contentType)) throw new NotFoundException('长图附件无效');
    const ext = photo.contentType.split('/')[1];
    return { ...photo, name: `${current.name.replace(/[\\/:*?"<>|\r\n]/gu, '_').slice(0, 100)}.${ext}` };
  }
}
