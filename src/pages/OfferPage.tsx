import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SignaturePad from 'signature_pad';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL ?? '';

interface OfferData {
  candidateName: string;
  position: string;
  salary: string;
  benefits: string;
  startDate: string;
  bodyHtml: string;
  expiresAt?: string;
}

type PageState = 'loading' | 'ready' | 'signed' | 'expired' | 'already_signed' | 'error';

export function OfferPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>('loading');
  const [offer, setOffer] = useState<OfferData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [signatureEmpty, setSignatureEmpty] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  // Load offer data
  useEffect(() => {
    if (!token) { setState('error'); return; }
    fetch(`${API_BASE}/getOffer?token=${encodeURIComponent(token)}`)
      .then(async (resp) => {
        if (resp.status === 409) { setState('already_signed'); return; }
        if (resp.status === 410) { setState('expired'); return; }
        if (!resp.ok) { setState('error'); return; }
        const json = await resp.json();
        setOffer(json.offer);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [token]);

  // Initialize signature pad once canvas is visible
  useEffect(() => {
    if (state !== 'ready' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const pad = new SignaturePad(canvas, { penColor: '#1e293b' });
    padRef.current = pad;
    pad.addEventListener('endStroke', () => setSignatureEmpty(pad.isEmpty()));

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      setSignatureEmpty(true);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [state]);

  const clearSignature = () => {
    padRef.current?.clear();
    setSignatureEmpty(true);
  };

  const handleSubmit = async () => {
    if (!token || !padRef.current || padRef.current.isEmpty()) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const signatureBase64 = padRef.current.toDataURL('image/png');
      const resp = await fetch(`${API_BASE}/signOffer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, signatureBase64 }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? 'Error desconocido');
      setPdfUrl(json.pdfUrl ?? null);
      setState('signed');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al enviar la firma. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Terminal states ──────────────────────────────────────────────────────────
  if (state === 'signed') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">¡Carta oferta firmada!</h1>
          <p className="text-gray-500 text-sm mb-6">
            Gracias por aceptar. En breve recibirás un correo con el enlace para subir tu documentación de ingreso.
          </p>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary-600 font-medium hover:underline"
            >
              Descargar carta oferta firmada (PDF)
            </a>
          )}
        </div>
      </div>
    );
  }

  if (state === 'already_signed') {
    return <TerminalCard icon="check" title="Ya firmaste tu carta oferta" message="Tu proceso de documentación está activo. Revisa tu correo para continuar." />;
  }

  if (state === 'expired') {
    return <TerminalCard icon="clock" title="Enlace expirado" message="Este enlace ya no es válido. Contacta a tu reclutador para recibir uno nuevo." />;
  }

  if (state === 'error') {
    return <TerminalCard icon="x" title="Enlace no encontrado" message="No pudimos encontrar tu carta oferta. Verifica el enlace o contacta a tu reclutador." />;
  }

  // ── Main offer view ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-primary-600 rounded-2xl p-8 text-white">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-4">
            <span className="font-bold text-lg">A</span>
          </div>
          <h1 className="text-2xl font-bold">Carta Oferta de Trabajo</h1>
          <p className="text-white/80 text-sm mt-1">{offer?.position}</p>
        </div>

        {/* Offer letter content */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div
            className="prose prose-sm max-w-none text-gray-600"
            dangerouslySetInnerHTML={{ __html: offer?.bodyHtml ?? '' }}
          />
        </div>

        {/* Signature */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Firma digital</h2>
          <p className="text-xs text-gray-400 mb-4">
            Dibuja tu firma en el recuadro de abajo para aceptar esta carta oferta.
          </p>
          <div className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-gray-50 relative" style={{ height: 160 }}>
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none cursor-crosshair" />
            {signatureEmpty && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-gray-300 text-sm select-none">Firma aquí</p>
              </div>
            )}
          </div>
          <button
            onClick={clearSignature}
            className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Borrar firma
          </button>

          {errorMsg && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || signatureEmpty}
            className="mt-6 w-full bg-primary-600 text-white font-semibold py-3 rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Procesando...
              </>
            ) : (
              'Acepto y firmo la carta oferta'
            )}
          </button>

          <p className="text-xs text-gray-400 text-center mt-3">
            Al firmar, confirmas que has leído y aceptas los términos de esta oferta de trabajo.
          </p>
        </div>
      </div>
    </div>
  );
}

function TerminalCard({ icon, title, message }: { icon: 'check' | 'clock' | 'x'; title: string; message: string }) {
  const icons = {
    check: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />,
    clock: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
    x: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />,
  };
  const colors = { check: 'bg-green-100 text-green-600', clock: 'bg-yellow-100 text-yellow-600', x: 'bg-red-100 text-red-600' };
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-md w-full text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${colors[icon]}`}>
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icons[icon]}</svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-500 text-sm">{message}</p>
      </div>
    </div>
  );
}
