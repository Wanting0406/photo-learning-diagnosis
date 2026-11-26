import type { CourseMatch, Diagnosis, InitialKnowledgePoint } from '@shared/api.interface';
import { PhysicsCourseCatalog, rankPhysicsKnowledge, type Course } from './diagnosis-knowledge';
import type { FeishuService } from './feishu.service';
import { normalizeFields } from './feishu.service';
import { object, string } from './diagnosis-normalize';
import { CourseSnapshotCache } from './course-snapshot-cache';
import { stageGrades } from '@shared/diagnosis-scope';
import { AllCourseCatalog, allCourseSubjects } from './all-course-catalog';

interface MathCourse extends Course {
  sourceUrl: string; subject?: string; reviewNote?: string; exactOnly?: boolean;
  eligibleGrades?: number[]; book?: string; region?: string; package?: string;
}
interface CatalogSnapshot {
  physics: Course[]; math: MathCourse[]; senior?: MathCourse[]; junior?: MathCourse[]; all?: MathCourse[]; failed: string[];
}
interface RankedCourse { match: CourseMatch; score: number }
function selectCourses(ranked: RankedCourse[]): CourseMatch[] {
  const seen = new Set<string>();
  const unique = ranked.slice().sort((a, b) => b.score - a.score).map(item => item.match).filter(course => {
    const key = `${course.subject || '物理'}:${course.grade}:${course.edition}:${course.title}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const points = new Set<string>();
  const primary = unique.filter(course => {
    const key = `${course.subject || '物理'}:${course.knowledgePoint}`;
    if (points.has(key)) return false;
    points.add(key); return true;
  });
  return [...primary, ...unique.filter(course => !primary.includes(course))].slice(0, 2);
}
export const courseSubjects = allCourseSubjects;
const seniorSubjects = ['物理', '化学', '生物', '英语'];
const juniorSubjects = ['物理', '化学', '生物', '英语', '语文', '地理'];
const mathName = (value: string): string => value.normalize('NFKC').replace(/^第\d+讲\s*/u, '')
  .replace(/[\s，。；：、（）()]/gu, '').toLowerCase();
const genericMath = new Set(['数学', '知识点', '计算', '方法', '概念', '应用', '分析', '理解', '解题',
  '函数', '方程', '几何', '代数', '综合', '图形', '统计', '概率', '公式', '模型',
  '物理', '化学', '生物', '英语', '实验', '运动', '能量', '物质', '反应', '细胞', '遗传', '平衡',
  '阅读', '写作', '语法', '训练', '篇章', '真题', '选择题', '大题', '一轮', '二轮', '高中', '高考',
  '语文', '地理', '历史', '政治', '道德与法治', '词汇', '语法', '同步', '初中', '中考', '培优', '重难点', '总复习']);
const mathGrade = (value: string): number => {
  const grades = [
    /^(?:小学)?(?:一年级|一|1年级)(?:[上下](?:学期|册)?)?$/u,
    /^(?:小学)?(?:二年级|二|2年级)(?:[上下](?:学期|册)?)?$/u,
    /^(?:小学)?(?:三年级|三|3年级)(?:[上下](?:学期|册)?)?$/u,
    /^(?:小学)?(?:四年级|四|4年级)(?:[上下](?:学期|册)?)?$/u,
    /^(?:小学)?(?:五年级|五|5年级)(?:[上下](?:学期|册)?)?$/u,
    /^(?:小学)?(?:六年级|六|6年级)(?:[上下](?:学期|册)?)?$/u,
    /^(初一|七年级|七|7年级)(?:[上下](?:学期)?)?$/u,
    /^(初二|八年级|八|8年级)(?:[上下](?:学期)?)?$/u,
    /^(初三|九年级|九|9年级|中考)(?:[上下](?:学期)?)?$/u,
    /^(高一|高中一年级|十年级|10年级)(?:[上下](?:学期|册)?)?$/u,
    /^(高二|高中二年级|十一年级|11年级)(?:[上下](?:学期|册)?)?$/u,
    /^(高三|高中三年级|十二年级|12年级|高考)(?:[上下](?:学期|册)?)?$/u,
  ];
  const index = grades.findIndex((pattern) => pattern.test(value.trim()));
  return index < 0 ? 0 : index + 1;
};
const courseGrades = (value: string): number[] => {
  const grades = value.split('、').map(mathGrade);
  return grades.length && grades.every((grade) => grade > 0) ? [...new Set(grades)] : [];
};

export function parseMathCourses(items: unknown[], base: string, table: string): MathCourse[] {
  if (!/^[A-Za-z0-9]+$/u.test(base) || !/^tbl[A-Za-z0-9]+$/u.test(table)) throw new Error('Invalid math source');
  return items.flatMap((item) => {
    const record = object(item); const fields = normalizeFields(record.fields);
    const recordId = string(record.record_id); const title = string(fields['课程名称']);
    if (!/^rec[A-Za-z0-9]+$/u.test(recordId) || !title || title.length > 200 || fields['学科'] !== '数学' ||
      fields['审核状态'] !== '已核对' || !mathGrade(string(fields['适用年级']))) return [];
    return [{ recordId, title, grade: string(fields['适用年级']), edition: string(fields['教材版本']),
      courseType: string(fields['课程类型']),
      // Search course-level terms only; a broad module would make unrelated videos tie for first place.
      terms: [...new Set([title, ...string(fields['知识点名称']).split('\n'), ...string(fields['检索关键词']).split('\n')]
        .map(mathName).filter(Boolean))],
      sourceUrl: `https://guanghe.feishu.cn/base/${base}?table=${table}&record=${recordId}` }];
  });
}
export function parseSeniorCourses(items: unknown[], base: string, table: string,
  subjects = seniorSubjects, minimumGrade = 10, maximumGrade = 12): MathCourse[] {
  if (!/^[A-Za-z0-9]+$/u.test(base) || !/^tbl[A-Za-z0-9]+$/u.test(table)) throw new Error('Invalid senior source');
  return items.flatMap((item) => {
    const record = object(item); const fields = normalizeFields(record.fields);
    const recordId = string(record.record_id); const title = string(fields['课程名称']);
    const subject = string(fields['学科']); const status = string(fields['审核状态']);
    const rawGrade = string(fields['适用年级']); const points = string(fields['知识点名称']);
    if (!/^rec[A-Za-z0-9]+$/u.test(recordId) || !title || title.length > 200 || !subjects.includes(subject) ||
      !['已核对', '待核实'].includes(status)) return [];
    const grade = rawGrade;
    const grades = courseGrades(grade);
    if (!grades.length || grades.some((value) => value < minimumGrade || value > maximumGrade)) return [];
    const detail = string(fields['核对说明']).split('\n').filter((line) =>
      /疑似|截断|不一致|却为|混入|错写/u.test(line)).join(' ');
    const exactOnly = !points || !!detail || status === '待核实';
    const reviewNote = [status === '待核实' ? '原目录待核实，仅作课程目录参考。' : '',
      !points ? '仅按目录名称匹配，未确认对应知识点。' : '',
      subject === '数学' && status === '待核实' ? string(fields['专题']) : '', detail].filter(Boolean).join(' ');
    return [{ recordId, title, grade, subject, reviewNote, exactOnly,
      edition: string(fields['教材版本']), courseType: string(fields['课程类型']),
      terms: [...new Set([title, ...(exactOnly ? [] : points.split('\n'))].map(mathName).filter(Boolean))],
      sourceUrl: `https://guanghe.feishu.cn/base/${base}?table=${table}&record=${recordId}` }];
  });
}
export function parseJuniorCourses(items: unknown[], base: string, table: string): MathCourse[] {
  return parseSeniorCourses(items.filter((item) => normalizeFields(object(item).fields)['审核状态'] === '已核对'),
    base, table, juniorSubjects, 7, 9);
}
export function parseMathDirectory(items: unknown[], base: string, table: string): MathCourse[] {
  const pending = items.filter((item) => normalizeFields(object(item).fields)['审核状态'] === '待核实');
  return [...parseMathCourses(items, base, table), ...parseSeniorCourses(pending, base, table, ['数学'], 1)];
}
function mathRelevance(value: string, terms: string[], subject: string): number {
  const normalize = (text: string): string => subject === '数学' ? mathName(text).replace(/的/gu, '') : mathName(text);
  const query = normalize(value);
  if (query.length < 2 || genericMath.has(query)) return 0;
  let score = 0;
  for (const raw of terms) {
    const term = normalize(raw);
    if (query === term) return 100;
    // A general triangle topic is not evidence for a special/right-triangle lesson.
    if (subject === '数学' ? term.replace(/^根据/u, '').startsWith(query) : term.includes(query)) score = Math.max(score, 80);
    else if (term.length >= 3 && query.includes(term)) score = Math.max(score, 70);
  }
  return score;
}
export function rankMathKnowledge(grade: string, points: InitialKnowledgePoint[], courses: MathCourse[],
  note = '', subject = '数学'): RankedCourse[] {
  if (!mathGrade(grade)) return [];
  const relevant = points.filter((point) => point.subject === subject);
  if (!relevant.length) return [];
  const round = /一轮/u.test(note) !== /二轮/u.test(note) ? (/一轮/u.test(note) ? '一轮' : '二轮') : '';
  const editions = note ? [...new Set(courses.filter((course) => !course.subject || course.subject === subject)
    .map((course) => course.edition).filter(Boolean))] : [];
  const editionKey = (value: string): string => mathName(value)
    .replace(/(?:小学|初中|高中)(?:思想政治|数学|语文|英语|物理|化学|生物|历史|地理|政治)?$/u, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/学制/gu, '制').replace(/版/gu, '');
  // Consume specific versions first, so 人教版（2024） does not also select 人教版.
  let remainingNote = editionKey(note);
  const mentioned = [...new Set(editions.map(editionKey))].sort((a, b) => b.length - a.length)
    .filter((key) => {
      if (!key || !remainingNote.includes(key)) return false;
      remainingNote = remainingNote.split(key).join('|');
      return true;
    });
  const regions = [...new Set(courses.map(course => course.region).filter((value): value is string =>
    Boolean(value) && value !== '本地化'))];
  const regionKey = (value: string): string => value.replace(/省$|市$/gu, '');
  const requestedRegions = regions.filter(region => note.includes(regionKey(region)));
  const candidates = courses.filter((course) => (!course.subject || course.subject === subject) &&
    (course.eligibleGrades || courseGrades(course.grade)).includes(mathGrade(grade)) &&
    (!course.region || (requestedRegions.length ? requestedRegions.includes(course.region) : course.region === '本地化')) &&
    (!/五四/u.test(editionKey(course.edition)) || mentioned.includes(editionKey(course.edition))) &&
    (!mentioned.length || mentioned.includes(editionKey(course.edition))) &&
    (!round || course.courseType.includes(round)));
  return candidates.flatMap((course) => {
    const best = relevant.map((point) => ({ point, score: course.exactOnly
      ? (course.terms.includes(mathName(point.name)) && !genericMath.has(mathName(point.name)) ? 200 : 0) : Math.max(
      ...[point.name, ...point.name.split(/[：:；;，,（）()]/u)].map((name) => mathRelevance(name, course.terms, subject) * 2),
      // Auxiliary words need a recorded exact term; broad fragments can suggest unrelated lessons.
      ...point.keywords.map((keyword) => {
        const key = mathName(keyword);
        return key.length >= 2 && !genericMath.has(key) && course.terms.includes(key) ? 100 : 0;
      })) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!best?.score) return [];
    return [{ score: best.score - (course.exactOnly ? 30 : 0), match: { title: course.title, grade: course.grade, edition: course.edition,
      ...(course.book ? { book: course.book } : {}), ...(course.region ? { region: course.region } : {}),
      ...(course.package ? { package: course.package } : {}),
      subject, ...(course.reviewNote ? { reviewNote: course.reviewNote } : {}),
      courseType: course.courseType, knowledgePoint: best.point.name, sourceUrl: course.sourceUrl } }];
  }).sort((a, b) => b.score - a.score || a.match.title.localeCompare(b.match.title, 'zh-CN', { numeric: true }));
}
export class MathCourseCatalog {
  private readonly cache: CourseSnapshotCache<MathCourse[]>;
  constructor(private readonly feishu: Pick<FeishuService, 'request'>, now = Date.now,
    private readonly tableEnv = 'BITABLE_MATH_TABLE_ID', private readonly parse = parseMathCourses) {
    this.cache = new CourseSnapshotCache(() => this.load(), now);
  }
  read(): Promise<MathCourse[]> { return this.cache.read(); }
  private async load(): Promise<MathCourse[]> {
    const base = process.env.BITABLE_APP_TOKEN || ''; const table = process.env[this.tableEnv] || '';
    if (!/^[A-Za-z0-9]+$/u.test(base) || !/^tbl[A-Za-z0-9]+$/u.test(table)) throw new Error('Math catalog unconfigured');
    const courses: MathCourse[] = []; let token = '';
    for (let page = 0; page < 20; page++) {
      const data = await this.feishu.request('GET', `/bitable/v1/apps/${base}/tables/${table}/records`, undefined,
        { page_size: '500', ...(token ? { page_token: token } : {}) });
      if (!data.items && data.total === 0 && !data.has_more) return courses;
      if (!Array.isArray(data.items)) throw new Error('Invalid course catalog');
      courses.push(...this.parse(data.items, base, table));
      if (!data.has_more) return courses;
      const next = string(data.page_token);
      if (!next || next === token) throw new Error('Invalid math pagination');
      token = next;
    }
    throw new Error('Math catalog exceeds 10000 records');
  }
}
interface SharedCatalogs {
  scope: string; physics: PhysicsCourseCatalog; math: MathCourseCatalog;
  mathKnowledge: MathCourseCatalog; senior: MathCourseCatalog; junior: MathCourseCatalog; all: AllCourseCatalog;
}
const sharedCatalogs = new WeakMap<Pick<FeishuService, 'request'>, SharedCatalogs>();

export class CourseCatalogs {
  private readonly physics: PhysicsCourseCatalog;
  private readonly math: MathCourseCatalog;
  private readonly mathKnowledge: MathCourseCatalog;
  private readonly senior: MathCourseCatalog;
  private readonly junior: MathCourseCatalog;
  private readonly all: AllCourseCatalog;
  constructor(feishu: Pick<FeishuService, 'request'>) {
    const scope = JSON.stringify(['BITABLE_APP_TOKEN', 'BITABLE_MATH_TABLE_ID', 'BITABLE_MATH_KNOWLEDGE_TABLE_ID',
      'BITABLE_SENIOR_KNOWLEDGE_TABLE_ID', 'BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID', 'BITABLE_ALL_COURSE_TABLES']
      .map(key => process.env[key] || ''));
    const shared = sharedCatalogs.get(feishu);
    if (shared?.scope === scope) {
      this.physics = shared.physics; this.math = shared.math; this.mathKnowledge = shared.mathKnowledge;
      this.senior = shared.senior; this.junior = shared.junior; this.all = shared.all;
      return;
    }
    this.physics = new PhysicsCourseCatalog(feishu); this.math = new MathCourseCatalog(feishu);
    this.mathKnowledge = new MathCourseCatalog(feishu, Date.now, 'BITABLE_MATH_KNOWLEDGE_TABLE_ID', parseMathDirectory);
    this.senior = new MathCourseCatalog(feishu, Date.now, 'BITABLE_SENIOR_KNOWLEDGE_TABLE_ID', parseSeniorCourses);
    this.junior = new MathCourseCatalog(feishu, Date.now, 'BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID', parseJuniorCourses);
    this.all = new AllCourseCatalog(feishu);
    sharedCatalogs.set(feishu, { scope, physics: this.physics, math: this.math,
      mathKnowledge: this.mathKnowledge, senior: this.senior, junior: this.junior, all: this.all });
  }
  async read(subjects: string[]): Promise<CatalogSnapshot> {
    const result: CatalogSnapshot = { physics: [], math: [], senior: [], junior: [], all: [], failed: [] };
    const requestedAll = courseSubjects.filter(subject => subjects.includes(subject));
    const allRead = requestedAll.length && this.all.configured ? this.all.read().then(data => {
      result.all = data.courses.filter(course => requestedAll.includes(course.subject));
      if (data.failed) result.failed.push(...requestedAll);
    }) : Promise.resolve();
    const requestedSenior = seniorSubjects.filter((subject) => subjects.includes(subject));
    const seniorRead = requestedSenior.length && process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID
      ? this.senior.read().then((courses) => {
        result.senior = courses.filter((course) => requestedSenior.includes(course.subject || ''));
      }).catch(() => { result.failed.push(...requestedSenior); }) : Promise.resolve();
    const requestedJunior = juniorSubjects.filter((subject) => subjects.includes(subject));
    const juniorRead = requestedJunior.length && process.env.BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID
      ? this.junior.read().then((courses) => {
        result.junior = courses.filter((course) => requestedJunior.includes(course.subject || ''));
      }).catch(() => { result.failed.push(...requestedJunior); }) : Promise.resolve();
    await Promise.all(courseSubjects.filter((subject) => subjects.includes(subject)).map(async (subject) => {
      try {
        if (subject === '数学') {
          const sources = [this.math, ...(process.env.BITABLE_MATH_KNOWLEDGE_TABLE_ID ? [this.mathKnowledge] : [])];
          const reads = await Promise.allSettled(sources.map((source) => source.read()));
          for (const read of reads) {
            if (read.status === 'fulfilled') result.math.push(...read.value);
          }
          if (reads.some((read) => read.status === 'rejected')) result.failed.push(subject);
        } else if (subject === '物理') result.physics = await this.physics.read();
        else if (!(seniorSubjects.includes(subject) && process.env.BITABLE_SENIOR_KNOWLEDGE_TABLE_ID) &&
          !process.env.BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID && !this.all.configured) result.failed.push(subject);
      } catch { result.failed.push(subject); }
    }));
    await Promise.all([seniorRead, juniorRead, allRead]);
    result.failed = [...new Set(result.failed)];
    return result;
  }
  match(grade: string, points: InitialKnowledgePoint[], snapshot: CatalogSnapshot, note = ''):
  { matches: CourseMatch[]; note: string } {
    const common = [...(snapshot.senior || []), ...(snapshot.junior || []), ...(snapshot.all || [])];
    const rank = (g: string): RankedCourse[] => [...rankPhysicsKnowledge(g, points, snapshot.physics, note),
      ...courseSubjects.flatMap(subject => rankMathKnowledge(g, points,
        subject === '数学' ? [...snapshot.math, ...common] : common, note, subject))];
    if (stageGrades[grade]) {
      const matches = selectCourses(stageGrades[grade].flatMap(rank)).map(course => ({ ...course,
          reviewNote: [course.reviewNote, `目录适用${course.grade}，学生具体年级与教材版本待核实。`].filter(Boolean).join(' ') }));
      return { matches, note: [(matches.length ? '按学段匹配，具体课程年级使用前核实。' : '当前学段未找到可靠的知识点课程匹配。'),
        ...snapshot.failed.map(subject => `${subject}课程目录读取失败或部分不可用。`)].join(' ') };
    }
    const matches = selectCourses(rank(grade));
    const messages = snapshot.failed.map((subject) => `${subject}课程目录读取失败或部分不可用，图片识别结果已保留。`);
    for (const match of matches) if (match.reviewNote) messages.push(`${match.title}：${match.reviewNote}`);
    for (const subject of courseSubjects.filter((value) => value !== '数学' && points.some((point) => point.subject === value))) {
      if ((subject !== '物理' || mathGrade(grade) >= 10) && !snapshot.failed.includes(subject) &&
        ![...(snapshot.senior || []), ...(snapshot.junior || []), ...(snapshot.all || [])].some((course) =>
          course.subject === subject && (course.eligibleGrades || courseGrades(course.grade)).includes(mathGrade(grade)))) {
        messages.push(`当前年级暂无可匹配的${subject}课程目录。`);
      }
    }
    if (points.some((point) => point.subject === '数学')) {
      if (!mathGrade(grade)) messages.push('请明确学生年级后匹配数学课程。');
      else if (!snapshot.failed.includes('数学') && ![...snapshot.math, ...(snapshot.all || []).filter(c => c.subject === '数学')]
        .some((course) => (course.eligibleGrades || courseGrades(course.grade)).includes(mathGrade(grade)))) {
        messages.push('当前年级暂无已核对的数学课程目录。');
      }
    }
    if (points.some((point) => !courseSubjects.includes(point.subject))) messages.push('部分学科课程目录尚未接入。');
    if (!matches.length && !messages.length) messages.push('当前目录未找到可靠匹配，请核对年级和教材版本。');
    return { matches, note: messages.join(' ') };
  }
  diagnosisPoints(diagnosis: Diagnosis): InitialKnowledgePoint[] {
    const points = diagnosis.problems.map((problem) => ({ subject: problem.subject, name: problem.knowledgePoint, keywords: [] }));
    if (diagnosis.subjects.length === 1) points.push(...diagnosis.weakPoints.map((name) =>
      ({ subject: diagnosis.subjects[0], name, keywords: [] })));
    return points;
  }
}
