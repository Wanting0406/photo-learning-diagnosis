import { useCallback, useEffect, useState } from 'react';
import { Download, Image, Loader2, PlugZap, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as api from '@/api/diagnosis-gateway';
import AdminMembersPanel from './AdminMembersPanel';
import type { RecordsResult, AdminConfig, AdminPhotos } from '@shared/api.interface';
import { Image as UIImage } from '@client/src/components/ui/image';

function Photo({ token, name }: { token: string; name: string }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const next = URL.createObjectURL(blob); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  const open = async () => {
    setBusy(true); setError('');
    try { setBlob(await api.fetchPhoto(token, name)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : '照片读取失败'); }
    finally { setBusy(false); }
  };
  return <div className="min-w-0 space-y-2">
    <div className="flex items-center gap-2">
      <Button variant="outline" disabled={busy} onClick={open} className="min-w-0 max-w-full">
        {busy ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <Image className="mr-2 h-4 w-4 shrink-0" />}
        <span className="truncate">{name || '查看照片'}</span>
      </Button>
      {blob && <>
        <Button variant="ghost" size="icon" title="下载照片" aria-label="下载照片" onClick={() => api.download(blob, name || 'photo.jpg')}><Download className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" title="收起照片" aria-label="收起照片" onClick={() => setBlob(null)}><X className="h-4 w-4" /></Button>
      </>}
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {url && <UIImage src={url} alt={name || '卷面照片'} className="max-h-[40rem] w-full border object-contain" />}
  </div>;
}

export default function AdminHome() {
  const [view, setView] = useState('records');
  const [records, setRecords] = useState<RecordsResult | null>(null);
  const [photos, setPhotos] = useState<AdminPhotos | null>(null);
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('');
  const load = useCallback(async (pageToken = '') => {
    setBusy(true); setError('');
    try {
      if (view === 'records') {
        const next = await api.fetchRecords(pageToken);
        setRecords((previous) => pageToken && previous ? { ...next, items: [...previous.items, ...next.items] } : next);
      } else if (view === 'photos') {
        const next = await api.fetchPhotos(pageToken);
        setPhotos((previous) => pageToken && previous ? { ...next, items: [...previous.items, ...next.items] } : next);
      } else if (view === 'config') setConfig(await api.fetchConfig());
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setBusy(false); }
  }, [view]);
  useEffect(() => { void load(); }, [load]);
  const testConnection = async () => {
    setBusy(true); setError(''); setConnection('');
    try { setConnection((await api.testFeishu()).msg); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : '连接失败'); }
    finally { setBusy(false); }
  };
  const pageToken = view === 'records' ? records?.pageToken : view === 'photos' ? photos?.pageToken : '';
  return <section className="space-y-5">
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">管理区</h1>
      <Button size="icon" variant="outline" disabled={busy} title="刷新" aria-label="刷新"
        onClick={() => load()}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></Button>
    </div>
    <Tabs value={view} onValueChange={setView}>
      <TabsList className="grid w-full grid-cols-4 sm:w-96">
        <TabsTrigger disabled={busy} value="records">诊断记录</TabsTrigger>
        <TabsTrigger disabled={busy} value="photos">卷面照片</TabsTrigger>
        <TabsTrigger disabled={busy} value="config">服务配置</TabsTrigger>
        <TabsTrigger disabled={busy} value="members">管理员</TabsTrigger>
      </TabsList>
    </Tabs>
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {view === 'records' && <div className="divide-y border-y">
      {records?.items.map((record) => <details key={record.recordId} className="py-4">
        <summary className="cursor-pointer break-words text-sm font-medium">{String(record.fields['学生姓名'] || record.recordId)}
          <span className="ml-3 text-muted-foreground">{String(record.fields['年级'] || '')}</span></summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
          {Object.entries(record.fields).map(([key, value]) => <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}</dd>
          </div>)}
        </dl>
      </details>)}
      {!busy && records?.items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">暂无诊断记录</p>}
    </div>}
    {view === 'photos' && <div className="divide-y border-y">
      {photos?.items.map((record) => <article key={record.recordId} className="space-y-3 py-4">
        <h2 className="break-words text-sm font-semibold">{record.studentName} <span className="ml-2 font-normal text-muted-foreground">{record.grade}</span></h2>
        <p className="break-words text-sm text-muted-foreground">{record.summary}</p>
        <div className="grid gap-4 md:grid-cols-2">{record.photos.map((photo) => <Photo key={photo.token} {...photo} />)}</div>
        {record.photos.length === 0 && <p className="text-sm text-muted-foreground">无照片附件</p>}
      </article>)}
      {!busy && photos?.items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">暂无卷面照片</p>}
    </div>}
    {view === 'config' && <div className="space-y-5">
      <dl className="divide-y border-y text-sm">{config?.fields.map((field) => <div key={field.key} className="grid gap-2 py-3 sm:grid-cols-[15rem_minmax(0,1fr)]">
        <dt className="break-words text-muted-foreground">{field.label}</dt><dd className="break-all">{String(field.value)}</dd>
      </div>)}</dl>
      <Button variant="outline" disabled={busy} onClick={testConnection}><PlugZap className="mr-2 h-4 w-4" />检查飞书连接</Button>
      {connection && <p role="status" className="text-sm text-emerald-700">{connection}</p>}
    </div>}
    {view === 'members' && <AdminMembersPanel />}
    {busy && view !== 'members' && <p role="status" className="text-sm text-muted-foreground">正在读取</p>}
    {pageToken && <Button variant="outline" disabled={busy} onClick={() => load(pageToken)}>加载更多</Button>}
  </section>;
}
