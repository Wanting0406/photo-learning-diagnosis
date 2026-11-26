import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

const AccessDeniedPage = () => {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <ShieldAlert className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-semibold">无访问权限</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        当前账号没有访问该功能的权限。如需管理员权限，请联系系统管理员在角色面板中为账号分配对应角色。
      </p>
      <Button asChild data-ai-section-type="button">
        <Link to="/">返回应用首页</Link>
      </Button>
    </div>
  );
};

export default AccessDeniedPage;
