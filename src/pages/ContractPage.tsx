import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import SignaturePad from 'signature_pad';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL ?? '';

function isFullHtmlDocument(html: string): boolean {
  const t = html.trimStart().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
}

interface ContractData {
  candidateName: string;
  position: string;
  salary: string;
  startDate: string;
  bodyHtml: string;
  expiresAt?: string;
  logoUrl?: string;
}

type PageState = 'loading' | 'ready' | 'signed' | 'expired' | 'already_signed' | 'not_ready' | 'error' | 'server_error';

/** Safely parse JSON from a response, returning null if it fails */
async function safeJson(resp: Response): Promise<Record<string, unknown> | null> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

export function ContractPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>('loading');
  const [contract, setContract] = useState<ContractData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [signatureEmpty, setSignatureEmpty] = useState(true);
  const [initialsEmpty, setInitialsEmpty] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const signCanvasRef = useRef<HTMLCanvasElement>(null);
  const signPadRef = useRef<SignaturePad | null>(null);
  const initCanvasRef = useRef<HTMLCanvasElement>(null);
  const initPadRef = useRef<SignaturePad | null>(null);
  const contractIframeRef = useRef<HTMLIFrameElement>(null);
  const [contractIframeHeight, setContractIframeHeight] = useState(1200);

  // ── Load contract data ────────────────────────────────────────────────────
  const loadContract = useCallback(() => {
    if (!token) { setState('error'); return; }
    setState('loading');
    fetch(`${API_BASE}/getContract?token=${encodeURIComponent(token)}`)
      .then(async (resp) => {
        if (resp.status === 409) {
          const json = await safeJson(resp);
          setState(json?.error === 'not_ready' ? 'not_ready' : 'already_signed');
          return;
        }
        if (resp.status === 410) { setState('expired'); return; }
        if (resp.status >= 500) { setState('server_error'); return; }
        if (!resp.ok) { setState('error'); return; }
        const json = await safeJson(resp);
        if (!json?.contract) { setState('server_error'); return; }
        setContract(json.contract as unknown as ContractData);
        setState('ready');
      })
      .catch(() => setState('server_error'));
  }, [token]);

  useEffect(() => { loadContract(); }, [loadContract]);

  // ── Mobile-optimized signature pad initialization ─────────────────────────
  const initCanvas = useCallback((
    canvasEl: HTMLCanvasElement | null,
    padRef: React.MutableRefObject<SignaturePad | null>,
    onStroke: (empty: boolean) => void,
    opts?: Partial<{ minWidth: number; maxWidth: number }>
  ) => {
    if (!canvasEl) return;
    const parent = canvasEl.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvasEl.width = rect.width * ratio;
    canvasEl.height = rect.height * ratio;
    canvasEl.style.width = `${rect.width}px`;
    canvasEl.style.height = `${rect.height}px`;
    const ctx = canvasEl.getContext('2d');
    if (ctx) ctx.scale(ratio, ratio);

    if (!padRef.current) {
      const pad = new SignaturePad(canvasEl, {
        penColor: '#1e293b',
        minWidth: opts?.minWidth ?? 1.5,
        maxWidth: opts?.maxWidth ?? 3,
        throttle: 16,
        velocityFilterWeight: 0.7,
      });
      padRef.current = pad;
      pad.addEventListener('endStroke', () => onStroke(pad.isEmpty()));
    } else {
      padRef.current.clear();
    }
    onStroke(true);
  }, []);

  useEffect(() => {
    if (state !== 'ready') return;

    const init = () => {
      initCanvas(signCanvasRef.current, signPadRef, setSignatureEmpty);
      initCanvas(initCanvasRef.current, initPadRef, setInitialsEmpty, {
        minWidth: 1,
        maxWidth: 2.5,
      });
    };

    // Slight delay to ensure DOM is laid out (important on mobile)
    const timer = setTimeout(init, 100);

    // Only reinitialize (which clears the canvas) if the user hasn't drawn anything yet.
    // On Android, the keyboard and browser chrome trigger resize events constantly.
    const safeInit = () => {
      const hasContent =
        !(signPadRef.current?.isEmpty() ?? true) ||
        !(initPadRef.current?.isEmpty() ?? true);
      if (!hasContent) init();
    };

    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(safeInit, 300);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => setTimeout(safeInit, 400));

    return () => {
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [state, initCanvas]);

  const clearSignature = () => {
    signPadRef.current?.clear();
    setSignatureEmpty(true);
  };

  const clearInitials = () => {
    initPadRef.current?.clear();
    setInitialsEmpty(true);
  };

  const handleContractIframeLoad = useCallback(() => {
    const iframe = contractIframeRef.current;
    if (!iframe?.contentDocument) return;
    setTimeout(() => {
      const h = iframe.contentDocument?.documentElement?.scrollHeight ?? 0;
      if (h > 100) setContractIframeHeight(h + 32);
    }, 150);
  }, []);

  const handleSubmit = async () => {
    if (!token || !signPadRef.current || signPadRef.current.isEmpty()) return;
    if (initialsEmpty) {
      setErrorMsg('Por favor dibuja tus iniciales antes de firmar.');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      const signatureBase64 = signPadRef.current.toDataURL('image/png');
      const initialsBase64 = initPadRef.current?.isEmpty()
        ? undefined
        : initPadRef.current?.toDataURL('image/png');

      const resp = await fetch(`${API_BASE}/signContract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, signatureBase64, initialsBase64 }),
      });
      const json = await safeJson(resp);
      if (!resp.ok) {
        const serverMsg = (json?.error as string) || null;
        throw new Error(
          serverMsg || 'Ocurrió un error al procesar tu firma. Por favor intenta de nuevo.'
        );
      }
      setPdfUrl((json?.pdfUrl as string) ?? null);
      setEvidenceUrl((json?.evidenceUrl as string) ?? null);
      setState('signed');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Error de conexión. Verifica tu internet e intenta de nuevo.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Cargando contrato...</p>
        </div>
      </div>
    );
  }

  // ── Terminal states ──────────────────────────────────────────────────────────
  if (state === 'signed') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">¡Contrato firmado!</h1>
          <p className="text-gray-500 text-sm mb-6">
            Tu contrato ha sido firmado exitosamente con tus iniciales en cada hoja.
            Se generó un certificado de firma electrónica como evidencia criptográfica.
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

  if (state === 'not_ready') {
    return <TerminalCard icon="clock" title="Contrato no disponible aún" message="Tu contrato no está listo para firmar todavía. Contacta a tu reclutador si crees que esto es un error." />;
  }

  if (state === 'expired') {
    return <TerminalCard icon="clock" title="Enlace expirado" message="Este enlace ya no es válido. Contacta a tu reclutador para recibir uno nuevo." />;
  }

  if (state === 'server_error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 110 18 9 9 0 010-18z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Error temporal</h1>
          <p className="text-gray-500 text-sm mb-6">
            Hubo un problema al cargar tu contrato. Esto suele resolverse al intentar de nuevo.
          </p>
          <button
            onClick={loadContract}
            className="bg-primary-600 text-white font-medium px-6 py-2.5 rounded-xl text-sm hover:bg-primary-700 transition-colors active:bg-primary-800"
          >
            Reintentar
          </button>
          <p className="text-xs text-gray-400 mt-3">
            Si el problema persiste, contacta a tu reclutador.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return <TerminalCard icon="x" title="Enlace no encontrado" message="No pudimos encontrar tu contrato. Verifica el enlace o contacta a tu reclutador." />;
  }

  // ── Main contract view ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-6 sm:py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="bg-primary-600 rounded-2xl p-6 sm:p-8 text-white">
          {contract?.logoUrl ? (
            <img
              src={contract.logoUrl}
              alt="Logo"
              className="h-10 max-w-[180px] object-contain mb-4"
            />
          ) : (
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mb-4">
              <span className="font-bold text-lg">A</span>
            </div>
          )}
          <h1 className="text-xl sm:text-2xl font-bold">Contrato de Trabajo</h1>
          <p className="text-white/80 text-sm mt-1">{contract?.position}</p>
        </div>

        {/* Key details — responsive grid */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Candidato</p>
              <p className="text-gray-900 font-semibold text-sm sm:text-base">{contract?.candidateName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Puesto</p>
              <p className="text-gray-900 font-semibold text-sm sm:text-base">{contract?.position}</p>
            </div>
            {contract?.salary && (
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Salario</p>
                <p className="text-gray-900 font-semibold text-sm sm:text-base">{contract.salary}</p>
              </div>
            )}
            {contract?.startDate && (
              <div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Fecha de inicio</p>
                <p className="text-gray-900 font-semibold text-sm sm:text-base">{contract.startDate}</p>
              </div>
            )}
          </div>
        </div>

        {/* Body content */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {isFullHtmlDocument(contract?.bodyHtml ?? '') ? (
            <iframe
              ref={contractIframeRef}
              srcDoc={
                contract?.bodyHtml
                  ? contract.bodyHtml.replace(
                      '</head>',
                      '<style>' +
                      '.page{width:100%!important;max-width:100%!important;' +
                      'padding:5vw!important;margin:0!important;box-shadow:none!important;}' +
                      'body{background:#fff!important;overflow-x:hidden!important;}' +
                      'table{max-width:100%!important;word-break:break-word;}' +
                      '</style></head>'
                    )
                  : ''
              }
              onLoad={handleContractIframeLoad}
              title="Contrato"
              sandbox="allow-same-origin"
              className="w-full block border-0"
              style={{ height: `${contractIframeHeight}px`, overflowX: 'hidden' }}
              scrolling="no"
            />
          ) : (
            <div className="p-4 sm:p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Contrato</h2>
              <div
                className="prose prose-sm max-w-none text-gray-600 [&_p]:text-sm [&_li]:text-sm [&_strong]:text-gray-800"
                dangerouslySetInnerHTML={{ __html: contract?.bodyHtml ?? '' }}
              />
            </div>
          )}
        </div>

        {/* FES info */}
        <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">Firma Electrónica Simple (FES)</h3>
          <p className="text-xs text-blue-700 leading-relaxed">
            Al firmar este contrato, se generará evidencia criptográfica que incluye: hash SHA-256 del documento,
            tu dirección IP, fecha y hora exacta, y un certificado de firma. Tus iniciales se colocarán en cada
            hoja del contrato como evidencia adicional. Esta firma tiene validez legal conforme al artículo 1834
            bis del Código Civil Federal.
          </p>
        </div>

        {/* Initials */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-sm font-semibold text-gray-700">Iniciales (siglas)</h2>
            <span className="text-[10px] bg-blue-50 text-blue-600 rounded-lg px-2 py-1 font-bold tracking-wide shrink-0 ml-2">
              Ejemplo: JGR
            </span>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Dibuja tus iniciales con el dedo. Se colocarán en cada hoja como evidencia de lectura.
          </p>
          <div
            className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-gray-50 relative"
            style={{ height: '140px' }}
          >
            <canvas
              ref={initCanvasRef}
              className="absolute inset-0 w-full h-full cursor-crosshair"
              style={{ touchAction: 'none' }}
            />
            {initialsEmpty && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-gray-300 text-base select-none">Tus iniciales aquí</p>
              </div>
            )}
          </div>
          <button
            onClick={clearInitials}
            className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors active:text-gray-800 py-1"
          >
            Borrar iniciales
          </button>
        </div>

        {/* Signature */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Firma digital</h2>
          <p className="text-xs text-gray-400 mb-4">
            Dibuja tu firma completa en el recuadro de abajo para firmar este contrato de trabajo.
          </p>

          {/* Signature canvas */}
          <div
            className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-gray-50 relative"
            style={{ height: '220px' }}
          >
            <canvas
              ref={signCanvasRef}
              className="absolute inset-0 w-full h-full cursor-crosshair"
              style={{ touchAction: 'none' }}
            />
            {signatureEmpty && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-gray-300 text-sm select-none">Firma aquí</p>
              </div>
            )}
          </div>
          <button
            onClick={clearSignature}
            className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors active:text-gray-800 py-1"
          >
            Borrar firma
          </button>

          {/* Terms acceptance */}
          <label className="flex items-start gap-3 mt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 mt-0.5 shrink-0"
            />
            <span className="text-xs text-gray-600 leading-relaxed">
              He leído y acepto los términos de este contrato de trabajo. Confirmo que mis iniciales y firma
              digital tienen la misma validez que mi firma autógrafa conforme a la legislación mexicana.
            </span>
          </label>

          {errorMsg && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || signatureEmpty || initialsEmpty || !acceptedTerms}
            className="mt-5 sm:mt-6 w-full bg-primary-600 text-white font-semibold py-3.5 sm:py-3 rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm sm:text-base active:bg-primary-800"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Procesando firma e iniciales...
              </>
            ) : (
              'Firmo este contrato de trabajo'
            )}
          </button>

          <p className="text-xs text-gray-400 text-center mt-3">
            Al firmar, tus iniciales se colocarán en cada hoja y se generará
            un certificado de evidencia criptográfica SHA-256.
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
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-10 max-w-md w-full text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${colors[icon]}`}>
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icons[icon]}</svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-500 text-sm">{message}</p>
      </div>
    </div>
  );
}
