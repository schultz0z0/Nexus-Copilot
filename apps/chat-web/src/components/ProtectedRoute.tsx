import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireManager?: boolean;
}

export const ProtectedRoute = ({ children, requireAdmin = false, requireManager = false }: ProtectedRouteProps) => {
  const { user, loading, isAdmin, canManageValidatedWorks } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-brand-primary animate-bounce" />
          <div className="w-3 h-3 rounded-full bg-brand-primary animate-bounce delay-75" />
          <div className="w-3 h-3 rounded-full bg-brand-primary animate-bounce delay-150" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (requireManager && !canManageValidatedWorks) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
