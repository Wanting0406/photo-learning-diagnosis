import { z } from 'zod';

const text = z.string().max(20000);
const lines = z.array(text).max(200);
const photoQuality = z.object({ assessment: text, issue: text, advice: text });
export const photoSchema = z.object({
  name: z.string().min(1).max(200).refine((value) => !/[\r\n/\\]/u.test(value)),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().min(4).max(14 * 1024 * 1024),
}).strict().refine((value) => {
  const bytes = Buffer.from(value.dataBase64, 'base64');
  if (bytes.length > 10 * 1024 * 1024 || bytes.toString('base64') !== value.dataBase64) return false;
  if (value.mimeType === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (value.mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
});

export const diagnosisInputSchema = z.object({
  studentName: z.string().trim().min(1).max(100),
  grade: z.string().max(50), subject: z.string().max(50), note: z.string().max(2000),
  photos: z.array(photoSchema).min(1).max(6).refine((photos) =>
    photos.reduce((size, value) => size + Buffer.byteLength(value.dataBase64, 'base64'), 0) <= 12 * 1024 * 1024),
  wrongItems: lines,
}).strict();
export const reportInputSchema = z.object({
  studentName: z.string().max(100),
  diagnosis: z.object({
    diagnosisBoard: z.object({ focus: text, importance: text, courseApproach: text }).optional(),
    grade: text, subjects: lines, overall: text, strengths: lines, weakPoints: lines,
    wrongItems: lines, rightItems: lines, rightAnalysis: text, scopeNote: text,
    problems: z.array(z.object({ subject: text, item: text, errorType: text, rootCause: text,
      knowledgePoint: text, severity: text, suggestion: text })).max(200),
    plan: lines, onionRecommendation: text, parentMessage: text, salesTips: text,
    courseMatches: z.array(z.object({ title: text, grade: text, edition: text, courseType: text,
      subject: text.optional(), reviewNote: text.optional(),
      knowledgePoint: text, sourceUrl: z.string().max(1000)
        .regex(/^https:\/\/guanghe\.feishu\.cn\/base\/[A-Za-z0-9]+\?table=tbl[A-Za-z0-9]+&record=rec[A-Za-z0-9]+$/u),
    })).max(6).optional(),
    membership: text, photoQuality,
  }),
}).strict();
