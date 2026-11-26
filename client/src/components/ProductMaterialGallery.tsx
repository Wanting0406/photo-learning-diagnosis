import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, Eye, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Image } from '@/components/ui/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ProductMaterialMatch, ProductMaterialPreview } from '@shared/api.interface';
import { materialSelectionHtml, materialSelectionText } from '@shared/diagnosis-presentation';
import { copyMaterialSelection } from './material-clipboard';
import * as api from '@/api/diagnosis-gateway';
import { Image as UIImage } from '@client/src/components/ui/image';

interface Props { jobId: string; source: 'learning' | 'exam'; onPreview: (blob: Blob, name: string) => void }
type Asset = ProductMaterialPreview & { blob: Blob; originalImageDataUrl: string };
const PAGE_SIZE = 6;

export function ProductMaterialGallery({ jobId, source, onPreview }: Props) {
  const [items, setItems] = useState<ProductMaterialMatch[]>([]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [retry, setRetry] = useState(0);
  const [copyFallback, setCopyFallback] = useState<ProductMaterialPreview[]>([]);
  const copyContent = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, Asset>());
  const pending = useRef(new Map<string, Promise<Asset>>());
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true; setLoading(true);
    void api.fetchProductMaterials(jobId, source).then(result => {
      if (!current) return;
      setItems(result.items); setNote(result.note); setPage(0);
      setSelected(previous => previous.filter(id => result.items.some(item => item.materialId === id)));
    }).catch(() => { if (current) setNote('物料暂时无法读取，请重试。'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [jobId, source, retry]);
  const visible = useMemo(() => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [items, page]);
  const chosen = items.filter(item => selected.includes(item.materialId));
  const load = (item: ProductMaterialMatch): Promise<Asset> => {
    const id = item.materialId;
    const cached = cache.current.get(id); if (cached) return Promise.resolve(cached);
    const existing = pending.current.get(id); if (existing) return existing;
    const task = (async () => {
      const blob = await api.fetchProductMaterialImage(jobId, id, source);
      const bitmap = await createImageBitmap(blob);
      let imageDataUrl: string;
      try {
        const canvas = document.createElement('canvas'); canvas.width = Math.min(bitmap.width, 900);
        canvas.height = Math.round(bitmap.height * canvas.width / bitmap.width);
        const context = canvas.getContext('2d'); if (!context) throw new Error('图片读取失败');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
      } finally { bitmap.close(); }
      if (!/^image\/(png|jpeg|webp)$/u.test(blob.type)) throw new Error('当前物料图片格式不支持图文复制。');
      const originalImageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('原图读取失败'));
        reader.onerror = () => reject(new Error('原图读取失败')); reader.readAsDataURL(blob);
      });
      const asset = { ...item, blob, imageDataUrl, originalImageDataUrl }; cache.current.set(id, asset);
      if (active.current) {
        setAssets(previous => ({ ...previous, [id]: asset }));
        setFailures(previous => ({ ...previous, [id]: '' }));
      }
      return asset;
    })().catch(error => {
      if (active.current) setFailures(previous => ({ ...previous, [id]: '图片读取失败' }));
      throw error;
    }).finally(() => { pending.current.delete(id); });
    pending.current.set(id, task); return task;
  };
  useEffect(() => {
    let current = true;
    void (async () => {
      for (let i = 0; i < visible.length && current; i += 3) {
        await Promise.allSettled(visible.slice(i, i + 3).map(load));
      }
    })();
    return () => { current = false; };
    // Only the displayed page starts image reads; the task-scoped cache coalesces repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，请重试。'); }
    finally { if (active.current) setBusy(false); }
  };
  const copyMaterials = (selection: ProductMaterialMatch[] = chosen, previewOnly = false) => run(async () => {
    if (!selection.length) return;
    if (selection.length > 6) throw new Error('每次最多复制6张物料，请减少勾选后分批复制。');
    const ready = selection.every(item => cache.current.has(item.materialId));
    const prepared = ready ? selection.map(item => ({ ...item,
      imageDataUrl: cache.current.get(item.materialId)!.originalImageDataUrl })) : undefined;
    // Supply ready Blobs within the click gesture, including in embedded WebKit browsers.
    let clipboardWrite: Promise<void> | undefined;
    if (!previewOnly && prepared && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      try {
        clipboardWrite = navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([materialSelectionHtml(prepared)], { type: 'text/html' }),
          'text/plain': new Blob([materialSelectionText(prepared)], { type: 'text/plain' }),
        })]);
        void clipboardWrite.catch(() => undefined);
      } catch { /* Use native selection copying below. */ }
    }
    const copiedSynchronously = !previewOnly && prepared && !clipboardWrite ? copyMaterialSelection(prepared) : false;
    const content = (async () => {
      if (prepared) return prepared;
      const loaded: ProductMaterialPreview[] = [];
      for (let i = 0; i < selection.length; i += 3) {
        loaded.push(...await Promise.all(selection.slice(i, i + 3).map(async item => {
          const asset = await load(item);
          return { ...item, imageDataUrl: asset.originalImageDataUrl };
        })));
      }
      return loaded;
    })();
    const html = content.then(loaded => new Blob([materialSelectionHtml(loaded)], { type: 'text/html' }));
    void html.catch(() => undefined);
    if (previewOnly) { setCopyFallback(await content); return; }
    if (!prepared) { await content; setMessage('物料已加载，请再次点击复制图文。'); return; }
    // Prefer the same HTML fragment as a native text-and-image selection.
    try {
      const loaded = await content;
      if (clipboardWrite) await clipboardWrite;
      else if (!copiedSynchronously && !copyMaterialSelection(loaded)) {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Unsupported clipboard');
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': html,
          'text/plain': new Blob([materialSelectionText(selection)], { type: 'text/plain' }) })]);
      }
      let canVerify = false;
      try { canVerify = (await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })).state === 'granted'; }
      catch { /* Clipboard permission queries are not supported by every browser. */ }
      if (canVerify) {
        const copied = (await navigator.clipboard.readText()).replace(/\s/gu, '');
        if (!selection.every(item => copied.includes(materialSelectionText([item]).replace(/\s/gu, '')))) {
          throw new Error('Clipboard did not update');
        }
      }
      setMessage('已复制文字和原图，可粘贴到支持图文的编辑器。');
    } catch {
      setCopyFallback(await content);
      setMessage('自动复制未完成，可在打开的图文中全选后复制。');
    }
  });
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  return <section className="material-gallery" aria-label="产品宣传物料">
    <div className="diagnosis-section-heading"><h3>产品宣传物料 <span className="material-count">{items.length}</span></h3>
      <Button variant="ghost" size="icon" title="刷新物料" disabled={loading || busy} onClick={() => setRetry(n => n + 1)}><RefreshCw className="size-4" /></Button></div>
    <div className="diagnosis-share-toolbar">
      <Button variant="ghost" size="sm" disabled={!visible.length || busy} onClick={() => setSelected(previous => [...new Set([...previous, ...visible.map(m => m.materialId)])])}>选择本页</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected([])}>清空</Button>
      <span className="material-count">已选 {chosen.length}</span>
      <Button variant="outline" size="sm" disabled={!chosen.length || busy} onClick={() => void copyMaterials()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}复制所选图文</Button>
      <Button variant="ghost" size="icon" title="查看所选图文" disabled={!chosen.length || busy} onClick={() => void copyMaterials(chosen, true)}><Eye className="size-4" /></Button>
    </div>
    {message && <p role="status">{message}</p>}{note && <p role="status">{note}</p>}
    {loading && <p role="status">正在读取物料…</p>}
    <div className="material-grid">{visible.map(item => {
      const asset = assets[item.materialId];
      return <article className="material-item" key={item.materialId}>
        <label className="diagnosis-choice"><Checkbox checked={selected.includes(item.materialId)}
          onCheckedChange={() => setSelected(previous => previous.includes(item.materialId) ? previous.filter(id => id !== item.materialId) : [...previous, item.materialId])}
          aria-label={`选择物料${item.name}`} />{item.name}</label>
        <span className="material-scope">{item.recommendation === 'recommended' ? '与本次推荐相关' : '同学段学科备选'}</span>
        <div className="material-thumbnail">{asset ? <button type="button" title="查看完整原图" onClick={() => onPreview(asset.blob, item.name)}><Image src={asset.imageDataUrl} alt={item.name} sizes="400px" className="h-full w-full object-contain" /></button>
          : failures[item.materialId] ? <Button variant="ghost" onClick={() => void run(async () => { await load(item); })}><RefreshCw className="size-4" />重试图片</Button>
            : <Loader2 className="size-5 animate-spin" aria-label="图片加载中" />}</div>
        <p>{item.introduction || item.summary}</p>
        {item.boundary && <details><summary>适用说明</summary><p>{item.boundary}</p></details>}
        <div className="material-actions"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void copyMaterials([item])}><Copy className="size-4" />复制图文</Button>
          <Button size="icon" variant="ghost" title="查看整图" disabled={!asset} onClick={() => asset && onPreview(asset.blob, item.name)}><Eye className="size-4" /></Button>
          <Button size="icon" variant="ghost" title="下载原图" disabled={!asset} onClick={() => asset && api.download(asset.blob, `${item.name.replace(/[\\/:*?"<>|\r\n]/gu, '_')}.${asset.blob.type.split('/')[1] || 'png'}`)}><Download className="size-4" /></Button></div>
      </article>;
    })}</div>
    {items.length > 0 && <nav className="material-pagination" aria-label="物料分页"><Button variant="outline" size="icon" title="上一页" disabled={page === 0 || busy} onClick={() => setPage(p => p - 1)}><ChevronLeft className="size-4" /></Button>
      <span>{page + 1} / {pages}</span><Button variant="outline" size="icon" title="下一页" disabled={page + 1 >= pages || busy} onClick={() => setPage(p => p + 1)}><ChevronRight className="size-4" /></Button></nav>}
    {copyFallback.length > 0 && <Dialog open onOpenChange={open => { if (!open) setCopyFallback([]); }}>
      <DialogContent className="max-w-3xl" aria-describedby={undefined}><DialogHeader><DialogTitle>所选图文</DialogTitle></DialogHeader>
        <Button variant="outline" onClick={() => {
          if (!copyContent.current) return;
          const range = document.createRange(); range.selectNodeContents(copyContent.current);
          const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
        }}>全选图文</Button>
        <div ref={copyContent} className="max-h-[65vh] overflow-auto select-text">{copyFallback.map(item => <section key={item.materialId}>
          <p>{item.introduction || item.summary}</p><UIImage src={item.imageDataUrl} alt="课程介绍" className="h-auto max-w-full" />
        </section>)}</div>
      </DialogContent>
    </Dialog>}
  </section>;
}
