import { useState, useRef, useEffect, useCallback } from 'react';
import SignaturePad from 'signature_pad';
import { ImageIcon, Loader2, Trash2, CheckCircle, PenLine, X } from 'lucide-react';
import { uploadAsset } from '../../services/storage';
import { getBrandingSettings, saveBrandingSettings } from '../../services/settings';
import type { BrandingSettings } from '../../types';

export function BrandingTab() {
  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [companySigUrl, setCompanySigUrl] = useState<string | undefined>();
  const [legalRepInitialsUrl, setLegalRepInitialsUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const [uploadingInitials, setUploadingInitials] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedSig, setSavedSig] = useState(false);
  const [savedInitials, setSavedInitials] = useState(false);
  const [sigEmpty, setSigEmpty] = useState(true);
  const [initialsEmpty, setInitialsEmpty] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const sigPadRef = useRef<SignaturePad | null>(null);
  const initialsCanvasRef = useRef<HTMLCanvasElement>(null);
  const initialsPadRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    getBrandingSettings().then((s) => {
      setLogoUrl(s.logoUrl);
      setCompanySigUrl(s.companySignatureUrl);
      setLegalRepInitialsUrl(s.legalRepInitialsUrl);
      setLoading(false);
    });
  }, []);

  const initPadHelper = useCallback((
    canvasRef: React.RefObject<HTMLCanvasElement>,
    padRef: React.MutableRefObject<SignaturePad | null>,
    setEmpty: (v: boolean) => void,
    opts?: { minWidth?: number; maxWidth?: number }
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(ratio, ratio);
    if (!padRef.current) {
      const pad = new SignaturePad(canvas, {
        penColor: '#1e293b',
        minWidth: opts?.minWidth ?? 1.5,
        maxWidth: opts?.maxWidth ?? 3,
      });
      padRef.current = pad;
      pad.addEventListener('endStroke', () => setEmpty(pad.isEmpty()));
    } else {
      padRef.current.clear();
    }
    setEmpty(true);
  }, []);

  const initSigPad = useCallback(() => initPadHelper(sigCanvasRef, sigPadRef, setSigEmpty), [initPadHelper]);
  const initInitialsPad = useCallback(() => initPadHelper(initialsCanvasRef, initialsPadRef, setInitialsEmpty, { minWidth: 1, maxWidth: 2.5 }), [initPadHelper]);

  useEffect(() => {
    if (!loading) {
      const t1 = setTimeout(initSigPad, 150);
      const t2 = setTimeout(initInitialsPad, 150);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [loading, initSigPad, initInitialsPad]);

  function flash(setter: (v: boolean) => void) {
    setter(true);
    setTimeout(() => setter(false), 3000);
  }

  // Merge-safe save: read current then merge the change
  async function mergeSave(patch: Partial<BrandingSettings>) {
    const current = await getBrandingSettings();
    await saveBrandingSettings({ ...current, ...patch } as BrandingSettings);
  }

  async function mergeRemove(key: keyof BrandingSettings) {
    const current = await getBrandingSettings();
    const next = { ...current };
    delete next[key];
    await saveBrandingSettings(next);
  }

  // ─── Logo handlers ───────────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setSaved(false);
    try {
      const { downloadUrl } = await uploadAsset(file, 'assets/branding');
      setLogoUrl(downloadUrl);
      await mergeSave({ logoUrl: downloadUrl });
      flash(setSaved);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    setLogoUrl(undefined);
    await mergeRemove('logoUrl');
    flash(setSaved);
  };

  // ─── Company signature handlers ──────────────────────────────────────────────

  const handleSaveSig = async () => {
    if (!sigPadRef.current || sigPadRef.current.isEmpty()) return;
    setUploadingSig(true);
    setSavedSig(false);
    try {
      const dataUrl = sigPadRef.current.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'company_signature.png', { type: 'image/png' });
      const { downloadUrl } = await uploadAsset(file, 'assets/branding');
      setCompanySigUrl(downloadUrl);
      await mergeSave({ companySignatureUrl: downloadUrl });
      flash(setSavedSig);
    } finally {
      setUploadingSig(false);
    }
  };

  const handleRemoveSig = async () => {
    setCompanySigUrl(undefined);
    sigPadRef.current?.clear();
    setSigEmpty(true);
    await mergeRemove('companySignatureUrl');
    flash(setSavedSig);
  };

  // ─── Legal rep initials handlers ─────────────────────────────────────────────

  const handleSaveInitials = async () => {
    if (!initialsPadRef.current || initialsPadRef.current.isEmpty()) return;
    setUploadingInitials(true);
    setSavedInitials(false);
    try {
      const dataUrl = initialsPadRef.current.toDataURL('image/png');
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'legal_rep_initials.png', { type: 'image/png' });
      const { downloadUrl } = await uploadAsset(file, 'assets/branding');
      setLegalRepInitialsUrl(downloadUrl);
      await mergeSave({ legalRepInitialsUrl: downloadUrl });
      flash(setSavedInitials);
    } finally {
      setUploadingInitials(false);
    }
  };

  const handleRemoveInitials = async () => {
    setLegalRepInitialsUrl(undefined);
    initialsPadRef.current?.clear();
    setInitialsEmpty(true);
    await mergeRemove('legalRepInitialsUrl');
    flash(setSavedInitials);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-10 max-w-lg">

      {/* ── Logo ─────────────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Logo de la empresa</h3>
        <p className="text-xs text-gray-500 mb-4">
          Se mostrará en el encabezado de todos los correos que se envían a los candidatos.
          Usa PNG o SVG con fondo transparente o blanco. Tamaño recomendado: 200×60 px.
        </p>

        <div className="border border-gray-200 rounded-xl p-5 bg-gray-50 flex flex-col items-center gap-4">
          <div className="w-full max-w-xs bg-[#16b877] rounded-xl p-5 flex flex-col items-center">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo preview" className="max-h-12 max-w-[200px] object-contain" />
            ) : (
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                <span className="text-white text-2xl font-bold">A</span>
              </div>
            )}
            <p className="text-white/80 text-xs mt-3">Vista previa del encabezado del correo</p>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-60"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
              {uploading ? 'Subiendo…' : logoUrl ? 'Cambiar logo' : 'Subir logo'}
            </button>
            {logoUrl && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} /> Quitar
              </button>
            )}
          </div>

          {saved && (
            <div className="flex items-center gap-1.5 text-green-700 text-xs font-medium">
              <CheckCircle size={13} /> Guardado
            </div>
          )}
        </div>
      </div>

      {/* ── Company signature ────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Firma del Representante Legal</h3>
        <p className="text-xs text-gray-500 mb-1">
          Dibuja la firma del apoderado una vez. Se estampará automáticamente en todos los contratos.
          En tu plantilla HTML, escribe{' '}
          <code className="bg-gray-100 px-1 rounded text-[11px]">{'{{firmaEmpresa}}'}</code>
          {' '}donde quieras que aparezca la firma.
        </p>
        <p className="text-xs text-gray-400 mb-4">
          Ejemplo: en la celda "La Empresa" de tu tabla de firmas.
        </p>

        <div className="border border-gray-200 rounded-xl p-5 bg-gray-50 space-y-4">

          {/* Current saved signature preview */}
          {companySigUrl && (
            <div className="bg-white border border-green-200 rounded-lg p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CheckCircle size={16} className="text-green-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-1">Firma guardada:</p>
                  <img
                    src={companySigUrl}
                    alt="Firma del Representante Legal"
                    className="max-h-14 max-w-[200px] object-contain"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleRemoveSig}
                title="Eliminar firma"
                className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Signature pad */}
          <div>
            <p className="text-xs text-gray-500 mb-2">
              {companySigUrl ? 'Redibujar firma:' : 'Dibuja la firma del Representante Legal:'}
            </p>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-white relative"
              style={{ height: '130px' }}
            >
              <canvas
                ref={sigCanvasRef}
                className="absolute inset-0 w-full h-full cursor-crosshair"
                style={{ touchAction: 'none' }}
              />
              {sigEmpty && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-gray-300 text-sm select-none">Firma aquí</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { sigPadRef.current?.clear(); setSigEmpty(true); }}
              className="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors py-1"
            >
              Borrar
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveSig}
              disabled={sigEmpty || uploadingSig}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {uploadingSig ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />}
              {uploadingSig ? 'Guardando…' : 'Guardar firma'}
            </button>
            {savedSig && (
              <div className="flex items-center gap-1.5 text-green-700 text-xs font-medium">
                <CheckCircle size={13} /> Guardada
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Legal rep initials ───────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Iniciales del Representante Legal</h3>
        <p className="text-xs text-gray-500 mb-4">
          Dibuja las iniciales del representante legal. Aparecerán en el pie de página de cada hoja del contrato,
          junto a las iniciales del candidato, como evidencia de que ambas partes leyeron todas las páginas.
        </p>

        <div className="border border-gray-200 rounded-xl p-5 bg-gray-50 space-y-4">

          {legalRepInitialsUrl && (
            <div className="bg-white border border-green-200 rounded-lg p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CheckCircle size={16} className="text-green-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-1">Iniciales guardadas:</p>
                  <img
                    src={legalRepInitialsUrl}
                    alt="Iniciales del Representante Legal"
                    className="max-h-10 max-w-[120px] object-contain"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleRemoveInitials}
                title="Eliminar iniciales"
                className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div>
            <p className="text-xs text-gray-500 mb-2">
              {legalRepInitialsUrl ? 'Redibujar iniciales:' : 'Dibuja las iniciales del Representante Legal:'}
            </p>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] bg-blue-50 text-blue-600 rounded-lg px-2 py-1 font-bold tracking-wide shrink-0">
                Ejemplo: SHD
              </span>
              <span className="text-xs text-gray-400">Usa tus iniciales con letra cursiva o de imprenta</span>
            </div>
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-white relative"
              style={{ height: '130px' }}
            >
              <canvas
                ref={initialsCanvasRef}
                className="absolute inset-0 w-full h-full cursor-crosshair"
                style={{ touchAction: 'none' }}
              />
              {initialsEmpty && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-gray-300 text-sm select-none">Iniciales aquí</p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { initialsPadRef.current?.clear(); setInitialsEmpty(true); }}
              className="mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors py-1"
            >
              Borrar
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveInitials}
              disabled={initialsEmpty || uploadingInitials}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {uploadingInitials ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />}
              {uploadingInitials ? 'Guardando…' : 'Guardar iniciales'}
            </button>
            {savedInitials && (
              <div className="flex items-center gap-1.5 text-green-700 text-xs font-medium">
                <CheckCircle size={13} /> Guardadas
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
