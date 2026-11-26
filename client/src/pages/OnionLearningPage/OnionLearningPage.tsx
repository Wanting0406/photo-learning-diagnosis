import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, X, Loader2, ArrowRight, MessageSquare, RefreshCw, FilePlus2, Link2, UserRound, PlaySquare, FileChartColumn, Clock3, ClipboardList, CircleCheck, BookOpenCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Image } from '@/components/ui/image';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import * as api from '@/api/diagnosis-gateway';
import type { LearningPlanInput, LearningPlanJob } from '@shared/api.interface';
import { DiagnosisReport } from '@/components/DiagnosisReport';
import { clipboardPhotos, photoSelectionError } from '../HomePage/photo-input';
import { MatchedMaterials } from '../HomePage/MatchedMaterials';
import { appendMaterialHistory } from '@shared/material-history';
import './learning-plan.css';

const grades = ['小学', '初中', '高中'];
const subjects = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治', '政治'];
const attributes = ['同步巩固与分层提升', '基础修复', '考前复习', '学有余力培优'];
const err = (error: unknown): string => error instanceof Error ? error.message : '操作未完成，请重试';
type PhotoGroup = 'watch' | 'report';

function Choice({ label, value, choices, change }: { label: string; value: string; choices: string[]; change: (v: string) => void }) {
  return <label className="learning-field"><span>{label}</span><Select value={value} onValueChange={change}>
    <SelectTrigger className="w-full bg-white" aria-label={label}><SelectValue placeholder="请选择">{value || '请选择'}</SelectValue></SelectTrigger>
    <SelectContent>{choices.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
  </Select></label>;
}
function Photo({ file, remove }: { file: File; remove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value); }, [file]);
  return <div className="learning-photo relative min-w-0 border bg-white p-2">
    {url && <Image src={url} alt={file.name} sizes="180px" className="aspect-[4/3] w-full object-contain" />}
    <p className="truncate text-xs text-muted-foreground">{file.name}</p>
    <Button type="button" size="icon" variant="secondary" title="移除截图" aria-label={`移除${file.name}`}
      className="absolute right-1 top-1" onClick={remove}><X className="size-4" /></Button>
  </div>;
}
export default function OnionLearningPage() {
  const [studentName, setName] = useState(''); const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('数学'); const [attribute, setAttribute] = useState(attributes[0]);
  const [note, setNote] = useState(''); const [watchText, setWatchText] = useState(''); const [reportText, setReportText] = useState('');
  const [reportUrl, setReportUrl] = useState(''); const [sourceInfo, setSourceInfo] = useState('');
  const [photos, setPhotos] = useState<Record<PhotoGroup, File[]>>({ watch: [], report: [] });
  const [job, setJob] = useState<LearningPlanJob | null>(null); const [pending, setPending] = useState('');
  const [storageKey, setStorageKey] = useState(''); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [materialEvidence, setMaterialEvidence] = useState({ jobId: '', text: '' });
  const materialJobId = job?.status === 'completed' ? job.jobId : '';
  const onMaterialEvidence = useCallback((text: string) => {
    setMaterialEvidence({ jobId: materialJobId, text });
  }, [materialJobId]);
  const watchPicker = useRef<HTMLInputElement>(null); const reportPicker = useRef<HTMLInputElement>(null);
  const report = job?.report ? { ...job.report, parentMessage: appendMaterialHistory(job.report.parentMessage,
    materialEvidence.jobId === materialJobId ? materialEvidence.text : '') } : undefined;
  const locked = Boolean(busy || pending || job?.status === 'running');
  const accept = useCallback((next: LearningPlanJob) => {
    setJob(next);
    if (next.status !== 'running') { setBusy(''); setPending(''); }
    if (next.status === 'failed') setError(next.error);
  }, []);
  useEffect(() => {
    let active = true;
    void api.fetchSession().then(async (session) => {
      if (!active) return;
      const key = `learning-plan:${session.userId}`; setStorageKey(key);
      const requestId = sessionStorage.getItem(`${key}:pending`);
      const id = new URLSearchParams(window.location.search).get('plan') || sessionStorage.getItem(key);
      if (requestId) {
        setPending(requestId); const previous = await api.findLearningPlan(requestId);
        if (active && previous) accept(previous);
        else if (active) { setPending(''); sessionStorage.removeItem(`${key}:pending`); }
      } else if (id) { const previous = await api.fetchLearningPlan(id); if (active) accept(previous); }
    }).catch((e: unknown) => { if (active) setError(err(e)); });
    return () => { active = false; };
  }, [accept]);
  useEffect(() => {
    if (!storageKey || !job) return;
    sessionStorage.setItem(storageKey, job.jobId);
    if (job.status !== 'running') sessionStorage.removeItem(`${storageKey}:pending`);
  }, [storageKey, job]);
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let active = true; let timer: ReturnType<typeof setTimeout>; let failures = 0;
    const poll = async () => {
      try {
        const next = await api.fetchLearningPlan(job.jobId); if (!active) return;
        failures = 0; accept(next); if (next.status === 'running') timer = setTimeout(poll, 1000);
      } catch (e: unknown) {
        if (!active) return; failures++;
        if (failures >= 3) { setBusy(''); setError(err(e)); }
        else timer = setTimeout(poll, 4000);
      }
    };
    timer = setTimeout(poll, 700); return () => { active = false; clearTimeout(timer); };
  }, [job?.jobId, job?.status, accept]);
  const addPhotos = (group: PhotoGroup, incoming: File[]) => {
    if (locked || !incoming.length) return;
    const next = { ...photos, [group]: [...photos[group], ...incoming] };
    const issue = photoSelectionError([...next.watch, ...next.report]);
    if (issue) setError(issue); else { setPhotos(next); setError(''); }
  };
  const importReport = async () => {
    setBusy('读取学情报告'); setError('');
    try { const source = await api.importLearningReport(reportUrl); setReportText(source.text); setSourceInfo(source.source); setReportUrl(''); }
    catch (e: unknown) { setError(err(e)); } finally { setBusy(''); }
  };
  const generate = async () => {
    setError(''); setBusy('整理资料'); const requestId = crypto.randomUUID();
    try {
      const input: LearningPlanInput = { studentName, grade, subject, attribute, note, watchText, reportText,
        watchPhotos: await Promise.all(photos.watch.map(api.readPhoto)), reportPhotos: await Promise.all(photos.report.map(api.readPhoto)) };
      setPending(requestId); if (storageKey) sessionStorage.setItem(`${storageKey}:pending`, requestId);
      const next = await api.startLearningPlan(input, requestId); accept(next); setBusy('');
    } catch (e: unknown) { setBusy(''); setError(err(e)); }
  };
  const recover = async () => {
    setError(''); setBusy('查询任务');
    try {
      const next = pending ? await api.findLearningPlan(pending) : job ? await api.fetchLearningPlan(job.jobId) : null;
      if (next) { setJob(null); setTimeout(() => accept(next), 0); }
      else { setPending(''); if (storageKey) sessionStorage.removeItem(`${storageKey}:pending`); }
    } catch (e: unknown) { setError(err(e)); } finally { setBusy(''); }
  };
  const reset = () => {
    setJob(null); setPending(''); setError(''); setName(''); setGrade(''); setNote(''); setWatchText(''); setReportText('');
    setReportUrl(''); setSourceInfo(''); setPhotos({ watch: [], report: [] });
    if (storageKey) { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(`${storageKey}:pending`); }
    const url = new URL(window.location.href); url.searchParams.delete('plan'); window.history.replaceState(null, '', url);
  };
  const canGenerate = studentName.trim() && grade && (watchText.trim() || photos.watch.length) &&
    (reportText.trim() || photos.report.length) && !reportUrl.trim() && !locked;
  const phase = report ? 2 : pending || job?.status === 'running' ? 1 : 0;
  return <div className="learning-page">
    <div className="learning-page-heading"><h1>学情诊断</h1>
      {report ? <Button variant="outline" disabled={locked} onClick={reset}><FilePlus2 className="size-4" />新建诊断</Button>
        : <ol className="learning-workflow" aria-label="推荐进度">{['资料录入', '问题定位', '产品推荐'].map((name, i) =>
          <li key={name} className={i === phase ? 'is-current' : i < phase ? 'is-complete' : ''} aria-current={i === phase ? 'step' : undefined}>
            {i < phase ? <Check aria-hidden="true" /> : i === 0 ? <ClipboardList aria-hidden="true" /> : i === 1 ? <BookOpenCheck aria-hidden="true" /> : <MessageSquare aria-hidden="true" />}
            <span>{name}</span>{i < 2 && <ArrowRight aria-hidden="true" className="learning-flow-arrow" />}</li>)}</ol>}</div>
    {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {(pending || job?.status === 'running') && <div className="learning-progress">
      <Loader2 className="size-4 animate-spin" /><span role="status">{busy || job?.stage || '正在提交诊断'}</span>
      <Button variant="ghost" size="sm" onClick={recover} disabled={Boolean(busy)}><RefreshCw className="size-4" />检查状态</Button></div>}
    {!report && <fieldset disabled={locked} className="learning-form disabled:opacity-70">
      <section className="learning-student-section"><h2 className="learning-section-title"><UserRound aria-hidden="true" />学生信息</h2>
      <div className="learning-student-fields">
        <label className="learning-field">学生姓名 · 必填<Input required value={studentName} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="学生姓名" /></label>
        <Choice label="学段 · 必填" value={grade} choices={grades} change={setGrade} />
        <Choice label="诊断科目" value={subject} choices={subjects} change={setSubject} />
        <Choice label="需求方向" value={attribute} choices={attributes} change={setAttribute} />
      </div></section>
      <div className="learning-sources">{(['watch', 'report'] as PhotoGroup[]).map((group) => <section key={group}
        className={`learning-source learning-source-${group}`} onPaste={(e) => {
          const incoming = clipboardPhotos(e.clipboardData); if (incoming.length) { e.preventDefault(); addPhotos(group, incoming); }
        }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addPhotos(group, Array.from(e.dataTransfer.files)); }}>
        <div className="learning-source-heading"><h2>{group === 'watch' ? <PlaySquare aria-hidden="true" /> : <FileChartColumn aria-hidden="true" />}{group === 'watch' ? '观看记录' : '学情报告'}</h2>
          <span className={`learning-source-state${(group === 'watch' ? watchText.trim() : reportText.trim()) || photos[group].length ? ' is-ready' : ''}`}>
            {(group === 'watch' ? watchText.trim() : reportText.trim()) || photos[group].length ? <><CircleCheck aria-hidden="true" />已添加</> : '待添加'}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => (group === 'watch' ? watchPicker : reportPicker).current?.click()}><ImagePlus className="size-4" />添加截图</Button></div>
        {group === 'report' && <div className="learning-source-link"><Input aria-label="学情报告链接" value={reportUrl} maxLength={6000}
          autoComplete="off" placeholder="洋葱学情报告链接" onChange={(e) => setReportUrl(e.target.value)} className="min-w-0 flex-1" />
          <Button type="button" variant="outline" title="读取报告链接" aria-label="读取报告链接" size="icon" disabled={!reportUrl.trim()} onClick={importReport}><Link2 className="size-4" /></Button></div>}
        <Textarea aria-label={group === 'watch' ? '观看记录正文或截图' : '学情报告正文或截图'} className="learning-source-text" maxLength={8000}
          value={group === 'watch' ? watchText : reportText} placeholder={group === 'watch' ? '粘贴观看记录文字或截图' : '粘贴学情报告正文、链接或截图'}
          onPaste={(e) => { if (group === 'report' && !clipboardPhotos(e.clipboardData).length) {
            const text = e.clipboardData.getData('text/plain').trim(); if (/^https:\/\//u.test(text)) { e.preventDefault(); setReportUrl(text); }
          } }} onChange={(e) => {
            if (group === 'watch') setWatchText(e.target.value);
            else { setReportText(e.target.value); setSourceInfo(''); }
          }} />
        {group === 'report' && sourceInfo && <p className="text-xs text-emerald-800">已读取：{sourceInfo}</p>}
        {photos[group].length > 0 && <div className="learning-photo-grid">{photos[group].map((file, i) => <Photo key={`${i}:${file.name}`} file={file}
          remove={() => setPhotos({ ...photos, [group]: photos[group].filter((_, n) => n !== i) })} />)}</div>}
        <Input ref={group === 'watch' ? watchPicker : reportPicker} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden"
          aria-label={group === 'watch' ? '上传观看截图' : '上传报告截图'} onChange={(e) => { addPhotos(group, Array.from(e.target.files || [])); e.target.value = ''; }} />
      </section>)}</div>
      <label className="learning-field learning-note"><span className="learning-note-heading">备注<small aria-hidden="true">{note.length}/2000</small></span>
        <Textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="教材版本、学校进度、目标与可用时间" /></label>
      <div className="learning-submit"><div className="learning-submit-meta"><span><ImagePlus aria-hidden="true" />截图 {photos.watch.length + photos.report.length}/6 张 · 合计最多 12 MB</span>
        <span><Clock3 aria-hidden="true" />处理目标 30 秒，模型繁忙时可能延长</span></div>
        <Button size="lg" disabled={!canGenerate} onClick={generate}>生成学情诊断<ArrowRight className="size-4" /></Button></div>
      {busy && !pending && <p role="status" className="text-sm text-muted-foreground">{busy}</p>}
    </fieldset>}
    {report && job && <section className="learning-report" data-testid="learning-report">
      <DiagnosisReport key={job.jobId} report={report} jobId={job.jobId} source="learning" />
      <details><summary className="cursor-pointer text-sm">相关中高考历史素材</summary>
        {job.status === 'completed' && <MatchedMaterials key={job.jobId} jobId={job.jobId} source="learning" onEvidenceChange={onMaterialEvidence} />}
      </details>
    </section>}
  </div>;
}
