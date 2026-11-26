import { useEffect, useState } from 'react';
import { Copy, Download, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Image } from '@/components/ui/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LearningPlanReport } from '@shared/api.interface';
import { diagnosisSelection, diagnosisBoardHtml, learningPlanText, learningReportMetrics, learningMetricAnalysis, parentMetricPeriod } from '@shared/learning-plan-format';
import { parentCourseNote, parentSolutionCopy, plainSalesText, reportProductText, salesTextParts, solutionCourses } from '@shared/diagnosis-presentation';
import { ProductMaterialGallery } from './ProductMaterialGallery';
import * as api from '@/api/diagnosis-gateway';
import { reportImage } from '@/pages/HomePage/report-image';
import './diagnosis-report.css';

interface Props { report: LearningPlanReport; jobId: string; source: 'learning' | 'exam' }
export function DiagnosisReport({ report, jobId, source }: Props) {
  const [selected, setSelected] = useState<string[]>(() => diagnosisSelection(report));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const metrics = learningReportMetrics(report);
  const highlighted = (text: string) => salesTextParts(reportProductText(report, text)).map((part, i) => part.strong ? <strong key={i}>{part.text}</strong> : part.text);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); }, [copied]);
  const select = (keys: string[]) => { setSelected(keys); };
  const toggle = (key: string) => {
    setSelected(values => values.includes(key) ? values.filter(v => v !== key) : [...values, key]); };
  const selector = (key: string, title: string) => <label className="diagnosis-choice">
    <Checkbox checked={selected.includes(key)} onCheckedChange={() => toggle(key)} aria-label={`选择${title}`} />{title}</label>;
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(plainSalesText(reportProductText(report, text))); setCopied(true); }
    catch { setError('复制失败，请选中文字复制。'); }
  };
  const showImage = (blob: Blob, name: string) => setPreview({ blob, name, url: URL.createObjectURL(blob) });
  const exportImage = async (copy: boolean) => {
    setBusy(true); setError('');
    try {
      const image = reportImage(diagnosisBoardHtml(report));
      if (copy && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]); setCopied(true); }
        catch { const blob = await image; showImage(blob, `${report.studentName}-学情诊断`); setError('当前浏览器不能复制图片，已打开诊断长图，可下载发送。'); }
      } else showImage(await image, `${report.studentName}-学情诊断`);
    } catch (e) { setError(e instanceof Error ? e.message : '长图生成失败'); }
    finally { setBusy(false); }
  };
  return <div className="diagnosis-report" data-testid="diagnosis-report">
    <header className="diagnosis-report-header"><div><p>洋葱学园 · 学情诊断</p><h2>{report.studentName}</h2>
      <span>{report.grade} · {report.subjects.join('、')}</span></div><span>{report.createdAt.slice(0, 10)}</span></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="diagnosis-share-toolbar">
      <Button variant="ghost" size="sm" onClick={() => select([...diagnosisSelection(report), ...report.phoneSteps.map((_, i) => `phone:${i}`)])}>全选</Button>
      <Button variant="ghost" size="sm" onClick={() => select([])}>清空</Button>
      <Button variant="outline" size="sm" disabled={!selected.length || busy} onClick={() => copyText(learningPlanText(report, selected))}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}复制所选文字</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => exportImage(true)}><Copy className="size-4" />复制诊断长图</Button>
      <Button size="sm" disabled={busy} onClick={() => exportImage(false)}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}生成诊断长图</Button>
    </div>
    <section><div className="diagnosis-section-heading">{selector('parent', '给家长的话')}
      <Button variant="ghost" size="icon" title="复制家长话术" onClick={() => copyText(report.parentMessage)}><Copy className="size-4" /></Button></div>
      <p className="diagnosis-parent">{highlighted(report.parentMessage)}</p></section>
    {metrics.length > 0 && <section>{selector('metrics', '学习概况')}<div className="diagnosis-metrics">
      {metrics.map((m, i) => <div key={i}><span>{m.label}</span><strong>{m.value}<small>{m.unit}</small></strong>
        {parentMetricPeriod(m) && <p>{parentMetricPeriod(m)}</p>}
        {learningMetricAnalysis(report, m) && <p className="diagnosis-metric-analysis">{learningMetricAnalysis(report, m)}</p>}</div>)}</div></section>}
    <section><div className="diagnosis-section-heading">{selector('summary', '目前需要关注')}
      <Button variant="ghost" size="icon" title="复制诊断总结" onClick={() => copyText(report.summary)}><Copy className="size-4" /></Button></div><p>{highlighted(report.summary)}</p>
      {report.diagnosisBoard && <div className="diagnosis-detail">{report.diagnosisBoard.focus !== report.summary && <><h3>孩子目前需要补上的一步</h3><p>{highlighted(report.diagnosisBoard.focus)}</p></>}
        <h3>与升学的联系</h3><p>{highlighted(report.diagnosisBoard.importance)}</p></div>}</section>
    <ProductMaterialGallery key={`${source}:${jobId}`} jobId={jobId} source={source} onPreview={showImage} />
    <details><summary>洋葱课程 · 从这里开始学</summary>
      {!report.solutions.length && <p className="text-muted-foreground">当前资料不足以确定课程产品，请先核实问题。</p>}
      {report.solutions.slice(0, 2).map((s, index) => {
        const courses = solutionCourses(report, index);
        return <article className="diagnosis-solution" key={s.capabilityId}>
          <div className="diagnosis-solution-body">{selector(`product:${s.capabilityId}`, reportProductText(report, s.name))}<p className="diagnosis-problem">{s.knowledgePoint}</p>
            {parentSolutionCopy(s).map((text, i) => <p key={i}>{highlighted(text)}</p>)}
            {courses.map(c => <div className="diagnosis-course" key={c.sourceUrl}><span>{c.reviewNote ? '可以和老师一起确认这节课' : '可以从这节课开始'}</span><b>{c.title}</b>
              <span>{[c.grade, c.book, c.edition, c.courseType].filter(Boolean).join(' · ')}</span>
              <small>对应知识点：{c.knowledgePoint}</small>{parentCourseNote(c) && <small>{parentCourseNote(c)}</small>}</div>)}
            <details><summary>老师备忘</summary><p>学习后观察：{s.acceptance}</p><p>{s.boundary}</p>
              {!courses.length && <p>该产品下暂无已核实的同知识点课程名称，课程入口待确认。</p>}
              {s.sellingPoints?.map(p => <p key={p.capabilityId}>{p.name}：{p.boundary}</p>)}</details></div>
        </article>;
      })}
    </details>
    {report.phoneSteps.length > 0 && <details><summary>电话沟通话术</summary>{report.phoneSteps.map((step, i) =>
      <section key={step.title}><div className="diagnosis-section-heading">{selector(`phone:${i}`, step.title)}
        <Button variant="ghost" size="icon" title={`复制${step.title}`} onClick={() => copyText(step.text)}><Copy className="size-4" /></Button></div><p>{highlighted(step.text)}</p></section>)}</details>}
    {preview && <Dialog open onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent className="max-w-3xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{preview.name}</DialogTitle></DialogHeader><div className="max-h-[65vh] overflow-auto"><Image src={preview.url} alt={preview.name} sizes="800px" className="h-auto w-full" /></div>
      <Button onClick={() => api.download(preview.blob, `${preview.name}.${preview.blob.type.split('/')[1] || 'png'}`)}><Download className="size-4" />下载图片</Button>
    </DialogContent></Dialog>}
  </div>;
}
