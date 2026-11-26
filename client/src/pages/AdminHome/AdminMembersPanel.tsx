import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import * as roleManager from '@/api/role-manager';
import type { AdminMemberUser } from '@shared/api.interface';

function MemberAvatar({ user }: { user: AdminMemberUser }) {
  const initial = user.name ? user.name.slice(0, 1) : '?';
  return (
    <Avatar className="h-8 w-8 shrink-0">
      {user.avatar ? <AvatarImage src={user.avatar} alt={user.name || '成员'} /> : null}
      <AvatarFallback className="text-xs">{initial}</AvatarFallback>
    </Avatar>
  );
}

export default function AdminMembersPanel() {
  const [members, setMembers] = useState<AdminMemberUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [results, setResults] = useState<AdminMemberUser[]>([]);
  const [selectedIDs, setSelectedIDs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [pendingRemove, setPendingRemove] = useState<AdminMemberUser | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    setError('');
    try {
      const result = await roleManager.fetchAdminMembers();
      setMembers(result.users);
      setTotal(result.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '读取管理员列表失败');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  const memberIDSet = new Set(members.map((member: AdminMemberUser) => member.userID));

  const runSearch = async () => {
    const keyword = query.trim();
    if (!keyword) return;
    setSearching(true);
    setError('');
    try {
      const result = await roleManager.searchUsers({ query: keyword });
      setResults(result.users);
      setSelectedIDs([]);
      setSearchDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const toggleSelect = (userID: string, checked: boolean) => {
    setSelectedIDs((previous) => checked
      ? [...previous, userID]
      : previous.filter((id: string) => id !== userID));
  };

  const saveSelected = async () => {
    if (selectedIDs.length === 0) return;
    setSaving(true);
    try {
      await roleManager.addAdminMembers({ userIDs: selectedIDs });
      toast.success(`已添加 ${selectedIDs.length} 位管理员`);
      setAddOpen(false);
      setQuery('');
      setResults([]);
      setSelectedIDs([]);
      setSearchDone(false);
      await load(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    try {
      await roleManager.removeAdminMembers({ userIDs: [pendingRemove.userID] });
      toast.success(`已移除管理员 ${pendingRemove.name || pendingRemove.userID}`);
      setPendingRemove(null);
      await load(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '移除失败');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          管理员可访问管理区并管理管理员成员，共 {total} 人。未分配角色的成员默认拥有销售权限。
        </p>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />添加管理员
        </Button>
      </div>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />正在读取管理员列表
        </p>
      ) : members.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">暂无管理员</p>
      ) : (
        <ul className="divide-y border-y">
          {members.map((member) => (
            <li key={member.userID} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <MemberAvatar user={member} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.name || '未命名成员'}</p>
                  <p className="truncate text-xs text-muted-foreground">ID: {member.userID}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPendingRemove(member)}>
                <Trash2 className="mr-1 h-4 w-4" />移除
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={(open: boolean) => {
        setAddOpen(open);
        if (!open) { setQuery(''); setResults([]); setSelectedIDs([]); setSearchDone(false); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加管理员</DialogTitle>
            <DialogDescription>搜索同事姓名，勾选后保存即可授予管理员权限。</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={query}
              placeholder="输入姓名搜索"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
            />
            <Button variant="outline" disabled={searching || !query.trim()} onClick={() => void runSearch()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {searchDone && results.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">未搜索到相关同事</p>
            )}
            <ul className="divide-y">
              {results.map((user) => {
                const alreadyAdmin = memberIDSet.has(user.userID);
                const selected = selectedIDs.includes(user.userID);
                return (
                  <li key={user.userID} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <MemberAvatar user={user} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{user.name || '未命名成员'}</p>
                        <p className="truncate text-xs text-muted-foreground">ID: {user.userID}</p>
                      </div>
                    </div>
                    {alreadyAdmin ? (
                      <span className="shrink-0 text-xs text-muted-foreground">已是管理员</span>
                    ) : (
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) => toggleSelect(user.userID, checked === true)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button disabled={selectedIDs.length === 0 || saving} onClick={() => void saveSelected()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存{selectedIDs.length > 0 ? `（${selectedIDs.length}）` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingRemove !== null} onOpenChange={(open: boolean) => { if (!open) setPendingRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除管理员</AlertDialogTitle>
            <AlertDialogDescription>
              确定移除 {pendingRemove?.name || pendingRemove?.userID} 的管理员权限吗？移除后该成员默认保留销售权限。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={removing} onClick={() => void confirmRemove()}>
              {removing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
