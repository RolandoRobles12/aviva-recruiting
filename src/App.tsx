import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './hooks/useAuth';
import type { PermissionKey } from './types/permissions';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CandidateFormPage } from './pages/CandidateFormPage';
import { SettingsPage } from './pages/SettingsPage';
import { OfferPage } from './pages/OfferPage';
import { ContractPage } from './pages/ContractPage';
import { OfferTemplatesPage } from './pages/OfferTemplatesPage';
import { ContractTemplatesPage } from './pages/ContractTemplatesPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { OperationsDashboardPage } from './pages/OperationsDashboardPage';
import { GmailCallbackPage } from './pages/GmailCallbackPage';
import { EmailTemplatesPage } from './pages/EmailTemplatesPage';
import { FormConfigPage } from './pages/FormConfigPage';
import { RolesPage } from './pages/RolesPage';
import { PsychometricTestsPage } from './pages/PsychometricTestsPage';
import { TakePsychometricTestPage } from './pages/TakePsychometricTestPage';

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/** Redirects to /login if unauthenticated */
function PrivateRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? children : <Navigate to="/login" replace />;
}

/** Redirects to / if authenticated but lacks the required permission */
function PermissionRoute({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactElement;
}) {
  const { user, loading, can } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!can(permission)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public: candidate flows (token-protected) ── */}
        <Route path="/form/:token"     element={<CandidateFormPage />} />
        <Route path="/offer/:token"    element={<OfferPage />} />
        <Route path="/contract/:token" element={<ContractPage />} />
        <Route path="/prueba-psicometrica/:token" element={<TakePsychometricTestPage />} />
        <Route path="/gmail/callback"  element={<GmailCallbackPage />} />
        <Route path="/login"           element={<LoginPage />} />

        {/* ── Dashboard (requires being logged in) ── */}
        <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />

        {/* ── Operations report (requires reports_view permission) ── */}
        <Route
          path="/dashboard"
          element={
            <PermissionRoute permission="reports_view">
              <OperationsDashboardPage />
            </PermissionRoute>
          }
        />

        {/* ── Documents / Expedientes ── */}
        <Route
          path="/documents"
          element={<PrivateRoute><DocumentsPage /></PrivateRoute>}
        />

        {/* ── Templates (requires config_templates permission) ── */}
        <Route
          path="/offer-templates"
          element={
            <PermissionRoute permission="config_templates">
              <OfferTemplatesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/contract-templates"
          element={
            <PermissionRoute permission="config_templates">
              <ContractTemplatesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/email-templates"
          element={
            <PermissionRoute permission="config_templates">
              <EmailTemplatesPage />
            </PermissionRoute>
          }
        />

        {/* ── Form config (requires config_form) ── */}
        <Route
          path="/form-config"
          element={
            <PermissionRoute permission="config_form">
              <FormConfigPage />
            </PermissionRoute>
          }
        />

        {/* ── Psychometric tests (requires psychometric_sessions) ── */}
        <Route
          path="/psychometric-tests"
          element={
            <PermissionRoute permission="psychometric_sessions">
              <PsychometricTestsPage />
            </PermissionRoute>
          }
        />

        {/* ── Settings (requires config_settings) ── */}
        <Route
          path="/settings"
          element={
            <PermissionRoute permission="config_settings">
              <SettingsPage />
            </PermissionRoute>
          }
        />

        {/* ── Roles & Permissions (requires admin_manage_roles) ── */}
        <Route
          path="/roles"
          element={
            <PermissionRoute permission="admin_manage_roles">
              <RolesPage />
            </PermissionRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
