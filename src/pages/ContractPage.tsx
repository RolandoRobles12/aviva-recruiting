import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import SignaturePad from 'signature_pad';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL ?? '';

interface ContractData {
  candidateName: string;
  position: string;
  salary: string;
  startDate: string;
  bodyHtml: string;
  expiresAt?: string;
}

type PageState = 'loading' | 'ready' | 'signed' | 'expired' | 'already_signed' | 'error';

export function ContractPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>('loading');
  const [contract, setContract] = useState<ContractData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [signatureEmpty, setSignatureEmpty] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  // Load contract data
  useEffect(() => {
    if (!token) { setState('error'); return; }
    fetch(`${API_BASE}/getContract?token=${encodeURIComponent(token)}`)
      .then(async (resp) => {
        if (resp.status === 409) { setState('already_signed'); return; }
        if (resp.status === 410) { setState('expired'); return; }
        if (!resp.ok) { setState('error'); return; }
        const json = await resp.json();
        setContract(json.contract);
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
      const resp = await fetch(`${API_BASE}/signContract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, signatureBase64 }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? 'Error desconocido');
      setPdfUrl(json.pdfUrl ?? null);
      setEvidenceUrl(json.evidenceUrl ?? null);
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
          <h1 className="text-xl font-bold text-gray-900 mb-2">¡Contrato firmado!</h1>
          <p className="text-gray-500 text-sm mb-6">
            Tu contrato ha sido firmado exitosamente. Se generó un certificado de firma electrónica
            como evidencia criptográfica de tu firma.
          </p>
          <div className="space-y-3">
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-sm text-primary-600 font-medium hover:underline"
              >
                Descargar contrato firmado (PDF)
              </a>
            )}
            {evidenceUrl && (
              <a
                href={evidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-sm text-blue-600 font-medium hover:underline"
              >
                Descargar certificado de firma (PDF)
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (state === 'already_signed') {
    return <TerminalCard icon="check" title="Contrato ya firmado" message="Tu contrato ya fue firmado. Revisa tu correo para los siguientes pasos." />;
  }

  if (state === 'expired') {
    return <TerminalCard icon="clock" title="Enlace expirado" message="Este enlace ya no es válido. Contacta a tu reclutador para recibir uno nuevo." />;
  }

  if (state === 'error') {
    return <TerminalCard icon="x" title="Enlace no encontrado" message="No pudimos encontrar tu contrato. Verifica el enlace o contacta a tu reclutador." />;
  }

  // ── Main contract view ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-primary-600 rounded-2xl p-8 text-white">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-4">
            <span className="font-bold text-lg">A</span>
          </div>
          <h1 className="text-2xl font-bold">Contrato de Trabajo</h1>
          <p className="text-white/80 text-sm mt-1">{contract?.position}</p>
        </div>

        {/* Key details */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Candidato</p>
              <p className="text-gray-900 font-semibold">{contract?.candidateName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Puesto</p>
              <p className="text-gray-900 font-semibold">{contract?.position}</p>
            </div>
            {contract?.salary && (
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Salario</p>
                <p className="text-gray-900 font-semibold">{contract.salary}</p>
              </div>
            )}
            {contract?.startDate && (
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Fecha de inicio</p>
                <p className="text-gray-900 font-semibold">{contract.startDate}</p>
              </div>
            )}
          </div>
        </div>

        {/* Body content */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Contrato</h2>
          <div
            className="prose prose-sm max-w-none text-gray-600"
            dangerouslySetInnerHTML={{ __html: contract?.bodyHtml ?? '' }}
          />
        </div>

        {/* FES info */}
        <div className="bg-blue-50 rounded-2xl border border-blue-100 p-5">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Firma Electrónica Simple (FES)</h3>
          <p className="text-xs text-blue-700 leading-relaxed">
            Al firmar este contrato, se generará evidencia criptográfica que incluye: hash SHA-256 del documento,
            tu dirección IP, fecha y hora exacta, y un certificado de firma. Esta firma tiene validez legal
            conforme a los artículos 89 a 94 del Código de Comercio de México y el artículo 1834 bis del
            Código Civil Federal.
          </p>
        </div>

        {/* Signature */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Firma digital</h2>
          <p className="text-xs text-gray-400 mb-4">
            Dibuja tu firma en el recuadro de abajo para firmar este contrato de trabajo.
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
                Procesando firma...
              </>
            ) : (
              'Firmo este contrato de trabajo'
            )}
          </button>

          <p className="text-xs text-gray-400 text-center mt-3">
            Al firmar, confirmas que has leído y aceptas los términos de este contrato de trabajo.
            Se generará un certificado de evidencia criptográfica de tu firma.
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
