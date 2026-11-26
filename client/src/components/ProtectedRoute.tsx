import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, ROLE_SUBJECT } from '@lark-apaas/client-toolkit/auth';

interface ProtectedRouteProps {
  requiredRoles: string[];
  children: ReactNode;
}

export const ProtectedRoute = ({ requiredRoles, children }: ProtectedRouteProps) => {
  const { ability, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
        正在校验访问权限...
      </div>
    );
  }

  const hasPermission: boolean = requiredRoles.length === 0 || requiredRoles.some((role: string) =>
    ability.can(role, ROLE_SUBJECT),
  );
  if (!hasPermission) {
    return <Navigate to="/access-denied" replace />;
  }
  return <>{children}</>;
};
