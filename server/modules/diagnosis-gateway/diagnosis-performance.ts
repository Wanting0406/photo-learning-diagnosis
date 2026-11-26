import { performance } from 'node:perf_hooks';
import type { Logger } from '@nestjs/common';
import type { DiagnosisInput, PhotoInput, RecognitionResult } from '@shared/api.interface';
import type { FeishuRecord } from './feishu.service';

export interface StoredPhoto { name: string; mimeType: PhotoInput['mimeType']; token: string }
export interface RecognitionArtifact {
  context: Omit<DiagnosisInput, 'photos' | 'wrongItems'>;
  photos: StoredPhoto[];
  recognition: RecognitionResult;
}

export class TaskTimings {
  readonly values: Record<string, number> = {};
  private readonly started = performance.now();
  private jobId: string | undefined;
  constructor(private readonly logger: Logger, private readonly request: string, private readonly mode: string) {}
  bindJob(jobId: string): void { this.jobId = jobId; }
  snapshot(): Record<string, number> {
    return { ...this.values, serverTotalMs: Math.round(performance.now() - this.started) };
  }
  async measure<T>(stage: string, action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    let ok = false;
    try { const value = await action(); ok = true; return value; }
    finally {
      const durationMs = Math.round(performance.now() - started);
      this.values[stage] = (this.values[stage] || 0) + durationMs;
      this.logger.log(JSON.stringify({ event: 'diagnosis_timing', request: this.request, jobId: this.jobId,
        mode: this.mode, stage, durationMs, ok }));
    }
  }
  finish(): void {
    this.values.serverTotalMs = Math.round(performance.now() - this.started);
    this.logger.log(JSON.stringify({ event: 'diagnosis_timing_summary', request: this.request, jobId: this.jobId,
      mode: this.mode, timings: this.values }));
  }
}

// Local workers own progress; final success is cached only after persistence. Detach stale in-flight reads.
export class TaskRecordCache {
  private readonly entries = new Map<string, { record: FeishuRecord; expires: number }>();
  private readonly reads = new Map<string, Promise<FeishuRecord>>();
  constructor(private readonly now: () => number = Date.now) {}
  put(record: FeishuRecord): void {
    this.invalidate(record.recordId);
    if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(record.recordId, { record: structuredClone(record),
      expires: this.now() + (record.fields['状态'] === 'running' ? 15 * 60 * 1000 : 15000) });
  }
  patch(id: string, fields: Record<string, unknown>): void {
    const entry = this.entries.get(id);
    if (entry) this.put({ recordId: id, fields: { ...entry.record.fields, ...fields } });
  }
  invalidate(id: string): void { this.entries.delete(id); this.reads.delete(id); }
  async get(id: string, read: () => Promise<FeishuRecord>): Promise<FeishuRecord> {
    const cached = this.entries.get(id);
    if (cached && cached.expires > this.now()) return structuredClone(cached.record);
    this.entries.delete(id);
    const pending = this.reads.get(id);
    if (pending) return structuredClone(await pending);
    const promise = read();
    // Bound bookkeeping even when many different task IDs are queried at once.
    if (this.reads.size < 256) this.reads.set(id, promise);
    try {
      const record = await promise;
      if (this.reads.get(id) === promise) {
        if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(id, { record: structuredClone(record),
          expires: this.now() + (record.fields['状态'] === 'running' ? 1000 : 15000) });
      }
      return structuredClone(record);
    } finally { if (this.reads.get(id) === promise) this.reads.delete(id); }
  }
}

// A bounded warm cache avoids downloading the same originals between recognition and analysis.
// Durable attachment tokens remain the fallback after expiry, eviction, restart or another instance.
export class RecognitionPhotoCache {
  private readonly entries = new Map<string, { photos: PhotoInput[]; bytes: number; expires: number }>();
  private bytes = 0;
  constructor(private readonly now: () => number = Date.now) {}
  private remove(id: string): void {
    this.bytes -= this.entries.get(id)?.bytes || 0;
    this.entries.delete(id);
  }
  get(id: string): PhotoInput[] | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) { this.remove(id); return undefined; }
    return entry.photos.map((photo) => ({ ...photo }));
  }
  set(id: string, photos: PhotoInput[]): void {
    for (const [key, entry] of this.entries) if (entry.expires <= this.now()) this.remove(key);
    this.remove(id);
    const bytes = photos.reduce((sum, photo) => sum + photo.dataBase64.length * 2, 0);
    if (bytes > 48 * 1024 * 1024) return;
    while (this.bytes + bytes > 48 * 1024 * 1024 || this.entries.size >= 32) {
      this.remove(this.entries.keys().next().value!);
    }
    this.entries.set(id, { photos: photos.map((photo) => ({ ...photo })), bytes, expires: this.now() + 10 * 60 * 1000 });
    this.bytes += bytes;
  }
}
