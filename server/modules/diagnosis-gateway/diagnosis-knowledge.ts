import type { CourseMatch, Diagnosis, InitialKnowledgePoint } from '@shared/api.interface';
import type { FeishuService } from './feishu.service';
import { normalizeFields } from './feishu.service';
import { object, string } from './diagnosis-normalize';
import { CourseSnapshotCache } from './course-snapshot-cache';

export const physicsCatalog = {
  baseToken: 'YdJSbLkOsak2BXsEqUfcMfIunIg', tableId: 'tblywBqDyvCL1fcm',
  name: '初中物理课程目录与调整 - 2026 0828',
};
export interface Course {
  recordId: string; title: string; grade: string; edition: string; courseType: string; terms: string[];
}
const clean = (value: string): string => value.replace(/专题|知识点|[\s\d\p{P}\p{S}]/gu, '').toLowerCase();
const gradeNumber = (value: string): string => {
  if (/初二|八/u.test(value)) return '8';
  if (/初三|九/u.test(value)) return '9';
  return '';
};
export function parsePhysicsCourses(items: unknown[]): Course[] {
  return items.flatMap((item) => {
    const record = object(item); const fields = normalizeFields(record.fields);
    const title = string(fields['视频名']); const adjustment = string(fields['内容是否需要调整']);
    const progress = string(fields['进度']); const recordId = string(record.record_id);
    if (!title || !/^rec[A-Za-z0-9]+$/u.test(recordId) || /下掉/u.test(adjustment)) return [];
    // This is an editorial catalog. Pending new/reworked lessons are not proof of an available course.
    if (/增补|重做|大调整/u.test(adjustment) && !['已替换', '评估不改'].includes(progress)) return [];
    return [{ recordId, title, grade: string(fields['年级']), edition: string(fields['教材版本']),
      courseType: string(fields['课程类型']),
      terms: [title, string(fields['专题']), string(fields['节'])].map(clean).filter(Boolean) }];
  });
}
function termRelevance(point: string, terms: string[]): number {
  const query = clean(point);
  if (query.length < 2 || ['计算', '方法', '概念', '应用', '分析', '理解', '解题'].includes(query)) return 0;
  let best = 0;
  for (const term of terms) {
    if (term === query) return 100;
    if (term.includes(query)) best = Math.max(best, 80);
    else if (term.length >= 3 && query.includes(term)) best = Math.max(best, 70);
    else {
      const pairs = new Set(Array.from({ length: query.length - 1 }, (_, i) => query.slice(i, i + 2)));
      const overlap = [...pairs].filter((pair) => term.includes(pair)).length;
      const coverage = overlap / pairs.size;
      if (overlap >= 2 && coverage >= 0.7) best = Math.max(best, Math.round(coverage * 50));
    }
  }
  return best;
}
function relevance(point: string, terms: string[]): number {
  // Model labels often append a concrete example after the curriculum concept.
  return Math.max(...[point, ...point.split(/[：:；;，,（）()]/u)]
    .map((part) => termRelevance(part, terms)));
}
export function matchPhysicsCourses(d: Diagnosis, courses: Course[], note = ''): CourseMatch[] {
  const points = [...new Set(d.problems.filter((p) => p.subject === '物理').map((p) => p.knowledgePoint)
    .concat(d.subjects.length === 1 && d.subjects[0] === '物理' ? d.weakPoints : []))];
  return matchPhysicsKnowledge(d.grade, points.map((name) => ({ subject: '物理', name, keywords: [] })), courses, note);
}
export function matchPhysicsKnowledge(gradeValue: string, points: InitialKnowledgePoint[],
  courses: Course[], note = ''): CourseMatch[] {
  return rankPhysicsKnowledge(gradeValue, points, courses, note).slice(0, 2).map((item) => item.match);
}
export function rankPhysicsKnowledge(gradeValue: string, points: InitialKnowledgePoint[],
  courses: Course[], note = ''): { match: CourseMatch; score: number }[] {
  const grade = gradeNumber(gradeValue);
  const physicsPoints = points.filter((point) => point.subject === '物理');
  if (!grade || !physicsPoints.length) return [];
  const editions = [...new Set(courses.map((course) => course.edition).filter(Boolean))];
  const mentioned = editions.filter((edition) => note.includes(edition));
  const ranked = courses.filter((course) => gradeNumber(course.grade) === grade &&
    (!mentioned.length || mentioned.includes(course.edition))).map((course) => {
    const best = physicsPoints.map((point) => ({ point, score: Math.max(relevance(point.name, course.terms) * 2,
      ...point.keywords.map((keyword) => relevance(keyword, course.terms))) }))
      .sort((a, b) => b.score - a.score)[0];
    return { course, ...best };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  const matches: { match: CourseMatch; score: number }[] = []; const used = new Set<string>();
  for (const { course, point, score } of ranked) {
    const key = course.title;
    if (used.has(key)) continue;
    used.add(key);
    matches.push({ score, match: { subject: '物理', title: course.title, grade: course.grade, edition: course.edition,
      courseType: course.courseType, knowledgePoint: point.name,
      sourceUrl: `https://guanghe.feishu.cn/base/${physicsCatalog.baseToken}?table=${physicsCatalog.tableId}&record=${course.recordId}` } });
  }
  return matches;
}

export class PhysicsCourseCatalog {
  private readonly cache: CourseSnapshotCache<Course[]>;
  constructor(private readonly feishu: Pick<FeishuService, 'request'>, now = Date.now) {
    this.cache = new CourseSnapshotCache(() => this.load(), now);
  }
  read(): Promise<Course[]> { return this.cache.read(); }
  private async load(): Promise<Course[]> {
    const courses: Course[] = []; let token = '';
    const path = `/bitable/v1/apps/${physicsCatalog.baseToken}/tables/${physicsCatalog.tableId}/records`;
    for (let page = 0; page < 20; page++) {
      const data = await this.feishu.request('GET', path, undefined,
        { page_size: '500', ...(token ? { page_token: token } : {}) });
      if (!Array.isArray(data.items)) throw new Error('Invalid physics catalog');
      courses.push(...parsePhysicsCourses(data.items));
      if (!data.has_more) return courses;
      const next = string(data.page_token);
      if (!next || next === token) throw new Error('Invalid physics catalog pagination');
      token = next;
    }
    throw new Error('Physics catalog exceeds 10000 records');
  }
}
