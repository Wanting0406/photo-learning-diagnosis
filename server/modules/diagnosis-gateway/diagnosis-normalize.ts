import { BadGatewayException } from '@nestjs/common';
import type { Diagnosis, DiagnosisInput, PhotoQuality, RecognitionResult } from '@shared/api.interface';
import { groundNarrative } from './diagnosis-observation';

export const GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '初一', '初二', '初三', '高一', '高二', '高三'];
export const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治', '政治', '科学', '其他'];
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}
export function clean(value: unknown): string {
  return string(value).replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\*\*|__|~~|`|\*/gu, '').replace(/^\s*(?:[-•#]|\d+[.)、])\s*/gmu, '').trim();
}
export function list(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、;；\n]/u) : [];
  return [...new Set(values.map(clean).filter(Boolean))].slice(0, 200);
}
export function parseModel(text: string): Record<string, unknown> {
  let candidate = text.trim();
  if (candidate.startsWith('```')) candidate = candidate.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  try {
    const data: unknown = JSON.parse(candidate);
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Not an object');
    return data as Record<string, unknown>;
  } catch { throw new BadGatewayException('模型未返回完整的诊断数据，请重新识别'); }
}
function common(data: Record<string, unknown>, input: DiagnosisInput) {
  const rawQuality = object(data.photo_quality);
  const photoQuality: PhotoQuality = {
    assessment: ['无法辨认', '较差', '一般', '清晰'].find((level) => string(rawQuality.assessment).includes(level)) || '一般',
    issue: clean(rawQuality.issue), advice: clean(rawQuality.advice),
  };
  const needsRephoto = ['无法辨认', '较差'].includes(photoQuality.assessment);
  const rephotoHint = needsRephoto ? `照片识别质量${photoQuality.assessment}。${photoQuality.issue} ${photoQuality.advice || '请补拍清晰照片。'}` : '';
  const grade = GRADES.find((value) => string(data.grade).includes(value)) || (GRADES.includes(input.grade) ? input.grade : '');
  const subjects = [...new Set(list(data.subjects).map((value) => SUBJECTS.find((s) => value.includes(s) || s.includes(value))).filter((s): s is string => Boolean(s)))];
  if (!subjects.length && SUBJECTS.includes(input.subject)) subjects.push(input.subject);
  const warnings: string[] = rephotoHint ? [rephotoHint] : [];
  if (!grade) warnings.push('未能确定年级，请核对学生信息');
  return { ok: true, grade, subjects, photoQuality, needsRephoto, rephotoHint, warnings, scopeNote: clean(data.scope_note) };
}
export function normalizeRecognition(data: Record<string, unknown>, input: DiagnosisInput, mode: string): RecognitionResult {
  const result: RecognitionResult = { ...common(data, input), wrongItems: list(data.wrong_items).slice(0, 20) };
  result.knowledgePoints = result.needsRephoto ? [] : (Array.isArray(data.knowledge_points) ? data.knowledge_points : [])
    .slice(0, 6).flatMap((raw: unknown) => {
      const point = object(raw); const subject = clean(point.subject); const name = clean(point.name).slice(0, 80);
      if (!name || !SUBJECTS.includes(subject) || !['高', '中'].includes(string(point.confidence))) return [];
      return [{ subject, name, keywords: list(point.keywords).filter((keyword) => keyword.length >= 2 && keyword.length <= 40).slice(0, 3) }];
    });
  if (mode === 'extract-wrong') {
    if (!Array.isArray(data.wrong_items)) throw new BadGatewayException('模型缺少错题清单，请重新识别');
    return result;
  }
  if (!Array.isArray(data.items)) throw new BadGatewayException('模型缺少逐题判定，请重新识别');
  result.items = data.items.slice(0, 200).map((raw: unknown) => {
    const item = object(raw);
    const questionType = ['客观', '主观', '无法判断'].find((t) => string(item.question_type).includes(t)) || '无法判断';
    const confidence = ['高', '中', '低'].find((t) => string(item.confidence).includes(t)) || '中';
    const verdictText = string(item.verdict);
    let verdict = /错|不正确/u.test(verdictText) ? '错' : /^(对|正确|✓)$/u.test(verdictText) ? '对' : '存疑';
    if (verdictText.includes('部分') || questionType !== '客观' || confidence === '低') verdict = '存疑';
    return { item: clean(item.item), questionType, confidence, verdict,
      studentAnswer: clean(item.student_answer), referenceAnswer: clean(item.reference_answer), basis: clean(item.basis) };
  }).filter((item) => item.item);
  result.wrongItems = [...new Set(result.items.filter((item) => item.verdict === '错').map((item) => item.item))];
  if (!result.items.length) result.warnings.push('未识别到可判定的题目，请补拍完整作业页');
  result.photos = (Array.isArray(data.photos) ? data.photos : []).slice(0, 6).map((raw: unknown, index: number) => {
    const item = object(raw); const state = string(item.state);
    return { index: index + 1, state: /ungraded|未批改|无批改/u.test(state) ? 'ungraded' : /graded|已批改|有批改/u.test(state) ? 'graded' : 'unclear', note: clean(item.note) };
  });
  return result;
}
export function normalizeDiagnosis(data: Record<string, unknown>, input: DiagnosisInput): { diagnosis: Diagnosis; warnings: string[]; needsRephoto: boolean; rephotoHint: string } {
  if (!string(data.overall) || !Array.isArray(data.problems) || !Array.isArray(data.plan)) {
    throw new BadGatewayException('模型返回的分析不完整，请重新生成');
  }
  const base = common(data, input);
  const mastery = input.wrongItems.length === 0;
  const board = object(data.diagnosis_board);
  const narrative = (value: unknown): string => groundNarrative(clean(value));
  const narratives = (value: unknown): string[] => list(value).map(groundNarrative);
  const diagnosis: Diagnosis = {
    diagnosisBoard: [board.focus, board.importance, board.courseApproach].every(value => string(value).trim())
      ? { focus: narrative(board.focus), importance: narrative(board.importance), courseApproach: narrative(board.courseApproach) } : undefined,
    grade: base.grade, subjects: base.subjects, overall: narrative(data.overall),
    strengths: narratives(data.strengths), weakPoints: mastery ? [] : narratives(data.weak_points),
    wrongItems: [...input.wrongItems], rightItems: narratives(data.right_items), rightAnalysis: narrative(data.right_analysis),
    scopeNote: base.scopeNote || (mastery ? '未确认错题，本次分析仅限清晰可辨认的作答。' : `本次分析以已确认的 ${input.wrongItems.length} 道错题为范围。`),
    problems: mastery ? [] : data.problems.slice(0, 200).map((raw: unknown) => {
      const p = object(raw);
      return { subject: clean(p.subject), item: clean(p.item), errorType: narrative(p.error_type),
        rootCause: narrative(p.root_cause), knowledgePoint: clean(p.knowledge_point),
        severity: ['高', '中', '低'].includes(string(p.severity)) ? string(p.severity) : '中', suggestion: narrative(p.suggestion) };
    }),
    plan: narratives(data.plan), onionRecommendation: '', parentMessage: narrative(data.parent_message),
    salesTips: Array.isArray(data.sales_tips) ? narratives(data.sales_tips).slice(0, 3).join('\n') : narrative(data.sales_tips),
    membership: '待定', photoQuality: base.photoQuality,
  };
  return { diagnosis, warnings: base.warnings, needsRephoto: base.needsRephoto, rephotoHint: base.rephotoHint };
}
