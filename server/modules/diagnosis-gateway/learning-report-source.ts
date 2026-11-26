import { BadRequestException, BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createHash, randomUUID } from 'node:crypto';
import type { LearningReportImport } from '@shared/api.interface';
import { object } from './diagnosis-normalize';

export function reportAuthorization(value: unknown): string {
  if (typeof value !== 'string' || value.length > 6000) throw new BadRequestException('报告链接无效');
  let url: URL;
  try { url = new URL(value.trim().replace(/\\&/gu, '&').replace(/[，,。]+$/u, '')); }
  catch { throw new BadRequestException('请输入完整学情报告链接'); }
  if (url.origin !== 'https://xxgj.yangcongxing.com' || url.pathname !== '/onion-learning/study-report/' ||
    url.username || url.password || url.hash || url.searchParams.getAll('token').length !== 1) {
    throw new BadRequestException('当前仅支持洋葱学情报告链接，其他报告请粘贴正文或截图');
  }
  const token = url.searchParams.get('token') || '';
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)) {
    throw new BadRequestException('报告访问凭证不完整，请重新取得链接或使用截图');
  }
  return token;
}

@Injectable()
export class LearningReportSource {
  private readonly logger = new Logger(LearningReportSource.name);
  constructor(private readonly http: HttpService) {}
  async read(value: unknown): Promise<LearningReportImport> {
    const authorization = reportAuthorization(value);
    try {
      const path = '/study-statistics/parent/userBasic';
      const appid = 'CB3141D6-FE9E-46DF-ABD9-8434AC8DBD59';
      const signedHeaders = { 'client-channel': 'crm_msg', 'client-type': 'h5', 'client-version': '7.80.0',
        omvd: randomUUID(), timestamp: String(Date.now()) };
      // The report site's published client signs this exact path and ordered client metadata.
      const sign = createHash('md5').update(`${appid}:api=${path}&${Object.entries(signedHeaders)
        .map(([key, val]) => `${key}=${val}`).join('&')}`).digest('hex');
      // Fixed upstream: a pasted URL cannot select an arbitrary host, path, or student ID.
      const response = await firstValueFrom(this.http.get(
        'https://7to12.yangcong345.com/backend' + path, {
          headers: { Authorization: authorization, ...signedHeaders, appid, sign, needSign: 'y',
            'client-category': 'student' }, timeout: 15000, maxRedirects: 0, maxContentLength: 256 * 1024,
        }));
      const envelope = object(response.data);
      const data = object(envelope.data || envelope);
      const totals = object(data.userAccumulateData);
      const labels: Record<string, string> = {
        accumulateDurations: '累计主动学习时长（毫秒）', accumulateKnowledgeDone: '累计学完视频课（节）',
        accumulateAnswerProblem: '累计作答题数（道）',
      };
      const lines = Object.entries(labels).flatMap(([key, label]) => {
        const raw = totals[key];
        if ((typeof raw !== 'number' && typeof raw !== 'string') || raw === '' || !Number.isFinite(Number(raw))) return [];
        return [`${label}：${raw}`];
      });
      if (!lines.length) {
        this.logger.warn(JSON.stringify({ event: 'learning_source_schema', root: Object.keys(envelope), data: Object.keys(data) }));
        throw new Error('No verified report fields');
      }
      return { source: '洋葱学情报告·累计统计', text: [
        '来源：洋葱学情报告累计统计；读取日期：' + new Date().toISOString().slice(0, 10), ...lines,
        '统计为累计口径，不代表近期或单一知识点掌握情况。未读取到的正确率、逐题诊断与近期变化须补充报告截图核对。',
      ].join('\n') };
    } catch (error) {
      const status = object(object(error).response).status;
      this.logger.warn(JSON.stringify({ event: 'learning_source_unavailable', status: typeof status === 'number' ? status : 0 }));
      throw new BadGatewayException('报告链接读取失败或已过期，请重新获取链接，或粘贴报告截图/正文');
    }
  }
}
