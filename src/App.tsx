import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CandidateFormPage } from './pages/CandidateFormPage';
import { SettingsPage } from './pages/SettingsPage';
import { OfferPage } from './pages/OfferPage';
import { ContractPage } from './pages/ContractPage';
import { OfferTemplatesPage } from './pages/OfferTemplatesPage';
import { ContractTemplatesPage } from './pages/ContractTemplatesPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { GmailCallbackPage } from './pages/GmailCallbackPage';

function PrivateRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public: candidate document form */}
        <Route path="/form/:token" element={<CandidateFormPage />} />

        {/* Public: candidate offer letter & signature */}
        <Route path="/offer/:token" element={<OfferPage />} />

        {/* Public: candidate contract signing */}
        <Route path="/contract/:token" element={<ContractPage />} />

        {/* Gmail OAuth callback — redirects to /settings with status */}
        <Route path="/gmail/callback" element={<GmailCallbackPage />} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />

        {/* Private: recruiter dashboard */}
        <Route
          path="/"
          element={
            <PrivateRoute>
              <DashboardPage />
            </PrivateRoute>
          }
        />

        {/* Private: settings */}
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <SettingsPage />
            </PrivateRoute>
          }
        />

        {/* Private: offer letter templates */}
        <Route
          path="/offer-templates"
          element={
            <PrivateRoute>
              <OfferTemplatesPage />
            </PrivateRoute>
          }
        />

        {/* Private: documents */}
        <Route
          path="/documents"
          element={
            <PrivateRoute>
              <DocumentsPage />
            </PrivateRoute>
          }
        />

        {/* Private: contract templates */}
        <Route
          path="/contract-templates"
          element={
            <PrivateRoute>
              <ContractTemplatesPage />
            </PrivateRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
