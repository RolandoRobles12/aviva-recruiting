/**
 * Shared document type constants for Cloud Functions.
 * Must stay in sync with src/types/index.ts on the frontend.
 */

export const DOCUMENT_LABELS: Record<string, string> = {
  acta_nacimiento: 'Acta de Nacimiento',
  curp: 'CURP',
  nss: 'Número de Seguridad Social',
  caratula_bancaria: 'Carátula Bancaria',
  certificado_estudios: 'Certificado de Estudios',
  constancia_fiscal: 'Constancia de Situación Fiscal',
  carta_recomendacion: 'Carta de Recomendación',
  ine: 'INE',
  comprobante_domicilio: 'Comprobante de Domicilio',
  foto_profesional: 'Foto Profesional',
  aviso_retencion: 'Aviso de Retención (INFONAVIT)',
  estado_cuenta_fonacot: 'Estado de Cuenta (FONACOT)',
};

/** Core required document types (always expected) */
export const DOCUMENT_TYPES_REQUIRED = [
  'acta_nacimiento',
  'curp',
  'nss',
  'caratula_bancaria',
  'certificado_estudios',
  'constancia_fiscal',
  'carta_recomendacion',
  'ine',
  'comprobante_domicilio',
  'foto_profesional',
];

/** Conditional document types (based on form answers) */
export const DOCUMENT_TYPES_CONDITIONAL = [
  'aviso_retencion',
  'estado_cuenta_fonacot',
];

/** All valid document types for OCR validation */
export const ALL_DOCUMENT_TYPES = [
  ...DOCUMENT_TYPES_REQUIRED,
  ...DOCUMENT_TYPES_CONDITIONAL,
];
