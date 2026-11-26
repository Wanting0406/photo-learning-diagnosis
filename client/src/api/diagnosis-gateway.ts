import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { SessionInfo, BackendHealth, RecognitionMode, DiagnosisInput,
  ReportInput, RecordsResult, AdminConfig, AdminPhotos, PhotoInput, DiagnosisJob, DiagnosisClientTiming,
  MaterialMatchesResult, LearningPlanInput, LearningPlanJob, LearningReportImport, LearningSourceKey,
  ProductMaterialResult } from '@shared/api.interface';
import { sealLearningSource } from './learning-source-seal';

function responseError(status: number, data: unknown): Error {
  if (status === 401) return new Error('登录已过期，请重新登录');
  if (status === 403) return new Error('无操作权限，请联系管理员分配角色');
  if (status === 413) return new Error('照片总大小超限，请减少照片或压缩后上传');
  if (data && typeof data === 'object' && 'error' in data) {
    const error = data.error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return new Error(error.message);
    }
  }
  return new Error('请求未完成，请联系管理员核对记录后再提交');
}
async function request<T>(method: 'GET' | 'POST', path: string, data?: unknown, blob = false): Promise<T> {
  try {
    const response = await axiosForBackend.request<T>({ method, url: `/api/diagnosis/${path}`, data,
      timeout: 45000, responseType: blob ? 'blob' : 'json' });
    if (response.status >= 400) throw responseError(response.status, response.data);
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = error.response as { status?: number; data?: unknown } | undefined;
      if (response?.status) throw responseError(response.status, response.data);
    }
    if (error instanceof Error && !('isAxiosError' in error)) throw error;
    throw new Error('连接中断或处理超时，请联系管理员核对记录后再提交');
  }
}
export const fetchSession = (): Promise<SessionInfo> => request('GET', 'session');
export const fetchBackendHealth = (): Promise<BackendHealth> => request('GET', 'backend-health');
export const recognize = (mode: RecognitionMode, input: DiagnosisInput, requestId: string): Promise<DiagnosisJob> =>
  request('POST', `recognize/${mode}`, { input, requestId });
export const analyze = (input: DiagnosisInput, requestId: string, recognitionJobId?: string): Promise<DiagnosisJob> =>
  request('POST', 'analyze', { input, requestId, ...(recognitionJobId ? { recognitionJobId } : {}) });
export const recordTiming = (input: DiagnosisClientTiming): Promise<{ ok: boolean }> => request('POST', 'timings', input);
export const fetchJob = (jobId: string): Promise<DiagnosisJob> => request('GET', `jobs/${encodeURIComponent(jobId)}`);
export const fetchMaterials = (jobId: string): Promise<MaterialMatchesResult> =>
  request('GET', `jobs/${encodeURIComponent(jobId)}/materials`);
export const fetchMaterialImage = (id: string, thumbnail = false): Promise<Blob> =>
  request('GET', `materials/${encodeURIComponent(id)}/image?thumbnail=${thumbnail ? '1' : '0'}`, undefined, true);
export const findJob = (requestId: string): Promise<DiagnosisJob | null> => request('GET', `jobs/by-request/${encodeURIComponent(requestId)}`);
export const report = (input: ReportInput): Promise<Blob> => request('POST', 'report/html', input, true);
export const fetchRecords = (pageToken = ''): Promise<RecordsResult> =>
  request('GET', `admin/records?${new URLSearchParams({ pageToken })}`);
export const fetchConfig = (): Promise<AdminConfig> => request('GET', 'admin/config');
export const fetchPhotos = (pageToken = ''): Promise<AdminPhotos> =>
  request('GET', `admin/photos?${new URLSearchParams({ pageToken })}`);
export const fetchPhoto = (token: string, name: string): Promise<Blob> =>
  request('GET', `admin/photo?${new URLSearchParams({ token, name })}`, undefined, true);
export const testFeishu = (): Promise<{ ok: boolean; msg: string }> => request('POST', 'admin/test-feishu');
// The platform axios observer logs bodies. Keep source credentials and planning evidence off that path.
async function learningRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(axiosForBackend.getUri({ url: `/api/diagnosis/learning/${path}` }), {
      method, credentials: 'same-origin', signal: controller.signal, redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(window.csrfToken ? { 'X-Suda-Csrf-Token': window.csrfToken } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await response.json();
    if (!response.ok) throw responseError(response.status, data);
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') throw error;
    throw new Error('连接超时，请检查任务状态后再提交');
  } finally { clearTimeout(timeout); }
}
export const importLearningReport = async (url: string): Promise<LearningReportImport> => {
  const key = await learningRequest<LearningSourceKey>('GET', 'source-key');
  return learningRequest('POST', 'report-source', await sealLearningSource(url, key));
};
export const startLearningPlan = (input: LearningPlanInput, requestId: string): Promise<LearningPlanJob> =>
  learningRequest('POST', 'plans', { input, requestId });
export const fetchLearningPlan = (id: string): Promise<LearningPlanJob> => learningRequest('GET', `plans/${encodeURIComponent(id)}`);
export const fetchLearningMaterials = (id: string): Promise<MaterialMatchesResult> =>
  learningRequest('GET', `plans/${encodeURIComponent(id)}/materials`);
export const fetchProductMaterials = (id: string, source = 'learning'): Promise<ProductMaterialResult> =>
  source === 'learning' ? learningRequest('GET', `plans/${encodeURIComponent(id)}/product-materials`)
    : request('GET', `jobs/${encodeURIComponent(id)}/product-materials`);
export const fetchProductMaterialImage = (jobId: string, id: string, source = 'learning'): Promise<Blob> =>
  request('GET', `${source === 'learning' ? 'learning/plans' : 'jobs'}/${encodeURIComponent(jobId)}/product-materials/${encodeURIComponent(id)}/image`, undefined, true);
export const findLearningPlan = (id: string): Promise<LearningPlanJob | null> =>
  learningRequest('GET', `plans/by-request/${encodeURIComponent(id)}`);

function readPhotoBytes(file: Blob, name: string): Promise<PhotoInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('照片读取失败'));
    reader.onload = () => resolve({ name,
      mimeType: file.type as PhotoInput['mimeType'], dataBase64: String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  });
}
const photoReads = new WeakMap<File, Promise<PhotoInput>>();
export function readPhoto(file: File): Promise<PhotoInput> {
  const cached = photoReads.get(file); if (cached) return cached;
  const prepared = (async (): Promise<PhotoInput> => {
    if (file.size < 600 * 1024 || typeof createImageBitmap !== 'function') return readPhotoBytes(file, file.name);
    const bitmap = await createImageBitmap(file);
    try {
      const longest = Math.max(bitmap.width, bitmap.height); const shortest = Math.min(bitmap.width, bitmap.height);
      // Long report screenshots keep their text width; ordinary photos fit a 2560px edge.
      const scale = Math.min(1, longest / shortest > 2.5 ? 1800 / shortest : 2560 / longest);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      if (canvas.width * canvas.height > 24000000) return readPhotoBytes(file, file.name);
      const ctx = canvas.getContext('2d'); if (!ctx) return readPhotoBytes(file, file.name);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      return blob && blob.size < file.size * 0.9 ? readPhotoBytes(blob, file.name.replace(/\.[^.]+$/u, '') + '.jpg')
        : readPhotoBytes(file, file.name);
    } finally { bitmap.close(); }
  })();
  photoReads.set(file, prepared);
  void prepared.catch(() => photoReads.delete(file));
  return prepared;
}
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/gu, '_');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
