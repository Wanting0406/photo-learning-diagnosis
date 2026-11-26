import { Injectable, BadRequestException, HttpException, ServiceUnavailableException, NotFoundException, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BackendHealth, Diagnosis, DiagnosisInput, DiagnosisJob, DiagnosisResult, AdminPhotos, AdminConfig,
  DiagnosisSubmission, MaterialMatchesResult, ProductMaterialResult } from '@shared/api.interface';
import { examDiagnosisReport } from '@shared/diagnosis-presentation';
import { ProductMaterialCatalog, sharedProductMaterials } from './product-materials';
import { diagnosisInputSchema, reportInputSchema } from './diagnosis-gateway.validation';
import { normalizeDiagnosis, normalizeRecognition, string, object } from './diagnosis-normalize';
import { groundDiagnosis } from './diagnosis-observation';
import { recommend } from './diagnosis-recommendation';
import { FeishuService, type FeishuRecord } from './feishu.service';
import { VisionService } from './vision.service';
import { renderReport } from './diagnosis-report';
import { CourseCatalogs, courseSubjects } from './diagnosis-course-catalogs';
import { MaterialCatalog } from './diagnosis-materials';
import { ProductCapabilityCatalog, sharedProductCatalog } from './product-capability-catalog';
import { TaskTimings, TaskRecordCache, RecognitionPhotoCache, type RecognitionArtifact,
  type StoredPhoto } from './diagnosis-performance';

const recordIdSchema = z.string().regex(/^rec[A-Za-z0-9]{5,64}$/u);
const submissionSchema = z.union([
  z.object({ requestId: z.uuid(), input: diagnosisInputSchema }).strict(),
  z.object({ requestId: z.uuid(), recognitionJobId: recordIdSchema,
    input: diagnosisInputSchema.extend({ photos: z.array(z.never()).length(0) }) }).strict(),
]);
const clientTimingSchema = z.object({ jobId: recordIdSchema,
  photoReadMs: z.number().finite().min(0).max(3600000), submitMs: z.number().finite().min(0).max(3600000),
  visibleMs: z.number().finite().min(0).max(3600000) }).strict();
const taskLifetime = 15 * 60 * 1000;
export interface SalesIdentity { userId: string; userName: string }
export function requestKey(userId: string, requestId: string): string {
  const hex = createHash('sha256').update(`${userId}:${requestId}`).digest('hex');
  // Bitable client_token validates UUID v4 format even for deterministic idempotency keys.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function recordFields(d: Diagnosis, input: DiagnosisInput, identity: SalesIdentity, raw: string,
  model = '平台 AI 能力（豆包）'): Record<string, unknown> {
  const values: Record<string, unknown> = {
    '学生姓名': input.studentName, '年级': d.grade, '学科': d.subjects, '学情摘要': d.overall,
    '错题题号': d.wrongItems.join('、'), '做对题号': d.rightItems.join('、'), '掌握情况分析': d.rightAnalysis,
    '识别范围说明': d.scopeNote, '薄弱知识点': d.weakPoints.join('、'), '优势表现': d.strengths.join('；'),
    '学习问题清单': d.problems.map((p, i) => `${i + 1}. [${p.subject}] ${p.item}；错误类型:${p.errorType}；原因:${p.rootCause}；建议:${p.suggestion}`).join('\n'),
    '学习建议': d.plan.map((p, i) => `${i + 1}. ${p}`).join('\n'),
    '洋葱课程推荐': [d.onionRecommendation, ...(d.courseMatches || []).map((course) =>
      `目录匹配：${course.title}（${course.grade} / ${course.edition} / ${course.courseType}）；知识点：${course.knowledgePoint}；来源：${course.sourceUrl}${course.reviewNote ? '；' + course.reviewNote : ''}`)].join('\n'),
    '会员档位': d.membership, '家长话术': d.parentMessage, '销售跟进提示': d.salesTips,
    '销售': identity.userName || identity.userId, '学生信息备注': input.note, '跟进状态': '待跟进',
    '识别模型': model, '图片张数': input.photos.length,
    '原始模型输出': raw.slice(0, 20000),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && (!Array.isArray(value) || value.length)));
}

@Injectable()
export class DiagnosisGatewayService {
  private readonly logger = new Logger(DiagnosisGatewayService.name);
  private readonly active = new Set<string>();
  private readonly submissions = new Map<string, { hash: string; promise: Promise<DiagnosisJob> }>();
  private readonly taskRecords = new TaskRecordCache();
  private readonly photoCache = new RecognitionPhotoCache();
  private readonly knowledge: CourseCatalogs;
  private readonly materials: MaterialCatalog;
  private readonly products: ProductCapabilityCatalog;
  private readonly productMaterials: ProductMaterialCatalog;
  private preloadTimer?: ReturnType<typeof setInterval>;
  constructor(private readonly vision: VisionService, private readonly feishu: FeishuService) {
    this.knowledge = new CourseCatalogs(feishu);
    this.materials = new MaterialCatalog(feishu);
    this.products = sharedProductCatalog(feishu);
    this.productMaterials = sharedProductMaterials(feishu, this.products);
  }
  isConfigured(): boolean { return this.vision.configured && this.feishu.configured && Boolean(process.env.BITABLE_TASK_TABLE_ID); }
  onModuleInit(): void {
    if (!this.feishu.configured) return;
    const preload = () => {
      void Promise.allSettled([this.knowledge.read(courseSubjects), this.productMaterials.preload(true)]);
    };
    preload(); this.preloadTimer = setInterval(preload, 45000); this.preloadTimer.unref();
  }
  onModuleDestroy(): void { if (this.preloadTimer) clearInterval(this.preloadTimer); }
  private get taskTable(): string { return process.env.BITABLE_TASK_TABLE_ID || ''; }

  async start(mode: DiagnosisJob['mode'], body: unknown, identity: SalesIdentity): Promise<DiagnosisJob> {
    if (!this.isConfigured()) throw new ServiceUnavailableException('诊断服务尚未配置完成');
    const parsed = submissionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('照片或表单无效，最多 6 张、合计 12 MB');
    const submission: DiagnosisSubmission = parsed.data;
    if (submission.recognitionJobId && mode !== 'analyze') throw new BadRequestException('只有诊断可以引用识别任务');
    const key = requestKey(identity.userId, parsed.data.requestId);
    const hash = createHash('sha256').update(mode).update(JSON.stringify(parsed.data.input))
      .update(submission.recognitionJobId || '').digest('hex');
    const pending = this.submissions.get(key);
    if (pending) {
      if (pending.hash !== hash) throw new HttpException('同一请求编号不能用于不同内容', 409);
      return pending.promise;
    }
    const timings = new TaskTimings(this.logger, key, mode);
    const promise = this.createTask(key, hash, mode, submission, identity, timings);
    this.submissions.set(key, { hash, promise });
    try { return await promise; }
    finally { this.submissions.delete(key); }
  }

  private async createTask(key: string, hash: string, mode: DiagnosisJob['mode'], submission: DiagnosisSubmission,
    identity: SalesIdentity, timings: TaskTimings): Promise<DiagnosisJob> {
    const existing = await timings.measure('taskLookupMs', () => this.feishu.findTask(key));
    if (existing) {
      if (string(existing.fields['输入摘要']) !== hash) throw new HttpException('同一请求编号不能用于不同内容', 409);
      return this.readJob(existing, identity.userId);
    }
    if (this.active.size >= 4) throw new HttpException('当前处理人数较多，请稍后提交', 429);
    this.active.add(key);
    try {
      const record = await timings.measure('taskCreateMs', () => this.feishu.createRecord(this.taskTable, {
        '请求编号': key, '提交用户': identity.userId, '学生姓名': submission.input.studentName,
        '模式': mode, '状态': 'running', '进度': '正在识别', '开始时间': Date.now(), '输入摘要': hash,
      }, key));
      timings.bindJob(record.recordId);
      this.taskRecords.put(record);
      const job: DiagnosisJob = { jobId: record.recordId, mode, status: 'running', stage: '正在识别',
        studentName: submission.input.studentName, error: '' };
      // Persist the task before returning. A restart is surfaced as an interrupted job, never silently retried.
      void this.run(record.recordId, key, mode, submission, identity, timings).finally(() => this.active.delete(key));
      return job;
    } catch (error) { this.active.delete(key); throw error; }
  }

  private async updateTask(id: string, fields: Record<string, unknown>): Promise<void> {
    await this.feishu.updateRecord(this.taskTable, id, fields);
    this.taskRecords.patch(id, fields);
  }
  private taskRecord(id: string): Promise<FeishuRecord> {
    return this.taskRecords.get(id, () => this.feishu.getRecord(this.taskTable, id));
  }
  private decodeResult(record: FeishuRecord): { result?: DiagnosisJob['result']; artifact?: RecognitionArtifact;
    timings?: Record<string, number> } {
    const raw = string(record.fields['结果']);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data?.format === 'diagnosis-v2' ? data : { result: data };
  }
  private async resolveInput(submission: DiagnosisSubmission, userId: string): Promise<{
    input: DiagnosisInput; artifact?: RecognitionArtifact;
  }> {
    if (!submission.recognitionJobId) return { input: submission.input };
    const record = await this.taskRecord(submission.recognitionJobId);
    const job = this.readJob(record, userId);
    const { artifact } = this.decodeResult(record);
    if (job.status !== 'completed' || job.mode === 'analyze' || !artifact?.photos.length) {
      throw new BadRequestException('识别照片暂不可复用，请重新识别照片');
    }
    const { studentName, grade, subject, note } = submission.input;
    if (JSON.stringify({ studentName, grade, subject, note }) !== JSON.stringify(artifact.context)) {
      throw new BadRequestException('学生或识别条件已变化，请重新识别照片');
    }
    let photos = this.photoCache.get(submission.recognitionJobId);
    if (!photos) {
      photos = [];
      for (const photo of artifact.photos) {
        const downloaded = await this.feishu.downloadPhoto(photo.token);
        photos.push({ name: photo.name, mimeType: photo.mimeType, dataBase64: downloaded.body.toString('base64') });
      }
      this.photoCache.set(submission.recognitionJobId, photos);
    }
    return { input: diagnosisInputSchema.parse({ ...submission.input, photos }), artifact };
  }
  private async archivePhotos(input: DiagnosisInput): Promise<StoredPhoto[]> {
    const photos: StoredPhoto[] = [];
    for (let index = 0; index < input.photos.length; index += 2) {
      const batch = await Promise.allSettled(input.photos.slice(index, index + 2).map(async (photo) => ({
        name: photo.name, mimeType: photo.mimeType, token: await this.feishu.uploadPhoto(photo),
      })));
      for (const uploaded of batch) {
        if (uploaded.status === 'rejected') throw uploaded.reason;
        photos.push(uploaded.value);
      }
    }
    return photos;
  }
  private async run(id: string, key: string, mode: DiagnosisJob['mode'], submission: DiagnosisSubmission,
    identity: SalesIdentity, timings: TaskTimings): Promise<void> {
    let archived: Promise<StoredPhoto[] | undefined> | undefined;
    try {
      const resolved = await timings.measure('photoResolveMs', () => this.resolveInput(submission, identity.userId));
      const { input } = resolved;
      if (mode !== 'analyze') void this.products.read().catch(() => {});
      void this.productMaterials.preload();
      const knownSubjects = [input.subject, ...(resolved.artifact?.recognition.subjects || [])]
        .filter((subject) => courseSubjects.includes(subject));
      const catalog = knownSubjects.length && (mode !== 'analyze' || !resolved.artifact?.recognition.courseMatches)
        ? timings.measure('knowledgeReadMs', () => this.knowledge.read(knownSubjects)) : undefined;
      const readCatalog = async (subjects: string[]) => {
        if (!catalog) return timings.measure('knowledgeReadMs', () => this.knowledge.read(subjects));
        const initial = await catalog;
        const missing = subjects.filter((subject) => courseSubjects.includes(subject) && !knownSubjects.includes(subject));
        if (!missing.length) return initial;
        const additional = await timings.measure('knowledgeReadMs', () => this.knowledge.read(missing));
        return { physics: [...initial.physics, ...additional.physics], math: [...initial.math, ...additional.math],
          senior: [...(initial.senior || []), ...(additional.senior || [])],
          junior: [...(initial.junior || []), ...(additional.junior || [])],
          failed: [...initial.failed, ...additional.failed] };
      };
      // Archive in parallel with recognition; never expose attachment tokens in the public job result.
      archived = !resolved.artifact ? timings.measure('photoArchiveMs', () => this.archivePhotos(input))
        .catch(() => { this.logger.warn(`Recognition photo archive unavailable: ${id}`); return undefined; }) : undefined;
      const products = mode === 'analyze' ? await timings.measure('mappingReadMs', () => this.products.read()) : [];
      const generated = await timings.measure('modelMs', () => this.vision.analyze(mode, input, resolved.artifact?.recognition, key, products));
      let result: DiagnosisResult | ReturnType<typeof normalizeRecognition>;
      let artifact: RecognitionArtifact | undefined;
      if (mode !== 'analyze') {
        result = normalizeRecognition(generated.data, input, mode);
        result.courseMatches = [];
        if (!result.knowledgePoints?.length) {
          result.courseMatchNote = '未识别到可确认的图片知识点，暂不匹配课程。';
        } else if (!result.knowledgePoints.some((point) => courseSubjects.includes(point.subject))) {
          result.courseMatchNote = '该学科课程目录尚未接入。';
        } else {
          this.taskRecords.patch(id, { '进度': '知识点已识别，正在匹配课程' });
          try {
            const courses = await readCatalog(result.knowledgePoints.map((point) => point.subject));
            const matched = this.knowledge.match(result.grade, result.knowledgePoints, courses, input.note);
            result.courseMatches = matched.matches;
            result.courseMatchNote = matched.note;
          } catch { result.courseMatchNote = '课程目录暂时读取失败，图片识别结果已保留。'; }
        }
        const photos = await archived;
        if (photos) {
          const { studentName, grade, subject, note } = input;
          artifact = { context: { studentName, grade, subject, note }, photos, recognition: result };
          this.photoCache.set(id, input.photos);
        }
      }
      else {
        artifact = resolved.artifact;
        this.taskRecords.patch(id, { '进度': '正在整理学情诊断' });
        const normalized = normalizeDiagnosis(generated.data, input);
        if (!recommend(normalized.diagnosis, generated.data.selected_capability_ids, products)) {
          normalized.warnings.push('产品能力选择尚未通过校验，家长话术中的产品部分请先人工核实。');
        }
        const initial = resolved.artifact?.recognition;
        if (initial?.courseMatches) {
          normalized.diagnosis.courseMatches = initial.courseMatches;
          if (initial.courseMatchNote) normalized.warnings.push(initial.courseMatchNote);
        } else if (normalized.diagnosis.subjects.some((subject) => courseSubjects.includes(subject)) && input.wrongItems.length > 0) {
          try {
            const points = this.knowledge.diagnosisPoints(normalized.diagnosis);
            const courses = await readCatalog(points.map((point) => point.subject));
            const matched = this.knowledge.match(normalized.diagnosis.grade, points, courses, input.note);
            normalized.diagnosis.courseMatches = matched.matches;
            if (matched.note) normalized.warnings.push(matched.note);
          } catch { normalized.warnings.push('课程目录读取失败，本次未生成目录课程匹配。'); }
        }
        result = { ...normalized, ok: true, stored: false, recordId: '', recordUrl: '' };
        // Independent tables can persist concurrently; wait for both before publishing completed state.
        const backup = timings.measure('taskSaveMs', () => this.updateTask(id, { '进度': '正在保存照片与诊断',
          '结果': JSON.stringify({ format: 'diagnosis-v2', result, timings: timings.values }) }))
          .then(() => true, () => false);
        try {
          const storedPhotos = resolved.artifact?.photos || await archived;
          if (!storedPhotos) throw new Error('Photo archive unavailable');
          const photos = storedPhotos.map((photo) => ({ file_token: photo.token }));
          const record = await timings.measure('diagnosisSaveMs', () => this.feishu.createRecord(process.env.BITABLE_DIAGNOSIS_TABLE_ID || '', {
            ...recordFields(normalized.diagnosis, input, identity, generated.raw, generated.model), '照片附件': photos,
          }, requestKey('diagnosis-record', key)));
          result.stored = true; result.recordId = record.recordId;
          result.recordUrl = `https://feishu.cn/base/${process.env.BITABLE_APP_TOKEN}?table=${process.env.BITABLE_DIAGNOSIS_TABLE_ID}&record=${record.recordId}`;
        } catch { result.warnings.push('诊断结果已保留，但写入诊断记录未确认成功，请管理员核对后再提交。'); }
        if (!await backup) {
          if (!result.stored) throw new Error('Diagnosis persistence unavailable');
          this.logger.warn(`Diagnosis task backup failed; business record saved: ${id}`);
        }
      }
      await timings.measure('finalSaveMs', () => this.updateTask(id, { '状态': 'completed', '进度': '已完成',
        '结果': JSON.stringify({ format: 'diagnosis-v2', result, artifact, timings: timings.values }) }));
    } catch (error: unknown) {
      const reason = error instanceof HttpException ? error.message : '处理失败，请联系管理员核对任务记录';
      this.logger.warn(`Diagnosis task failed: ${id}`);
      try { await this.updateTask(id, { '状态': 'failed', '进度': '处理失败', '错误': reason }); }
      catch { this.logger.warn(`Could not update task status: ${id}`); }
    } finally { await archived; timings.finish(); }
  }

  private readJob(record: FeishuRecord, userId: string): DiagnosisJob {
    const fields = record.fields;
    if (string(fields['提交用户']) !== userId) throw new NotFoundException('任务不存在');
    const mode = string(fields['模式']);
    if (!['extract-wrong', 'grade', 'auto', 'analyze'].includes(mode)) throw new NotFoundException('任务不存在');
    let status = string(fields['状态']); let error = string(fields['错误']);
    if (status === 'running' && Date.now() - Number(fields['开始时间']) > taskLifetime) {
      status = 'failed'; error = '任务已中断，请联系管理员核对诊断记录后再提交';
    }
    let result: DiagnosisJob['result'];
    let artifact: RecognitionArtifact | undefined; let timings: Record<string, number> | undefined;
    try { ({ result, artifact, timings } = this.decodeResult(record)); }
    catch { status = 'failed'; error = '任务结果格式异常，请联系管理员'; }
    if (result && 'diagnosis' in result) result = { ...result, diagnosis: groundDiagnosis(result.diagnosis) };
    return { jobId: record.recordId, mode: mode as DiagnosisJob['mode'],
      status: status === 'completed' ? 'completed' : status === 'running' ? 'running' : 'failed',
      stage: string(fields['进度']), studentName: string(fields['学生姓名']), error, result,
      reusable: status === 'completed' && mode !== 'analyze' && Boolean(artifact?.photos.length), timings };
  }
  async job(id: string, userId: string): Promise<DiagnosisJob> {
    if (!/^rec[A-Za-z0-9]{5,64}$/u.test(id)) throw new NotFoundException('任务不存在');
    return this.readJob(await this.taskRecord(id), userId);
  }
  async clientTiming(body: unknown, userId: string): Promise<{ ok: boolean }> {
    const parsed = clientTimingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('计时参数无效');
    await this.job(parsed.data.jobId, userId);
    this.logger.log(JSON.stringify({ event: 'diagnosis_client_timing', ...parsed.data }));
    return { ok: true };
  }
  private async productReport(id: string, userId: string) {
    const job = await this.job(id, userId);
    if (job.status !== 'completed' || !job.result || !('diagnosis' in job.result)) {
      throw new BadRequestException('请先完成学情诊断');
    }
    return examDiagnosisReport(job.result.diagnosis, job.studentName);
  }
  async productMatches(id: string, userId: string): Promise<ProductMaterialResult> {
    return this.productMaterials.match(await this.productReport(id, userId));
  }
  async productImage(id: string, materialId: string, userId: string) {
    return this.productMaterials.image(materialId, await this.productReport(id, userId));
  }
  async findJob(requestId: string, userId: string): Promise<DiagnosisJob | null> {
    if (!z.uuid().safeParse(requestId).success) throw new BadRequestException('请求编号无效');
    const record = await this.feishu.findTask(requestKey(userId, requestId));
    return record ? this.readJob(record, userId) : null;
  }
  report(body: unknown, salesName: string): string {
    const parsed = reportInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('报告数据无效');
    return renderReport(parsed.data.diagnosis, parsed.data.studentName, salesName);
  }
  async checkBackendHealth(): Promise<BackendHealth> {
    if (!this.isConfigured()) return { configured: false, reachable: false, message: '服务待配置' };
    try {
      await this.feishu.listRecords(this.taskTable, '', 1);
      return { configured: true, reachable: true, message: '服务已就绪' };
    } catch { return { configured: true, reachable: false, message: '飞书连接异常' }; }
  }
  records(pageToken: string) { return this.feishu.history(pageToken); }
  async materialMatches(id: string, userId: string): Promise<MaterialMatchesResult> {
    if (!recordIdSchema.safeParse(id).success) throw new BadRequestException('识别任务编号无效');
    const record = await this.taskRecord(id);
    const job = this.readJob(record, userId);
    if (job.status !== 'completed' || !job.result) {
      throw new BadRequestException('请先完成图片知识点识别');
    }
    const { artifact } = this.decodeResult(record);
    if ('diagnosis' in job.result) {
      const diagnosis = job.result.diagnosis;
      const points = [...(artifact?.recognition.knowledgePoints || []), ...this.knowledge.diagnosisPoints(diagnosis)];
      return this.materials.match(diagnosis.grade, points,
        diagnosis.courseMatches || [], artifact?.context.note || '');
    }
    return this.materials.match(job.result.grade, job.result.knowledgePoints || [],
      job.result.courseMatches || [], artifact?.context.note || '');
  }
  materialImage(id: string, thumbnail: boolean) { return this.materials.image(id, thumbnail); }
  config(): AdminConfig {
    return { fields: ['BITABLE_JUNIOR_KNOWLEDGE_TABLE_ID', 'BITABLE_ALL_COURSE_TABLES',
      'BITABLE_DIAGNOSIS_TABLE_ID', 'BITABLE_MAPPING_TABLE_ID',
      'BITABLE_TASK_TABLE_ID', 'BITABLE_MATERIAL_TABLE_ID', 'BITABLE_MATERIAL_MAPPING_TABLE_ID',
      'FEISHU_APP_SECRET'].map((key) => ({ key, label: key,
        value: /SECRET|API_KEY/u.test(key) ? (process.env[key] ? '已配置' : '未配置') : process.env[key] || '未配置' })) };
  }
  async photos(pageToken = ''): Promise<AdminPhotos> {
    const records = await this.feishu.listRecords(process.env.BITABLE_DIAGNOSIS_TABLE_ID || '', pageToken, 20);
    return { pageToken: records.pageToken, items: records.items.map((record) => ({ recordId: record.recordId,
      studentName: string(record.fields['学生姓名']), grade: string(record.fields['年级']), summary: string(record.fields['学情摘要']),
      photos: (Array.isArray(record.fields['照片附件']) ? record.fields['照片附件'] : []).map((raw: unknown) => {
        const photo = object(raw); return { token: string(photo.file_token), name: string(photo.name) };
      }),
    })) };
  }
  photo(token: string) { return this.feishu.downloadPhoto(token); }
  async testFeishu(): Promise<{ ok: boolean; msg: string }> {
    await this.feishu.listRecords(process.env.BITABLE_DIAGNOSIS_TABLE_ID || '', '', 1);
    return { ok: true, msg: '飞书连接正常' };
  }
}
