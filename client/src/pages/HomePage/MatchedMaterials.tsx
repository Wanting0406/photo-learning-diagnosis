import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, ImageOff, Loader2, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as api from '@/api/diagnosis-gateway';
import type { MaterialMatch, MaterialMatchesResult } from '@shared/api.interface';
import { materialHistoryText } from '@shared/material-history';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

const message = (error: unknown): string => error instanceof Error ? error.message : '长图读取失败，请重试';
const filename = (item: MaterialMatch, blob: Blob): string =>
  `${item.name.replace(/[\\/:*?"<>|\r\n]/gu, '_').slice(0, 100)}.${blob.type.split('/')[1] || 'png'}`;

function MaterialItem({ item, onAvailabilityChange }: {
  item: MaterialMatch; onAvailabilityChange: (id: string, ready: boolean) => void;
}) {
  const [thumbnail, setThumbnail] = useState('');
  const [thumbnailError, setThumbnailError] = useState(false);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [original, setOriginal] = useState<Blob | null>(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let active = true; let url = ''; setThumbnail(''); setThumbnailError(false); setThumbnailLoaded(false);
    api.fetchMaterialImage(item.materialId, true).then(blob => {
      if (active) { url = URL.createObjectURL(blob); setThumbnail(url); }
    }).catch(() => { if (active) setThumbnailError(true); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [item.materialId, attempt]);
  useEffect(() => {
    if (!original) return;
    const url = URL.createObjectURL(original); setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [original]);
  const ready = ((thumbnailLoaded && !thumbnailError) || originalLoaded) && !error;
  const history = materialHistoryText([item], new Set(ready ? [item.materialId] : []));
  useEffect(() => {
    onAvailabilityChange(item.materialId, ready);
    return () => onAvailabilityChange(item.materialId, false);
  }, [item.materialId, ready, onAvailabilityChange]);
  const load = async (download: boolean) => {
    setBusy(true); setError('');
    try {
      const blob = original || await api.fetchMaterialImage(item.materialId);
      setOriginal(blob);
      if (download) api.download(blob, filename(item, blob));
      else { setZoom(1); setOpen(true); }
    } catch (e: unknown) { setError(message(e)); }
    finally { setBusy(false); }
  };
  return <article className="grid min-w-0 grid-cols-[80px_minmax(0,1fr)] gap-3 py-4">
    <button type="button" className="flex h-28 w-20 items-center justify-center overflow-hidden rounded border bg-white"
      disabled={busy} title={thumbnailError ? '重新读取缩略图' : '预览完整长图'}
      aria-label={thumbnailError ? '重新读取缩略图' : `预览 ${item.name}`}
      onClick={() => thumbnailError ? setAttempt(value => value + 1) : void load(false)}>
      {thumbnailError ? <ImageOff className="h-5 w-5 text-muted-foreground" /> : thumbnail
        ? <Image src={thumbnail} alt={item.name} width={80} loading="eager" className="h-full w-full object-contain"
          onLoad={() => setThumbnailLoaded(true)} onError={() => { setThumbnailError(true); setThumbnailLoaded(false); }} />
        : <Loader2 className="h-4 w-4 animate-spin" />}
    </button>
    <div className="min-w-0 space-y-1 text-sm leading-6">
      <h4 className="break-words font-medium">{item.name}</h4>
      <p className="break-words text-xs text-muted-foreground">{item.year} · {item.exam} · {item.subjects.join('、')} · {item.region || '地区未标注'}</p>
      <p className="break-words">命中知识点：{item.matchedKnowledgePoints.join('、')}</p>
      {history && <p className="whitespace-pre-wrap break-words font-medium text-emerald-800" data-testid="material-exam-history">{history}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="icon" title="预览完整长图" aria-label="预览完整长图" disabled={busy} onClick={() => void load(false)}><ZoomIn className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" title="下载原图" aria-label="下载原图" disabled={busy} onClick={() => void load(true)}><Download className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" title="查看来源" aria-label="查看来源" asChild><UniversalLink to={item.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></UniversalLink></Button>
        {busy && <span role="status" className="text-xs text-muted-foreground">正在读取原图...</span>}
      </div>
      {error && <p role="alert" className="break-words text-xs text-red-700">{error}</p>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl" aria-describedby={undefined}>
        <DialogHeader><DialogTitle className="break-words pr-6 text-base">{item.name}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" title="缩小" aria-label="缩小" disabled={zoom <= 1} onClick={() => setZoom(value => value - 0.5)}><ZoomOut className="h-4 w-4" /></Button>
          <span className="w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="icon" title="放大" aria-label="放大" disabled={zoom >= 3} onClick={() => setZoom(value => value + 0.5)}><ZoomIn className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" title="下载原图" aria-label="下载原图" onClick={() => original && api.download(original, filename(item, original))}><Download className="h-4 w-4" /></Button>
        </div>
        <div className="h-[65dvh] min-w-0 overflow-auto border bg-white">
          {originalUrl && <div style={{ width: `${zoom * 100}%` }}><Image src={originalUrl} alt={item.name} sizes="90vw" loading="eager" className="block h-auto w-full max-w-none"
            onLoad={() => setOriginalLoaded(true)} onError={() => { setOriginalLoaded(false); setError('原图无法显示，请重试'); }} /></div>}
        </div>
      </DialogContent>
    </Dialog>
  </article>;
}

export function MatchedMaterials({ jobId, source = 'diagnosis', onEvidenceChange }: {
  jobId: string; source?: 'diagnosis' | 'learning'; onEvidenceChange?: (text: string) => void;
}) {
  const [data, setData] = useState<MaterialMatchesResult | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [availableImages, setAvailableImages] = useState<Set<string>>(() => new Set());
  const imageAvailability = useCallback((id: string, ready: boolean) => {
    setAvailableImages((previous) => {
      if (previous.has(id) === ready) return previous;
      const next = new Set(previous); if (ready) next.add(id); else next.delete(id); return next;
    });
  }, []);
  const history = materialHistoryText(data?.status === 'ready' ? data.items : [], availableImages);
  useEffect(() => { onEvidenceChange?.(history); }, [history, onEvidenceChange]);
  useEffect(() => () => onEvidenceChange?.(''), [onEvidenceChange]);
  useEffect(() => {
    let active = true; setData(null); setError('');
    const fetchMatches = source === 'learning' ? api.fetchLearningMaterials : api.fetchMaterials;
    fetchMatches(jobId).then(result => { if (active) setData(result); })
      .catch((e: unknown) => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [jobId, source, attempt]);
  return <section className="min-w-0 border-t pt-4" aria-label="相关中高考长图">
    <h3 className="text-sm font-semibold">相关中高考长图</h3>
    {!data && !error && <p role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在匹配长图...</p>}
    {(error || data?.note) && <p role="status" className="py-2 text-sm text-muted-foreground">{error || data?.note}</p>}
    {(error || data?.status === 'unavailable') && <Button variant="ghost" size="icon" title="重试长图匹配" aria-label="重试长图匹配" onClick={() => setAttempt(value => value + 1)}><RefreshCw className="h-4 w-4" /></Button>}
    <div className="divide-y">{data?.items.map(item => <MaterialItem key={item.materialId} item={item} onAvailabilityChange={imageAvailability} />)}</div>
    {Boolean(data?.items.length) && <p className="text-xs leading-5 text-muted-foreground">历史考试相关物料；知识点相关不代表本次题目已被押中。</p>}
  </section>;
}
