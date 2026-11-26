import { Injectable, BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { PhotoInput, RecordsResult } from '@shared/api.interface';
import { object, string } from './diagnosis-normalize';

const BASE = 'https://open.feishu.cn/open-apis';
export interface FeishuRecord { recordId: string; fields: Record<string, unknown> }

export function normalizeFields(value: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object(value)).map(([key, field]) => [key,
    Array.isArray(field) && field.length > 0 && field.every((part: unknown) => {
      const item = object(part); return item.type === 'text' && typeof item.text === 'string' && !item.table_id;
    }) ? field.map((part: unknown) => object(part).text).join('') : field,
  ]));
}

@Injectable()
export class FeishuService {
  private token = '';
  private expires = 0;
  private tokenRequest: Promise<string> | null = null;
  constructor(private readonly http: HttpService) {}
  get configured(): boolean {
    return ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'BITABLE_APP_TOKEN', 'BITABLE_DIAGNOSIS_TABLE_ID']
      .every((key) => Boolean(process.env[key]));
  }
  private async accessToken(): Promise<string> {
    if (!this.configured) throw new ServiceUnavailableException('飞书服务尚未配置');
    if (this.token && this.expires > Date.now() + 60000) return this.token;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      try {
        const response = await firstValueFrom(this.http.post(`${BASE}/auth/v3/tenant_access_token/internal`, {
          app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET,
        }, { timeout: 15000, maxContentLength: 1024 * 1024, maxRedirects: 0 }));
        const data = object(response.data);
        if (data.code !== 0 || !string(data.tenant_access_token)) throw new Error('Invalid token response');
        this.token = string(data.tenant_access_token);
        this.expires = Date.now() + Math.min(Number(data.expire) || 7200, 7200) * 1000;
        return this.token;
      } catch { throw new BadGatewayException('飞书鉴权失败，请检查服务端应用配置'); }
      finally { this.tokenRequest = null; }
    })();
    return this.tokenRequest;
  }
  async request(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown,
    params?: Record<string, string>): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    try {
      const response = await firstValueFrom(this.http.request({ method, url: `${BASE}${path}`, data, params,
        headers: { Authorization: `Bearer ${token}` }, timeout: 25000,
        maxContentLength: 4 * 1024 * 1024, maxBodyLength: 14 * 1024 * 1024, maxRedirects: 0 }));
      const body = object(response.data);
      if (body.code !== 0) throw new Error('Feishu rejected request');
      return object(body.data);
    } catch { throw new BadGatewayException('飞书请求失败，请检查应用权限、表格协作权限和字段配置'); }
  }
  tablePath(tableId: string): string {
    if (!/^[A-Za-z0-9]+$/u.test(tableId)) throw new ServiceUnavailableException('飞书数据表尚未配置');
    return `/bitable/v1/apps/${encodeURIComponent(process.env.BITABLE_APP_TOKEN || '')}/tables/${tableId}`;
  }
  async createRecord(tableId: string, fields: Record<string, unknown>, clientToken: string): Promise<FeishuRecord> {
    const data = await this.request('POST', `${this.tablePath(tableId)}/records`, { fields }, { client_token: clientToken });
    const record = object(data.record);
    if (!string(record.record_id)) throw new BadGatewayException('飞书未返回记录编号');
    return { recordId: string(record.record_id), fields: normalizeFields(record.fields) };
  }
  async updateRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
    await this.request('PUT', `${this.tablePath(tableId)}/records/${encodeURIComponent(recordId)}`, { fields });
  }
  async getRecord(tableId: string, recordId: string): Promise<FeishuRecord> {
    const data = await this.request('GET', `${this.tablePath(tableId)}/records/${encodeURIComponent(recordId)}`);
    const record = object(data.record);
    return { recordId: string(record.record_id), fields: normalizeFields(record.fields) };
  }
  async findTask(requestKey: string): Promise<FeishuRecord | null> {
    const data = await this.request('POST', `${this.tablePath(process.env.BITABLE_TASK_TABLE_ID || '')}/records/search`, {
      filter: { conjunction: 'and', conditions: [{ field_name: '请求编号', operator: 'is', value: [requestKey] }] },
    }, { page_size: '1' });
    const record = Array.isArray(data.items) ? object(data.items[0]) : {};
    return string(record.record_id) ? { recordId: string(record.record_id), fields: normalizeFields(record.fields) } : null;
  }
  async listRecords(tableId: string, pageToken = '', pageSize = 20): Promise<{ items: FeishuRecord[]; pageToken: string }> {
    const data = await this.request('GET', `${this.tablePath(tableId)}/records`, undefined,
      { page_size: String(pageSize), ...(pageToken ? { page_token: pageToken } : {}) });
    const items = (Array.isArray(data.items) ? data.items : []).map((raw: unknown) => {
      const record = object(raw); return { recordId: string(record.record_id), fields: normalizeFields(record.fields) };
    });
    return { items, pageToken: data.has_more ? string(data.page_token) : '' };
  }
  async history(pageToken = ''): Promise<RecordsResult> {
    const data = await this.listRecords(process.env.BITABLE_DIAGNOSIS_TABLE_ID || '', pageToken);
    return { configured: true, note: '', pageToken: data.pageToken, items: data.items.map((record) => ({
      recordId: record.recordId, fields: Object.fromEntries(Object.entries(record.fields)
        .filter(([key]) => key !== '原始模型输出').map(([key, value]) => [key,
          key === '照片附件' && Array.isArray(value) ? `[附件 × ${value.length}]` : value])),
    })) };
  }
  async mapping(): Promise<Record<string, unknown>[]> {
    if (!process.env.BITABLE_MAPPING_TABLE_ID) return [];
    const rows: Record<string, unknown>[] = []; let token = '';
    for (let page = 0; page < 10; page++) {
      const data = await this.listRecords(process.env.BITABLE_MAPPING_TABLE_ID, token, 100);
      rows.push(...data.items.map((record) => record.fields));
      token = data.pageToken; if (!token) return rows;
    }
    throw new BadGatewayException('产品映射表超过读取上限');
  }
  async uploadPhoto(photo: PhotoInput): Promise<string> {
    const bytes = Buffer.from(photo.dataBase64, 'base64');
    const form = new FormData();
    form.set('file_name', photo.name); form.set('parent_type', 'bitable_file');
    form.set('parent_node', process.env.BITABLE_APP_TOKEN || ''); form.set('size', String(bytes.length));
    form.set('file', new Blob([new Uint8Array(bytes)], { type: photo.mimeType }), photo.name);
    const data = await this.request('POST', '/drive/v1/medias/upload_all', form);
    const token = string(data.file_token);
    if (!token) throw new BadGatewayException('照片上传失败');
    return token;
  }
  async downloadPhoto(token: string, maxBytes = 10 * 1024 * 1024): Promise<{ body: Buffer; contentType: string }> {
    const accessToken = await this.accessToken();
    try {
      const response = await firstValueFrom(this.http.get(`${BASE}/drive/v1/medias/${encodeURIComponent(token)}/download`, {
        headers: { Authorization: `Bearer ${accessToken}` }, responseType: 'arraybuffer', timeout: 25000,
        maxContentLength: maxBytes, maxRedirects: 0,
      }));
      const bytes = Buffer.from(response.data);
      const contentType = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg' :
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' :
          bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'application/octet-stream';
      return { body: bytes, contentType };
    } catch { throw new BadGatewayException('照片下载失败'); }
  }
}
