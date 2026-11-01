import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { t } from '../lib/i18n'

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted">{t('Loading...')}</div>;
  }

  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
