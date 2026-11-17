import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './stores/sessionStore';
import { AppShell } from './components/AppShell';
import { DialogHost, Toasts } from './components/feedback';
import { PwaUpdater } from './components/PwaUpdater';
import { Splash, SplashScreen } from './features/splash/Splash';
import { AuthPage } from './features/auth/AuthPage';
import { HomePage } from './features/home/HomePage';
import { DocumentListPage } from './features/documents/DocumentListPage';
import { DocumentDetailPage } from './features/document-detail/DocumentDetailPage';
import { NotFound } from './features/splash/NotFound';

const CaptureFlow = lazy(() => import('./features/capture/CaptureFlow'));
const RecropPage = lazy(() => import('./features/crop/RecropPage'));
const EntryEditorPage = lazy(() => import('./features/review/EntryEditorPage'));
const TemplateEditorPage = lazy(() => import('./features/template-editor/TemplateEditorPage'));
const TemplateListPage = lazy(() => import('./features/template-editor/TemplateListPage'));
const ExportPage = lazy(() => import('./features/export/ExportPage'));
const PrintPage = lazy(() => import('./features/export/PrintPage'));
const ViewerPage = lazy(() => import('./features/viewer/ViewerPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
const AccountPage = lazy(() => import('./features/settings/AccountPage'));
const OnboardingPage = lazy(() => import('./features/onboarding/OnboardingPage'));

function RequireAuth() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <SplashScreen />;
  if (status === 'signedIn') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }
  return children;
}

export function App() {
  return (
    <>
      <Suspense fallback={<SplashScreen />}>
        <Routes>
          <Route path="/" element={<Splash />} />
          <Route
            path="/login"
            element={
              <PublicOnly>
                <AuthPage />
              </PublicOnly>
            }
          />
          <Route element={<RequireAuth />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route element={<AppShell />}>
              <Route path="/home" element={<HomePage />} />
              <Route path="/documents" element={<DocumentListPage />} />
              <Route path="/templates" element={<TemplateListPage />} />
              <Route path="/templates/:templateId" element={<TemplateEditorPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/d/:docId" element={<DocumentDetailPage />} />
              <Route path="/d/:docId/template" element={<TemplateEditorPage />} />
              <Route path="/d/:docId/export" element={<ExportPage />} />
              <Route path="/d/:docId/e/:entryId" element={<EntryEditorPage />} />
            </Route>
            <Route path="/d/:docId/capture" element={<CaptureFlow />} />
            <Route path="/d/:docId/e/:entryId/crop" element={<RecropPage />} />
            <Route path="/d/:docId/view/:entryId" element={<ViewerPage />} />
            <Route path="/d/:docId/print" element={<PrintPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toasts />
      <DialogHost />
      <PwaUpdater />
    </>
  );
}
