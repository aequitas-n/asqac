import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, Link } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { DataProvider } from './hooks/useData';
import { Brand, Empty, Skeleton } from './components/ui';
import Shell from './components/layout/Shell';
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Capsules = lazy(() => import('./pages/Capsules'));
const CapsuleDetail = lazy(() => import('./pages/CapsuleDetail'));
const Register = lazy(() => import('./pages/Register'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Reports = lazy(() => import('./pages/Reports'));
const Hardware = lazy(() => import('./pages/Hardware'));
const Setup = lazy(() => import('./pages/Setup'));
const TransportReport = lazy(() => import('./pages/TransportReport'));
function RequireAuth() {
  const { user, profile, preview, loading, error, signOut } = useAuth();
  if (loading)
    return (
      <div className="boot-screen">
        <Brand />
        <Skeleton />
      </div>
    );
  if (!user && !preview) return <Navigate to="/login" replace />;
  if (user && !profile)
    return (
      <Empty
        title="Staff profile required"
        description={error ?? 'Ask your administrator to provision this account.'}
        action={
          <button className="button secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        }
      />
    );
  return <Outlet />;
}
function RequireTechnician() {
  const { profile, preview } = useAuth();
  return preview || profile?.role === 'technician' || profile?.role === 'admin' ? (
    <Outlet />
  ) : (
    <Navigate to="/dashboard" replace />
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <DataProvider>
            <Suspense
              fallback={
                <div className="boot-screen">
                  <Brand />
                  <Skeleton />
                </div>
              }
            >
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<RequireAuth />}>
                  <Route element={<Shell />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="capsules" element={<Capsules />} />
                    <Route path="capsules/:id" element={<CapsuleDetail />} />
                    <Route element={<RequireTechnician />}>
                      <Route path="register" element={<Register />} />
                    </Route>
                    <Route path="alerts" element={<Alerts />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="reports/:id" element={<TransportReport />} />
                    <Route path="hardware" element={<Hardware />} />
                    <Route path="setup" element={<Setup />} />
                    <Route
                      path="*"
                      element={
                        <Empty
                          title="This page is outside the care network"
                          description="Return to the overview to continue."
                          action={
                            <Link to="/dashboard" className="button primary">
                              Open overview
                            </Link>
                          }
                        />
                      }
                    />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
            <Toaster theme="light" position="bottom-right" closeButton />
          </DataProvider>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  );
}
