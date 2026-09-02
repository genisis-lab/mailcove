import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from './components/ui';
import { AppStateProvider } from './lib/app-state';
import { authClient } from './lib/auth-client';
import { useConfig } from './lib/queries';
import { LoginPage, TwoFactorPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';

const MailApp = lazy(() => import('./pages/MailApp').then((m) => ({ default: m.MailApp })));

function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

export function App() {
  const config = useConfig();
  const session = authClient.useSession();
  const location = useLocation();

  useEffect(() => {
    if (config.data?.appName) document.title = config.data.appName;
    if (config.data?.accentColor) document.documentElement.style.setProperty('--accent', config.data.accentColor);
  }, [config.data]);

  if (config.isLoading || session.isPending) return <FullPageSpinner />;

  const needsSetup = config.data?.needsSetup ?? false;
  const authenticated = Boolean(session.data?.user);

  if (needsSetup && !config.data?.hasUsers && !location.pathname.startsWith('/setup')) return <Navigate to="/setup" replace />;

  return (
    <AppStateProvider authenticated={authenticated}>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="/setup/*" element={<SetupPage authenticated={authenticated} />} />
          <Route path="/login" element={authenticated ? <Navigate to="/mail/inbox" replace /> : <LoginPage />} />
          <Route path="/login/2fa" element={authenticated ? <Navigate to="/mail/inbox" replace /> : <TwoFactorPage />} />
          <Route path="/*" element={authenticated ? <MailApp /> : <Navigate to="/login" replace state={{ from: location.pathname }} />} />
        </Routes>
      </Suspense>
    </AppStateProvider>
  );
}
