import { stageGrades } from '@shared/diagnosis-scope';
import type { Course } from './diagnosis-knowledge';
import { CourseSnapshotCache } from './course-snapshot-cache';
import { normalizeFields, type FeishuService } from './feishu.service';
import { object, string } from './diagnosis-normalize';

export const allCourseSubjects = ['数学', '物理', '化学', '生物', '英语', '语文', '地理', '历史', '道德与法治', '政治'];
export interface AllCourse extends Course {
  subject: string; sourceUrl: string; eligibleGrades: number[];
  book?: string; region?: string; package?: string; reviewNote?: string;
}
const grades = Object.values(stageGrades).flat();
const term = (value: string): string => value.normalize('NFKC').replace(/^第\d+讲\s*/u, '')
  .replace(/[\s，。；：、（）()]/gu, '').toLowerCase();

export function parseAllCourses(items: unknown[], base: string, table: string): AllCourse[] {
  if (!/^[A-Za-z0-9]+$/u.test(base) || !/^tbl[A-Za-z0-9]+$/u.test(table)) throw new Error('Invalid directory source');
  return items.flatMap((item) => {
    const record = object(item); const fields = normalizeFields(record.fields);
    const recordId = string(record.record_id); const title = string(fields['课程名称']);
    const subject = string(fields['学科']); const stage = string(fields['适用学段']);
    const grade = string(fields['适用年级']);
    const allowed = stageGrades[stage];
    const scope = grade === stage ? allowed : grade.split('、');
    if (!/^rec[A-Za-z0-9]+$/u.test(recordId) || !title || title.length > 200 ||
      !allCourseSubjects.includes(subject) || fields['审核状态'] !== '已核对' || !allowed ||
      !scope?.length || scope.some(g => !allowed.includes(g))) return [];
    const book = string(fields['册别']); const region = string(fields['地区']);
    const reviewNote = [grade === stage ? '原目录未标具体年级，使用前核对册别和学习进度。' : '',
      region === '本地化' ? '本地化目录未指定地区，使用前核对所在地区。' : ''].filter(Boolean).join(' ');
    return [{ recordId, title, subject, grade, eligibleGrades: scope.map(g => grades.indexOf(g) + 1),
      edition: string(fields['教材版本']), courseType: string(fields['课程类型']), book, region,
      package: string(fields['课程包']), reviewNote,
      terms: [...new Set([title, ...string(fields['知识点名称']).split('\n'), ...string(fields['检索别名']).split('\n')]
        .map(term).filter(Boolean))],
      sourceUrl: `https://guanghe.feishu.cn/base/${base}?table=${table}&record=${recordId}` }];
  });
}

export class AllCourseCatalog {
  private readonly sources: CourseSnapshotCache<AllCourse[]>[];
  readonly configured: boolean;
  constructor(private readonly feishu: Pick<FeishuService, 'request'>, now = Date.now) {
    const raw = process.env.BITABLE_ALL_COURSE_TABLES || '';
    this.configured = Boolean(raw);
    let tables: string[] = [];
    try {
      const config = object(JSON.parse(raw || '{}'));
      const keys = Object.keys(config);
      if (keys.some(key => !stageGrades[key]) || keys.length > 3) throw new Error('Invalid directory config');
      tables = Object.values(config).map(string);
      if (tables.some(table => !/^tbl[A-Za-z0-9]+$/u.test(table)) || new Set(tables).size !== tables.length) {
        throw new Error('Invalid directory tables');
      }
    } catch {
      // Surface invalid configuration through the normal partial-source failure path.
      tables = [''];
    }
    this.sources = tables.map(table => new CourseSnapshotCache(() => this.load(table), now));
  }
  async read(): Promise<{ courses: AllCourse[]; failed: boolean }> {
    const reads = await Promise.allSettled(this.sources.map(source => source.read()));
    return { courses: reads.flatMap(read => read.status === 'fulfilled' ? read.value : []),
      failed: reads.some(read => read.status === 'rejected') };
  }
  private async load(table: string): Promise<AllCourse[]> {
    const base = process.env.BITABLE_APP_TOKEN || '';
    if (!/^tbl[A-Za-z0-9]+$/u.test(table) || !/^[A-Za-z0-9]+$/u.test(base)) throw new Error('Invalid directory config');
    const courses: AllCourse[] = []; const seen = new Set<string>(); let token = '';
    for (let page = 0; page < 60; page++) {
      const data = await this.feishu.request('GET', `/bitable/v1/apps/${base}/tables/${table}/records`, undefined,
        { page_size: '500', ...(token ? { page_token: token } : {}) });
      if (!data.items && data.total === 0 && !data.has_more) return courses;
      if (!Array.isArray(data.items)) throw new Error('Invalid directory page');
      courses.push(...parseAllCourses(data.items, base, table));
      if (!data.has_more) return courses;
      const next = string(data.page_token);
      if (!next || seen.has(next)) throw new Error('Invalid directory cursor');
      seen.add(next); token = next;
    }
    throw new Error('Directory exceeds 30000 records per table');
  }
}
