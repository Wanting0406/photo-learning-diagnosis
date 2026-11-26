import { Injectable, BadRequestException, NotFoundException, ServiceUnavailableException, HttpException, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LearningPlanInput, LearningPlanJob, LearningPlanReport, MaterialMatchesResult, ProductMaterialResult } from '@shared/api.interface';
import { FeishuService, type FeishuRecord } from './feishu.service';
import { VisionService } from './vision.service';
import { CourseCatalogs } from './diagnosis-course-catalogs';
import { MaterialCatalog } from './diagnosis-materials';
import { TaskRecordCache, TaskTimings } from './diagnosis-performance';
import { capabilityBoundary, capabilityCategory } from './diagnosis-product-library';
import { selectPromptProducts, productPromptData, coursePromptData } from './product-prompt-context';
import { ProductCapabilityCatalog, sharedProductCatalog } from './product-capability-catalog';
import { requestKey, type SalesIdentity } from './diagnosis-gateway.service';
import { string, object } from './diagnosis-normalize';
import { learningSubmissionSchema, evidenceSchema, generatedPlanSchema, phoneTitles } from './learning-plan.validation';
import { LEARNING_EVIDENCE_PROMPT, LEARNING_PLAN_PROMPT } from './learning-plan.prompts';
import { verifiedMetrics } from './learning-metrics';
import { ProductMaterialCatalog, sharedProductMaterials } from './product-materials';
import { confirmedGrade } from '@shared/diagnosis-scope';

@Injectable()
export class LearningPlanService {
  private readonly logger = new Logger(LearningPlanService.name);
  private readonly records = new TaskRecordCache();
  private readonly catalog: CourseCatalogs;
  private readonly materials: MaterialCatalog;
  private readonly productMaterials: ProductMaterialCatalog;
  private readonly products: ProductCapabilityCatalog;
  private readonly submissions = new Map<string, { hash: string; promise: Promise<LearningPlanJob> }>();
  private active = 0;
  constructor(private readonly feishu: FeishuService, private readonly vision: VisionService) {
    this.catalog = new CourseCatalogs(feishu);
    this.materials = new MaterialCatalog(feishu);
    this.products = sharedProductCatalog(feishu);
    this.productMaterials = sharedProductMaterials(feishu, this.products);
  }
  private get table(): string { return process.env.BITABLE_TASK_TABLE_ID || ''; }
  async start(body: unknown, identity: SalesIdentity): Promise<LearningPlanJob> {
    const parsed = learningSubmissionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message || '诊断资料不完整');
    if (!this.table || !this.feishu.configured || !this.vision.configured) throw new ServiceUnavailableException('诊断服务未配置');
    const { input, requestId } = parsed.data;
    const key = requestKey('learning:' + identity.userId, requestId);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = this.submissions.get(key);
    if (existing) {
      if (existing.hash !== hash) throw new HttpException('同一请求不能用于不同资料', 409);
      return existing.promise;
    }
    const promise = this.create(key, hash, input, identity);
    this.submissions.set(key, { hash, promise });
    try { return await promise; } finally { this.submissions.delete(key); }
  }
  private async create(key: string, hash: string, input: LearningPlanInput, identity: SalesIdentity): Promise<LearningPlanJob> {
    const timing = new TaskTimings(this.logger, key, 'learning-plan');
    const previous = await timing.measure('taskLookupMs', () => this.feishu.findTask(key));
    if (previous) {
      if (previous.fields['输入摘要'] !== hash) throw new HttpException('同一请求不能用于不同资料', 409);
      return this.decode(previous, identity.userId);
    }
    if (this.active >= 3) throw new HttpException('当前诊断任务较多，请稍后提交', 429);
    this.active++;
    try {
      const record = await timing.measure('taskCreateMs', () => this.feishu.createRecord(this.table, { '请求编号': key, '输入摘要': hash,
        '提交用户': identity.userId, '学生姓名': input.studentName, '模式': 'learning-plan', '状态': 'running',
        '进度': '核对观看记录与学情证据', '开始时间': Date.now() }, key));
      this.records.put(record);
      void this.run(record.recordId, key, input, timing).finally(() => { this.active--; });
      return this.decode(record, identity.userId);
    } catch (error) { this.active--; throw error; }
  }
  private async update(id: string, fields: Record<string, unknown>): Promise<void> {
    await this.feishu.updateRecord(this.table, id, fields);
    this.records.patch(id, fields);
  }
  private async run(id: string, key: string, input: LearningPlanInput, timing: TaskTimings): Promise<void> {
    timing.bindJob(id);
    try {
      const { studentName, subject, attribute, note, watchText, reportText, watchPhotos, reportPhotos } = input;
      let grade = input.grade;
      const catalogRead = timing.measure('catalogMs', () => this.catalog.read([subject]));
      const productRead = timing.measure('mappingReadMs', () => this.products.read());
      void productRead.catch(() => {});
      void this.productMaterials.preload();
      // Observe failures even if evidence extraction fails before the prefetched catalog is used.
      void catalogRead.catch(() => {});
      const evidence = evidenceSchema.parse(await timing.measure('evidenceMs', () => this.vision.learning(LEARNING_EVIDENCE_PROMPT,
        { studentName, grade, subject, note, watchText, reportText,
          imageOrder: `前${watchPhotos.length}张为观看记录，后${reportPhotos.length}张为学情报告` },
        [...watchPhotos, ...reportPhotos], 'evidence')));
      evidence.knowledgePoints = evidence.knowledgePoints.filter((point) => point.subject === subject);
      evidence.metrics = verifiedMetrics(evidence.metrics, input);
      grade = confirmedGrade(grade, evidence.grade);
      this.records.patch(id, { '进度': '匹配知识点课程与产品能力' });
      const snapshot = await timing.measure('catalogWaitMs', () => catalogRead);
      const matched = this.catalog.match(grade, evidence.knowledgePoints, snapshot, note);
      const capabilities = selectPromptProducts(await timing.measure('mappingWaitMs', () => productRead),
        { grade, subjects: [subject], facts: evidence.facts, points: evidence.knowledgePoints,
          courses: matched.matches, note, attribute });
      this.records.patch(id, { '进度': '整理学情诊断与产品建议' });
      const generated = generatedPlanSchema.parse(await timing.measure('reportMs', () => this.vision.learning(LEARNING_PLAN_PROMPT,
        { context: { studentName, grade, subject, attribute, note }, evidence,
          validEvidenceIndexes: evidence.facts.map((_, index) => index), matchedCourses: coursePromptData(matched.matches),
          productLibrary: productPromptData(capabilities) }, [], 'report')));
      const selected = new Set<string>();
      const solutions = generated.solutions.map((solution) => {
        const capability = capabilities.find((item) => item.id === solution.capabilityId);
        if (!capability || capabilityCategory(capability) !== '产品' ||
          solution.evidenceIndexes.some(i => !evidence.facts[i])) {
          throw new Error('Unsupported product recommendation');
        }
        const { supportingCapabilityIds, recommendation, ...detail } = solution;
        const sellingPoints = [...new Set(supportingCapabilityIds)].map(id => {
          const point = capabilities.find(item => item.id === id);
          if (!point || capabilityCategory(point) !== '卖点') throw new Error('Unsupported selling point');
          return { capabilityId: point.id, name: point.name, boundary: capabilityBoundary(point) };
        });
        return { ...detail, name: capability.name, reason: '', method: recommendation,
          acceptance: capability.acceptance, boundary: capabilityBoundary(capability), sellingPoints: sellingPoints.slice(0, 2) };
      }).filter((solution) => {
        if (selected.has(solution.capabilityId)) return false;
        selected.add(solution.capabilityId);
        return true;
      }).slice(0, 2);
      const report: LearningPlanReport = { ...generated, reportVersion: 'product-recommendation-v2',
        diagnosisBoard: { focus: generated.summary, importance: generated.diagnosisBoard.importance, courseApproach: '' },
        metricAnalyses: generated.metricAnalyses?.filter((entry, index, all) =>
          evidence.metrics.some(metric => metric.source === 'report' && metric.confidence === 'clear' && metric.label === entry.label) &&
          all.findIndex(other => other.label === entry.label) === index),
        studentName, grade, subjects: [subject], attribute,
        evidence, phoneSteps: generated.phoneSteps.map((step, i) => ({ ...step, title: phoneTitles[i] })),
        solutions, courses: matched.matches,
        warnings: [...(matched.note ? [matched.note] : []), ...evidence.uncertainties], createdAt: new Date().toISOString() };
      if (/Bearer\s|eyJ[A-Za-z0-9_-]+\.|https?:\/\/[^\s"]*[?&]token=/iu.test(JSON.stringify(report))) {
        throw new Error('Credential-like report content');
      }
      await timing.measure('saveMs', () => this.update(id, { '状态': 'completed', '进度': '诊断完成',
        '结果': JSON.stringify({ format: 'product-recommendation-v2', report, timings: timing.values }) }));
      this.records.patch(id, { '结果': JSON.stringify({ format: 'product-recommendation-v2', report,
        timings: timing.snapshot() }) });
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: 'learning_plan_failed', jobId: id,
        issues: error instanceof z.ZodError ? error.issues.map((issue) => ({ path: issue.path, code: issue.code })) : undefined,
        type: error instanceof Error ? error.name : 'unknown' }));
      try { await this.update(id, { '状态': 'failed', '进度': '生成未完成',
        '错误': error instanceof ServiceUnavailableException ? error.message :
          '未能生成完整且通过校验的诊断，请核对截图清晰度与资料后重试。' }); }
      catch { this.logger.warn(`Learning task status write failed: ${id}`); }
    } finally { timing.finish(); }
  }
  private decode(record: FeishuRecord, userId: string): LearningPlanJob {
    const f = record.fields;
    if (f['提交用户'] !== userId || f['模式'] !== 'learning-plan') throw new NotFoundException('诊断任务不存在');
    const expired = f['状态'] === 'running' && Date.now() - Number(f['开始时间']) > 15 * 60 * 1000;
    const status = expired || f['状态'] === 'failed' ? 'failed' : f['状态'] === 'completed' ? 'completed' : 'running';
    let report: LearningPlanReport | undefined;
    let timings: Record<string, number> | undefined;
    if (status === 'completed') {
      try {
        const stored = object(JSON.parse(string(f['结果'])));
        if (!['learning-plan-v1', 'product-recommendation-v2'].includes(string(stored.format))) throw new Error('Unexpected result');
        report = stored.report as LearningPlanReport;
        timings = stored.timings as Record<string, number> | undefined;
        if (!report?.studentName || !report.phoneSteps?.length) throw new Error('Incomplete report');
      } catch { throw new BadRequestException('诊断记录损坏，请联系管理员'); }
    }
    return { jobId: record.recordId, studentName: string(f['学生姓名']), stage: string(f['进度']), status,
      error: expired ? '任务已中断，请重新生成诊断' : string(f['错误']), report, timings };
  }
  async job(id: string, userId: string): Promise<LearningPlanJob> {
    if (!/^rec[A-Za-z0-9]{5,64}$/u.test(id)) throw new NotFoundException('诊断任务不存在');
    return this.decode(await this.records.get(id, () => this.feishu.getRecord(this.table, id)), userId);
  }
  async find(requestId: string, userId: string): Promise<LearningPlanJob | null> {
    if (!z.uuid().safeParse(requestId).success) throw new BadRequestException('请求编号无效');
    const record = await this.feishu.findTask(requestKey('learning:' + userId, requestId));
    return record ? this.decode(record, userId) : null;
  }
  async materialMatches(id: string, userId: string): Promise<MaterialMatchesResult> {
    const job = await this.job(id, userId);
    if (job.status !== 'completed' || !job.report) throw new BadRequestException('请先完成学情诊断');
    const { grade, evidence, courses, subjects } = job.report;
    return this.materials.match(grade, (evidence?.knowledgePoints || []).filter(point => subjects.includes(point.subject)),
      courses || [], '');
  }
  private async completedReport(id: string, userId: string): Promise<LearningPlanReport> {
    const job = await this.job(id, userId);
    if (job.status !== 'completed' || !job.report) throw new BadRequestException('请先完成产品推荐');
    return job.report;
  }
  async productMatches(id: string, userId: string): Promise<ProductMaterialResult> {
    return this.productMaterials.match(await this.completedReport(id, userId));
  }
  async productImage(id: string, materialId: string, userId: string) {
    return this.productMaterials.image(materialId, await this.completedReport(id, userId));
  }
}
