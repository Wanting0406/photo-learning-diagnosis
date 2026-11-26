import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { ArrowRight, Check, ClipboardPaste, Clock3, Loader2, Plus, RotateCcw, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import * as api from '@/api/diagnosis-gateway';
import type { DiagnosisInput, DiagnosisResult, RecognitionMode, RecognitionResult, BackendHealth, DiagnosisJob, CourseMatch } from '@shared/api.interface';
import { clipboardPhotos, photoSelectionError } from './photo-input';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { Image } from '@client/src/components/ui/image';
import { MatchedMaterials } from './MatchedMaterials';
import { appendMaterialHistory } from '@shared/material-history';
import { DiagnosisReport } from '@/components/DiagnosisReport';
import { examDiagnosisReport } from '@shared/diagnosis-presentation';

const modes: { value: RecognitionMode; label: string }[] = [
  { value: 'extract-wrong', label: '已批改' }, { value: 'grade', label: '未批改' }, { value: 'auto', label: '混合照片' },
];
const grades = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'];
const message = (error: unknown): string => error instanceof Error ? error.message : '操作失败，请重试';
const fieldClass = 'grid gap-2 text-sm';

function PhotoPreview({ file, remove, disabled }: { file: File; remove: () => void; disabled: boolean }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return <div className="relative min-w-0 rounded-md border bg-white p-2">
    {url ? <Image src={url} alt={file.name} className="aspect-[3/4] w-full object-contain" /> : <div className="aspect-[3/4] w-full" />}
    <div className="mt-2 truncate text-xs text-muted-foreground" title={file.name}>{file.name}</div>
    <Button variant="secondary" size="icon" className="absolute right-1 top-1 h-7 w-7" disabled={disabled}
      onClick={remove} title="移除照片" aria-label={`移除 ${file.name}`}><X className="h-4 w-4" /></Button>
  </div>;
}

function MatchedCourses({ courses, title, note }: { courses?: CourseMatch[]; title: string; note?: string }) {
  if (!courses?.length && !note) return null;
  return <div className="border-t pt-4">
    <h3 className="mb-2 text-sm font-semibold">{title}</h3>
    {note && <p className="text-sm leading-6 text-muted-foreground">{note}</p>}
    <div className="divide-y">{courses?.map((course) => <article key={`${course.sourceUrl}:${course.knowledgePoint}`} className="space-y-1 py-3 text-sm leading-6">
      <p className="break-words font-medium">{course.title}</p>
      <p className="text-muted-foreground">{[course.subject, course.grade, course.book, course.edition, course.courseType, course.region].filter(Boolean).join(' · ')}</p>
      {course.reviewNote && <p className="break-words text-muted-foreground">{course.reviewNote}</p>}
      <p className="break-words">对应知识点：{course.knowledgePoint}</p>
      <UniversalLink className="text-primary underline underline-offset-4" to={course.sourceUrl} target="_blank" rel="noreferrer">查看目录来源</UniversalLink>
    </article>)}</div>
  </div>;
}

export default function HomePage() {
  const [mode, setMode] = useState<RecognitionMode>('extract-wrong');
  const [studentName, setStudentName] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [recognized, setRecognized] = useState<RecognitionResult | null>(null);
  const [wrongText, setWrongText] = useState('');
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [job, setJob] = useState<DiagnosisJob | null>(null);
  const [recognitionJobId, setRecognitionJobId] = useState('');
  const [materialJobId, setMaterialJobId] = useState('');
  const [materialEvidence, setMaterialEvidence] = useState({ jobId: '', text: '' });
  const onMaterialEvidence = useCallback((text: string) => {
    setMaterialEvidence({ jobId: materialJobId, text });
  }, [materialJobId]);
  const parentMessage = appendMaterialHistory(result?.diagnosis.parentMessage || '',
    materialEvidence.jobId === materialJobId ? materialEvidence.text : '');
  const clientTiming = useRef<{ started: number; photoReadMs: number; submitMs: number; jobId: string } | null>(null);
  const [pendingId, setPendingId] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const formLocked = Boolean(busy || pendingId);
  const photoInput = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const acceptJob = useCallback((next: DiagnosisJob) => {
    setJob(next);
    if (next.status === 'running') { setBusy(next.stage); return; }
    setBusy(''); setPendingId('');
    if (next.result && next.mode === 'analyze' && 'diagnosis' in next.result) {
      setResult(next.result); setStudentName(next.studentName);
      setMaterialJobId(next.status === 'completed' ? next.jobId : '');
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } else if (next.result && 'wrongItems' in next.result) {
      setRecognized(next.result); setWrongText(next.result.wrongItems.join('\n'));
      setRecognitionJobId(next.reusable ? next.jobId : '');
      setMaterialJobId(next.jobId);
      setStudentName(next.studentName); setResult(null);
    }
    if (next.status === 'failed') setError(next.error || '处理失败，请联系管理员');
  }, []);
  useEffect(() => {
    const timing = clientTiming.current;
    if (!job || job.status === 'running' || !timing || timing.jobId !== job.jobId) return;
    clientTiming.current = null;
    void api.recordTiming({ jobId: timing.jobId, photoReadMs: timing.photoReadMs,
      submitMs: timing.submitMs, visibleMs: Math.round(performance.now() - timing.started) })
      .catch(() => logger.warn('Diagnosis timing upload failed'));
  }, [job]);
  useEffect(() => {
    api.fetchBackendHealth().then(setHealth).catch((e: unknown) => setError(message(e)));
    api.fetchSession().then(async (session) => {
      const key = `diagnosis-pending:${session.userId}`; setStorageKey(key);
      const pending = sessionStorage.getItem(key);
      if (pending) { setPendingId(pending); const previous = await api.findJob(pending); if (previous) acceptJob(previous); }
      else {
        const reportId = new URLSearchParams(window.location.search).get('job') || sessionStorage.getItem(`${key}:last-report`);
        if (reportId) acceptJob(await api.fetchJob(reportId));
      }
    }).catch((e: unknown) => setError(message(e)));
  }, [acceptJob]);
  useEffect(() => {
    if (storageKey && job && job.status !== 'running') {
      sessionStorage.removeItem(storageKey);
      if (job.mode === 'analyze' && job.result) sessionStorage.setItem(`${storageKey}:last-report`, job.jobId);
    }
  }, [storageKey, job]);
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let active = true; let timer: ReturnType<typeof setTimeout>; let failures = 0;
    const poll = async () => {
      try {
        const next = await api.fetchJob(job.jobId);
        if (!active) return;
        failures = 0; acceptJob(next);
        if (next.status === 'running') timer = setTimeout(poll, 1000);
      } catch (e: unknown) {
        if (!active) return;
        failures += 1;
        if (failures >= 3) { setError(message(e)); setBusy(''); }
        else timer = setTimeout(poll, 4000);
      }
    };
    timer = setTimeout(poll, 700);
    return () => { active = false; clearTimeout(timer); };
  }, [job?.jobId, job?.status, acceptJob]);
  const checkPending = async () => {
    if (!pendingId) return;
    setBusy('正在检查任务'); setError('');
    try {
      const previous = await api.findJob(pendingId);
      if (previous) {
        if (previous.status === 'running') setJob(null);
        setTimeout(() => acceptJob(previous), 0);
      } else { setError('未找到已提交任务，可以重新提交'); setPendingId(''); if (storageKey) sessionStorage.removeItem(storageKey); setBusy(''); }
    } catch (e: unknown) { setError(message(e)); setBusy(''); }
  };
  const invalidate = useCallback(() => {
    setMaterialJobId('');
    setRecognized(null); setRecognitionJobId(''); setResult(null); setWrongText(''); setError('');
  }, []);
  const addFiles = useCallback((incoming: File[]) => {
    if (formLocked || !incoming.length) return;
    const next = [...files, ...incoming];
    const validation = photoSelectionError(next);
    if (validation) { setError(validation); return; }
    invalidate(); setFiles(next);
  }, [files, formLocked, invalidate]);
  const currentPhotoSelection = useRef({ addFiles, formLocked });
  useEffect(() => { currentPhotoSelection.current = { addFiles, formLocked }; }, [addFiles, formLocked]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const incoming = clipboardPhotos(event.clipboardData);
      if (!incoming.length) return;
      event.preventDefault();
      addFiles(incoming);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [addFiles]);
  const pastePhotos = async () => {
    if (formLocked) return;
    try {
      if (!navigator.clipboard?.read) throw new Error('unsupported');
      const items = await navigator.clipboard.read();
      const incoming: File[] = [];
      for (const item of items) {
        const type = item.types.find((mime) => ['image/png', 'image/jpeg', 'image/webp'].includes(mime))
          || item.types.find((mime) => mime.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        incoming.push(new File([blob], `粘贴照片-${Date.now()}-${incoming.length + 1}.${type.split('/')[1]}`, { type }));
      }
      if (currentPhotoSelection.current.formLocked) return;
      if (!incoming.length) { setError('剪贴板中没有图片，请复制图片后重试，或选择照片文件'); return; }
      currentPhotoSelection.current.addFiles(incoming);
    } catch {
      if (!currentPhotoSelection.current.formLocked) setError('无法读取剪贴板，请在页面粘贴图片，或选择照片文件');
    }
  };
  const getInput = async (reuse: boolean): Promise<DiagnosisInput> => ({ studentName: studentName.trim(), grade, subject, note,
    photos: reuse ? [] : await Promise.all(files.map(api.readPhoto)),
    wrongItems: wrongText.split('\n').map((line) => line.trim()).filter(Boolean) });
  const run = async (step: 'recognize' | 'analyze') => {
    if (pendingId || busy) return;
    if (step === 'recognize') setMaterialJobId('');
    setError(''); setBusy('正在提交任务');
    const timing = { started: performance.now(), photoReadMs: 0, submitMs: 0, jobId: '' };
    clientTiming.current = timing;
    try {
      const reuse = step === 'analyze' && Boolean(recognitionJobId);
      const input = await getInput(reuse);
      timing.photoReadMs = Math.round(performance.now() - timing.started);
      if (storageKey) sessionStorage.removeItem(`${storageKey}:last-report`);
      const requestId = crypto.randomUUID(); setPendingId(requestId);
      if (storageKey) sessionStorage.setItem(storageKey, requestId);
      const submitted = performance.now();
      const next = step === 'recognize' ? await api.recognize(mode, input, requestId)
        : await api.analyze(input, requestId, reuse ? recognitionJobId : undefined);
      timing.submitMs = Math.round(performance.now() - submitted); timing.jobId = next.jobId;
      acceptJob(next);
    } catch (e: unknown) { setError(message(e)); setBusy(''); }
  };
  const d = result?.diagnosis;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">试卷/作业分析</h1>
      <span className={`flex items-center gap-2 text-xs ${health?.reachable ? 'text-emerald-700' : 'text-muted-foreground'}`}>
        <span className={`h-2 w-2 rounded-full ${health?.reachable ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {health?.message || '正在检查服务'}
      </span>
    </div>
    <ol className="grid grid-cols-3 border-y py-3 text-sm">
      {['照片与学生', '确认错题', '诊断报告'].map((label, index) => <li key={label}
        className={`flex items-center gap-2 ${index === (result ? 2 : recognized ? 1 : 0) ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs">{index + 1}</span>{label}
      </li>)}
    </ol>
    {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {pendingId && !busy && <Button variant="outline" onClick={checkPending}><RefreshCw className="mr-2 h-4 w-4" />检查任务状态</Button>}
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="min-w-0 space-y-5">
        <h2 className="text-base font-semibold">学生与照片</h2>
        <fieldset disabled={formLocked} className="space-y-5 disabled:opacity-70">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={fieldClass} htmlFor="student-name">
              <span>学生姓名 <span aria-hidden="true" className="ml-1 text-xs text-red-700">必填</span></span>
              <Input id="student-name" required aria-describedby={!studentName.trim() ? 'student-name-hint' : undefined}
                maxLength={100} value={studentName} placeholder="请输入学生姓名"
                onChange={(e) => { invalidate(); setStudentName(e.target.value); }} />
            </label>
            <label className={fieldClass}>年级<select className="h-9 rounded-md border bg-white px-3" value={grade} onChange={(e) => { invalidate(); setGrade(e.target.value); }}>
              <option value="">自动识别</option>{grades.map((g) => <option key={g}>{g}</option>)}</select></label>
            <label className={fieldClass}>学科<select className="h-9 rounded-md border bg-white px-3" value={subject} onChange={(e) => { invalidate(); setSubject(e.target.value); }}>
              <option value="">自动识别</option>{['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治', '政治'].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className={`${fieldClass} sm:col-span-2`}>备注<Textarea value={note} maxLength={2000} className="min-h-24 bg-white" placeholder="考试范围、近期情况、学习目标" onChange={(e) => { invalidate(); setNote(e.target.value); }} /></label>
          </div>
          <div role="group" aria-label="批改状态" className="grid grid-cols-3 rounded-md border bg-white p-1">
            {modes.map((m) => <button key={m.value} type="button" aria-pressed={mode === m.value}
              className={`rounded px-2 py-2 text-sm ${mode === m.value ? 'bg-accent font-medium text-primary' : 'text-muted-foreground'}`}
              onClick={() => { invalidate(); setMode(m.value); }}>{m.label}</button>)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>卷面照片</span>
            <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{files.length}/6 张 · {(files.reduce((size, file) => size + file.size, 0) / 1024 / 1024).toFixed(1)}/12 MB</span>
              <Button type="button" variant="ghost" size="icon" title="粘贴照片" aria-label="粘贴照片" onClick={pastePhotos}><ClipboardPaste className="h-4 w-4" /></Button></div></div>
          <div className="grid grid-cols-3 gap-3" onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (!formLocked) addFiles(Array.from(e.dataTransfer.files)); }}>
            {files.map((file, index) => <PhotoPreview key={`${file.name}-${file.lastModified}-${index}`} file={file} disabled={formLocked}
              remove={() => { invalidate(); setFiles(files.filter((_, i) => i !== index)); }} />)}
            {files.length < 6 && <button type="button" className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-white text-sm text-muted-foreground hover:border-primary"
              onClick={() => photoInput.current?.click()}><Plus className="h-6 w-6" />添加照片</button>}
          </div>
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
            onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
          <Button className="w-full" disabled={!studentName.trim() || files.length === 0 || Boolean(busy) || Boolean(pendingId) || health?.configured === false}
            onClick={() => run('recognize')}><ArrowRight className="mr-2 h-4 w-4" />{recognized ? '重新识别' : '识别照片'}</Button>
        </fieldset>
        <div className="space-y-2 text-xs leading-5">
          {!studentName.trim() && <p id="student-name-hint" className="text-amber-800">请先填写学生姓名，再开始识别。</p>}
          <p className="flex items-start gap-2 text-muted-foreground">
            <Clock3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>处理目标 30 秒；复杂多图或模型繁忙时可能超出，确认错题的时间另计。</span>
          </p>
        </div>
      </section>
      <section className="min-w-0 space-y-4 border-t pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <h2 className="text-base font-semibold">确认错题</h2>
        {!recognized ? <div className="flex min-h-48 items-center justify-center border-y text-sm text-muted-foreground">{busy || '待识别'}</div> : <>
          <p className="text-sm text-muted-foreground">{recognized.scopeNote}</p>
          {(recognized.needsRephoto || recognized.warnings.length > 0) && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {recognized.rephotoHint || recognized.photoQuality.advice}{recognized.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
          {Boolean(recognized.knowledgePoints?.length) && <div className="space-y-2 border-t pt-4 text-sm leading-6">
            <h3 className="font-semibold">初步知识点</h3>
            {recognized.knowledgePoints?.map((point, index) => <p key={index} className="break-words">{point.subject} · {point.name}</p>)}
          </div>}
          <MatchedCourses courses={recognized.courseMatches} title="匹配课程" note={recognized.courseMatchNote} />
          {!result && materialJobId && <MatchedMaterials key={materialJobId} jobId={materialJobId} onEvidenceChange={onMaterialEvidence} />}
          {recognized.items && recognized.items.length > 0 && <div className="max-h-72 overflow-y-auto divide-y border-y">
            {recognized.items.map((item, index) => <label key={index} className="flex items-start gap-3 py-3 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-purple-600" disabled={formLocked || Boolean(result)}
                checked={wrongText.split('\n').includes(item.item)} onChange={(e) => {
                  const items = wrongText.split('\n').filter((line) => line && line !== item.item);
                  setWrongText((e.target.checked ? [...items, item.item] : items).join('\n'));
                }} />
              <div className="min-w-0 flex-1"><p className="break-words font-medium">{item.item}</p>
                <p className="mt-1 text-xs text-muted-foreground">作答：{item.studentAnswer} · 参考：{item.referenceAnswer}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.basis}</p></div>
              <span className={`shrink-0 text-xs ${item.verdict === '错' ? 'text-red-700' : item.verdict === '对' ? 'text-emerald-700' : 'text-amber-700'}`}>{item.verdict}</span>
            </label>)}
          </div>}
          <label className={fieldClass}>待分析错题<Textarea className="min-h-40 bg-white" value={wrongText}
            disabled={formLocked || Boolean(result)} onChange={(e) => setWrongText(e.target.value)} /></label>
          <Button className="w-full" disabled={Boolean(busy) || Boolean(pendingId) || files.length === 0 || Boolean(result)} onClick={() => run('analyze')}>
            <Check className="mr-2 h-4 w-4" />{wrongText.trim() ? '确认并生成诊断' : '确认无错题，分析掌握情况'}</Button>
        </>}
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Loader2 className="h-4 w-4 animate-spin" />{busy}</p>}
      </section>
    </div>
    {result && d && <section ref={resultRef} className="space-y-5 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-semibold">{studentName}的学情诊断</h2>
          <p className={`mt-1 text-sm ${result.stored ? 'text-emerald-700' : 'text-amber-700'}`}>{result.stored ? '已保存至飞书' : '尚未保存至飞书'}</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={Boolean(busy)} onClick={() => {
            invalidate(); setFiles([]); setStudentName(''); setNote(''); setJob(null);
            if (storageKey) sessionStorage.removeItem(`${storageKey}:last-report`);
            const url = new URL(window.location.href); url.searchParams.delete('job'); window.history.replaceState(null, '', url);
          }}><RotateCcw className="mr-2 h-4 w-4" />新建诊断</Button>
        </div>
      </div>
      {(result.needsRephoto || result.warnings.length > 0) && <div className="bg-amber-50 p-3 text-sm text-amber-900">{result.rephotoHint}{result.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
      <DiagnosisReport key={materialJobId} report={examDiagnosisReport({ ...d, parentMessage }, studentName)}
        jobId={materialJobId} source="exam" />
      <details><summary className="cursor-pointer text-sm">相关中高考历史素材</summary>
        {materialJobId && <MatchedMaterials key={materialJobId} jobId={materialJobId} onEvidenceChange={onMaterialEvidence} />}
      </details>
    </section>}
  </div>;
}
