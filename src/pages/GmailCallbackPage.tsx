import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * Handles the OAuth callback redirect from Google.
 * The Cloud Function gmailOAuthCallback redirects here with ?gmail=success or ?gmail=error.
 * This page simply redirects to /settings preserving the query params.
 */
export function GmailCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const gmail = searchParams.get('gmail');
    const reason = searchParams.get('reason');
    const query = gmail ? `?gmail=${gmail}${reason ? `&reason=${reason}` : ''}` : '';
    navigate(`/settings${query}`, { replace: true });
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
