import { useState, useRef } from 'react';
import { ImageIcon, Loader2, Trash2, CheckCircle } from 'lucide-react';
import { uploadAsset } from '../../services/storage';
import { getBrandingSettings, saveBrandingSettings } from '../../services/settings';
import { useEffect } from 'react';

export function BrandingTab() {
  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getBrandingSettings().then((s) => {
      setLogoUrl(s.logoUrl);
      setLoading(false);
    });
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setSaved(false);
    try {
      const { downloadUrl } = await uploadAsset(file, 'assets/branding');
      const newUrl = downloadUrl;
      setLogoUrl(newUrl);
      await saveBrandingSettings({ logoUrl: newUrl });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setLogoUrl(undefined);
    await saveBrandingSettings({ logoUrl: undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Logo de la empresa</h3>
        <p className="text-xs text-gray-500">
          El logo se mostrará en el encabezado de todos los correos que se envían a los candidatos
          (invitación, recordatorios, carta oferta, contrato, etc.).
          Usa PNG o SVG con fondo transparente o blanco. Tamaño recomendado: 200×60 px o superior.
        </p>
      </div>

      {/* Preview */}
      <div className="border border-gray-200 rounded-xl p-5 bg-gray-50 flex flex-col items-center gap-4">
        <div className="w-full max-w-xs bg-[#16b877] rounded-xl p-5 flex flex-col items-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo preview"
              className="max-h-12 max-w-[200px] object-contain"
            />
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
              onClick={handleRemove}
              className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
              Quitar
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
  );
}
