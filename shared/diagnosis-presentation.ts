import type { CourseMatch, Diagnosis, LearningPlanReport, ProductMaterialMatch, ProductMaterialPreview } from './api.interface';

export function bracketProductNames(text: string, names: string[]): string {
  const escaped = [...new Set(names.map(name => name.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  if (!escaped.length) return text;
  const pattern = new RegExp(`【[^【】]*】|${escaped.join('|')}`, 'gu');
  return text.replace(pattern, name => name.startsWith('【') ? name : `【${name}】`);
}

export function reportProductText(report: LearningPlanReport, text: string): string {
  return bracketProductNames(text, report.solutions.map(solution => solution.name));
}

export function salesTextParts(text: string): { text: string; strong: boolean }[] {
  return text.split(/(\*\*[^*\n]+\*\*)/gu).filter(Boolean).map(part =>
    part.startsWith('**') && part.endsWith('**') ? { text: part.slice(2, -2), strong: true } : { text: part, strong: false });
}
export function plainSalesText(text: string): string {
  return salesTextParts(text).map(part => part.text).join('');
}

export function examDiagnosisReport(d: Diagnosis, studentName: string): LearningPlanReport {
  return { studentName, grade: d.grade, subjects: d.subjects, attribute: '试卷与作业诊断',
    parentMessage: d.parentMessage, summary: d.overall, diagnosisBoard: d.diagnosisBoard, phoneSteps: [],
    evidence: { facts: d.problems.map(p => `${p.item}：${p.rootCause}`), uncertainties: [d.scopeNote].filter(Boolean),
      knowledgePoints: d.problems.map(p => ({ subject: p.subject, name: p.knowledgePoint, keywords: [] })) },
    professionalBasis: [d.rightAnalysis, ...d.strengths].filter(Boolean),
    solutions: d.solutions || [], courses: d.courseMatches || [], warnings: [], createdAt: '',
  };
}
export function solutionCourses(report: LearningPlanReport, index: number): CourseMatch[] {
  const solution = report.solutions[index]; if (!solution) return [];
  const kind = /培优/u.test(solution.name) ? '培优' : /同步/u.test(solution.name) ? '同步' : '';
  const subjects = report.subjects.filter(subject => solution.name.includes(subject));
  // Courses already passed the report's knowledge, grade and edition matching on the server.
  // A product can support multiple diagnosed points; its summary is not a second catalog query.
  return report.courses.filter(c => (!kind || c.courseType.includes(kind)) &&
    (c.subject ? (subjects.length ? subjects : report.subjects).includes(c.subject) : report.subjects.length === 1))
    .slice(0, 2);
}
export function solutionMaterial<T extends ProductMaterialMatch>(materials: T[], report: LearningPlanReport, index: number): T | undefined {
  const solution = report.solutions[index]; if (!solution) return;
  return materials.find(m => m.productIds ? m.productIds.includes(solution.capabilityId) :
    m.capabilityIds.includes(solution.capabilityId) || solution.sellingPoints?.some(p => m.capabilityIds.includes(p.capabilityId)));
}

export function parentCourseNote(course: CourseMatch): string {
  if (!course.reviewNote) return '';
  return /原目录待核实|未确认|疑似|截断|不一致|混入|错写|却为/u.test(course.reviewNote)
    ? '这节课的内容还需和老师确认后再安排。' : '具体年级和教材版本，请与老师确认。';
}

export function parentSolutionCopy(solution: LearningPlanReport['solutions'][number]): string[] {
  const clean = (text: string): string => text.replace(/^(?:推荐理由|使用方法|怎么用|理由|方法)[：:]\s*/u, '').trim();
  const lines = [clean(solution.reason), clean(solution.method)].filter(Boolean);
  const extras = solution.sellingPoints?.map(point => point.name).filter(name => !lines.some(line => line.includes(name))) || [];
  if (extras.length) lines.push(`学习时，也可以结合${extras.join('、')}辅助巩固。`);
  return [...new Set(lines)];
}

export function materialSelectionText(items: ProductMaterialMatch[]): string {
  return items.map(item => item.introduction || item.summary).join('\n\n');
}

export function materialSelectionHtml(items: ProductMaterialPreview[]): string {
  const escape = (value: string): string => value.replace(/[&<>"']/gu, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return items.map(item => `<section><p style="white-space:pre-wrap">${escape(item.introduction || item.summary).replace(/\n/gu, '<br>')}</p>${
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(item.imageDataUrl)
      ? `<img src="${item.imageDataUrl}" alt="课程介绍" style="max-width:100%;height:auto">` : ''}</section>`).join('');
}

export function materialBoardHtml(items: ProductMaterialPreview[]): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>宣传物料</title>
<style>*{box-sizing:border-box}body{margin:0;padding:28px;background:#fff;color:#293c35;font:20px/1.6 system-ui,sans-serif;letter-spacing:0}section{padding:20px 0;border-bottom:1px solid #e1e8e3}h3{font-size:24px;overflow-wrap:anywhere}p{white-space:pre-wrap;overflow-wrap:anywhere}img{display:block;max-width:100%;max-height:1800px;width:auto;height:auto;margin:20px auto}</style>
</head><body>${materialSelectionHtml(items)}</body></html>`;
}
