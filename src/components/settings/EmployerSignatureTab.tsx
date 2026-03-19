import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, Loader2, Trash2, PenTool } from 'lucide-react';
import SignaturePad from 'signature_pad';
import type { EmployerSignatureSettings } from '../../types';

interface Props {
  settings: EmployerSignatureSettings | null;
  saving: boolean;
  saved: boolean;
  onSave: (settings: EmployerSignatureSettings) => void;
}

export function EmployerSignatureTab({ settings, saving, saved, onSave }: Props) {
  const [signerName, setSignerName] = useState(settings?.signerName ?? 'Salvador Hernández Díaz de León');
  const [signerTitle, setSignerTitle] = useState(settings?.signerTitle ?? 'Representante Legal');
  const [signatureBase64, setSignatureBase64] = useState(settings?.signatureBase64 ?? '');
  const [isEmpty, setIsEmpty] = useState(!settings?.signatureBase64);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    if (settings) {
      setSignerName(settings.signerName);
      setSignerTitle(settings.signerTitle);
      setSignatureBase64(settings.signatureBase64);
      setIsEmpty(!settings.signatureBase64);
    }
  }, [settings]);

  const initCanvas = useCallback(() => {
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

    if (padRef.current) {
      padRef.current.off();
    }

    const pad = new SignaturePad(canvas, {
      penColor: '#1e293b',
      minWidth: 1.5,
      maxWidth: 3,
      throttle: 16,
      velocityFilterWeight: 0.7,
    });
    padRef.current = pad;

    pad.addEventListener('endStroke', () => {
      setIsEmpty(pad.isEmpty());
      setSignatureBase64(pad.toDataURL('image/png'));
    });

    // If there's an existing signature, draw it on the canvas
    if (signatureBase64 && signatureBase64.startsWith('data:image')) {
      const img = new Image();
      img.onload = () => {
        const ctx2 = canvas.getContext('2d');
        if (ctx2) {
          const scale = Math.min(rect.width / img.width, rect.height / img.height, 0.9);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx2.drawImage(img, (rect.width - w) / 2, (rect.height - h) / 2, w, h);
        }
        pad.fromDataURL(signatureBase64);
      };
      img.src = signatureBase64;
    }

    setIsEmpty(!signatureBase64);
  }, []);

  useEffect(() => {
    const timer = setTimeout(initCanvas, 100);
    const handleResize = () => { clearTimeout(timer); setTimeout(initCanvas, 200); };
    window.addEventListener('resize', handleResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', handleResize); };
  }, [initCanvas]);

  const clearSignature = () => {
    padRef.current?.clear();
    setIsEmpty(true);
    setSignatureBase64('');
  };

  const handleSave = () => {
    if (!signerName.trim() || !signatureBase64) return;
    onSave({
      signerName: signerName.trim(),
      signerTitle: signerTitle.trim(),
      signatureBase64,
    });
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Firma del Apoderado Legal</h3>
        <p className="text-sm text-gray-500">
          Esta firma se estampa automáticamente en todos los contratos que firmen los candidatos.
        </p>
      </div>

      <div className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-4">
          <label className="text-sm font-medium text-gray-700">Nombre del apoderado</label>
          <input
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Salvador Hernández Díaz de León"
            className="input-field mt-2"
          />
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <label className="text-sm font-medium text-gray-700">Cargo</label>
          <input
            type="text"
            value={signerTitle}
            onChange={(e) => setSignerTitle(e.target.value)}
            placeholder="Representante Legal"
            className="input-field mt-2"
          />
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <PenTool size={14} className="text-primary-600" />
              Firma
            </label>
            {!isEmpty && (
              <button
                onClick={clearSignature}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={12} />
                Borrar
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Dibuja la firma del apoderado legal. Se usará en todos los contratos generados.
          </p>
          <div
            className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-white relative"
            style={{ height: '150px' }}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full cursor-crosshair"
              style={{ touchAction: 'none' }}
            />
            {isEmpty && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-gray-300 text-sm select-none">Firma del apoderado aquí</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {signatureBase64 && (
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs text-blue-700 leading-relaxed">
            <strong>Vista previa:</strong> Esta firma aparecerá automáticamente en la sección
            "La Empresa" de cada contrato, junto al nombre <strong>{signerName}</strong> ({signerTitle}).
          </p>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || isEmpty || !signerName.trim()}
        className="btn-primary flex items-center justify-center gap-2 text-sm py-2 px-6 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 size={14} className="animate-spin" />
        ) : saved ? (
          <Check size={14} />
        ) : null}
        {saved ? 'Guardado' : saving ? 'Guardando...' : 'Guardar firma'}
      </button>
    </div>
  );
}
