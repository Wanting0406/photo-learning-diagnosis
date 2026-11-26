import { NavLink, Outlet } from 'react-router-dom';
import { Camera, ShieldCheck, ClipboardCheck, ChartNoAxesCombined } from 'lucide-react';
import { CanRole } from '@lark-apaas/client-toolkit/auth';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import './workspace.css';

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `workspace-nav-link${isActive ? ' is-active' : ''}`;
export const Layout = () => {
  const user = useCurrentUserProfile();
  return <div className="workspace-shell min-h-dvh bg-background text-foreground">
    <header className="workspace-header">
      <div className="workspace-header-inner">
        <NavLink to="/" className="workspace-brand" aria-label="拍照学情诊断">
          <span className="workspace-brand-icon"><Camera aria-hidden="true" /></span>
          <span><strong>拍照学情诊断</strong><small>洋葱学园</small></span>
        </NavLink>
        <span className="workspace-user">{user.name || '洋葱学园'}</span>
        <nav aria-label="应用模块" className="workspace-nav">
          <NavLink to="/" end className={navClass}><ClipboardCheck aria-hidden="true" />试卷/作业分析</NavLink>
          <NavLink to="/onion-learning" className={navClass}><ChartNoAxesCombined aria-hidden="true" />洋葱学习情况分析</NavLink>
          <CanRole roles={['admin']} fallback={null}>
            <NavLink to="/admin" className={navClass}><ShieldCheck className="h-4 w-4 shrink-0" /><span>管理区</span></NavLink>
          </CanRole>
        </nav>
      </div>
    </header>
    <main className="workspace-main"><Outlet /></main>
  </div>;
};
