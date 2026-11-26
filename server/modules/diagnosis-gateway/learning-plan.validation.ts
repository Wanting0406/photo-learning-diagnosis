import { z } from 'zod';
import { photoSchema } from './diagnosis-gateway.validation';
import { groundNarrative } from './diagnosis-observation';

export const learningGrades = ['小学', '初中', '高中', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '初一', '初二', '初三', '高一', '高二', '高三'] as const;
const bounded = z.string().trim().min(1).max(1200).overwrite((text) => text
  .replace(/matchedCourses/gu, '已核对课程目录').replace(/productLibrary/gu, '洋葱产品能力库')
  .replace(/\b(?:evidence|context|capabilityId|allocationNote)\b/gu, '本次资料'));
const note = z.string().max(8000);
export const learningInputSchema = z.object({
  studentName: z.string().trim().min(1).max(100), grade: z.enum(learningGrades),
  subject: z.enum(['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治', '政治']),
  attribute: z.enum(['同步巩固与分层提升', '基础修复', '考前复习', '学有余力培优']),
  note: z.string().max(2000), watchText: note, reportText: note,
  watchPhotos: photoSchema.array().max(6),
  reportPhotos: photoSchema.array().max(6),
}).strict().superRefine((value, ctx) => {
  const photos = [...value.watchPhotos, ...value.reportPhotos];
  if (photos.length > 6 || photos.reduce((n, p) => n + Buffer.byteLength(p.dataBase64, 'base64'), 0) > 12 * 1024 * 1024) {
    ctx.addIssue({ code: 'custom', message: '截图最多6张，合计12MB' });
  }
  if (!value.watchText.trim() && !value.watchPhotos.length) ctx.addIssue({ code: 'custom', message: '请提供观看记录' });
  if (!value.reportText.trim() && !value.reportPhotos.length) ctx.addIssue({ code: 'custom', message: '请提供学情报告正文或截图' });
  if (/https?:\/\/|Bearer\s|eyJ[A-Za-z0-9_-]+\./iu.test(value.reportText + value.watchText + value.note)) {
    ctx.addIssue({ code: 'custom', message: '请先读取报告链接，或粘贴不含链接与令牌的报告正文' });
  }
});
export const learningSubmissionSchema = z.object({ requestId: z.uuid(), input: learningInputSchema }).strict();
const knowledgePointSchema = z.object({ subject: z.string().max(50), name: z.string().max(100),
  keywords: z.string().max(60).array().max(20).overwrite((items) => items.slice(0, 3)) });
export const learningMetricSchema = z.object({
  label: z.string().trim().min(1).max(40), value: z.string().trim().regex(/^\d+(?:[,.]\d+)*$/u).max(24),
  unit: z.string().trim().max(12), period: z.string().trim().min(1).max(80),
  quote: z.string().trim().min(1).max(240), source: z.enum(['report', 'watch']),
  sourceIndex: z.number().int().min(0).max(6), confidence: z.enum(['clear', 'uncertain']),
});
export const evidenceSchema = z.object({
  grade: z.string().max(20).optional(),
  facts: bounded.array().min(1).max(16), uncertainties: bounded.array().max(12),
  knowledgePoints: knowledgePointSchema.array().max(20).overwrite((items) => items.slice(0, 6)),
  metrics: z.unknown().array().max(24).default([]).transform((items) => items.flatMap((item) => {
    const parsed = learningMetricSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  })),
});
export const phoneTitles = ['共鸣开场', '问诊定位', '风险讲透', '解决方案承接', '推进下一步'];
const narrative = bounded.overwrite(groundNarrative);
export const generatedPlanSchema = z.object({
  parentMessage: narrative, summary: narrative,
  metricAnalyses: z.object({ label: z.string().min(1).max(100), analysis: z.string().min(1).max(300).overwrite(groundNarrative) }).array().max(8).optional(),
  diagnosisBoard: z.object({ importance: narrative }),
  phoneSteps: z.object({ text: narrative }).array().length(5),
  solutions: z.object({ knowledgePoint: z.string().min(1).max(100), capabilityId: z.string().max(60),
    supportingCapabilityIds: z.string().max(60).array().max(3).default([]),
    evidenceIndexes: z.number().int().min(0).max(15).array().min(1).max(4),
    recommendation: narrative }).array().max(4),
});
