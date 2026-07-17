// Same field keys/precedence used by signContract.ts's variable interpolation
// and the frontend's "Datos para el contrato" editor (CandidateDetailPanel.tsx).
export const CONTRACT_FIELD_SOURCES: Record<string, Array<{ docType: string; ocrKey: string }>> = {
  curp:      [{ docType: 'curp', ocrKey: 'curp' }, { docType: 'ine', ocrKey: 'curp' }],
  rfc:       [{ docType: 'constancia_fiscal', ocrKey: 'rfc' }],
  domicilio: [{ docType: 'ine', ocrKey: 'domicilio' }],
  clabe:     [{ docType: 'caratula_bancaria', ocrKey: 'clabe' }],
  banco:     [{ docType: 'caratula_bancaria', ocrKey: 'banco' }],
  nss:       [{ docType: 'nss', ocrKey: 'nss' }],
};

const FIELD_LABELS: Record<string, string> = {
  curp: 'CURP', rfc: 'RFC', domicilio: 'Domicilio', clabe: 'CLABE', banco: 'Banco', nss: 'NSS',
};

const DOC_LABELS: Record<string, string> = {
  curp: 'documento CURP', ine: 'INE', constancia_fiscal: 'Constancia de Situación Fiscal',
  caratula_bancaria: 'carátula bancaria', nss: 'comprobante de NSS',
};

// Claude reports its own confidence (0.0–1.0) that a document was correctly
// read. Below this, we don't trust the fields extracted from it enough to put
// them, unreviewed, into a legal document the candidate signs.
export const CONTRACT_REVIEW_CONFIDENCE_THRESHOLD = 0.8;

export interface ContractReviewResult {
  required: boolean;
  /** Field keys (curp, rfc, ...) that still need a recruiter-confirmed value. */
  fields: string[];
  /** Human-readable reasons, in Spanish, one per flagged field. */
  reasons: string[];
}

type DocMap = Record<string, { status?: string; ocrResult?: { extractedData?: Record<string, string>; confidence?: number } }>;

/**
 * Determines whether the contract's OCR-sourced fields (CURP, RFC, domicilio,
 * CLABE, banco, NSS) are reliable enough to send to the candidate unreviewed.
 *
 * A field is considered reviewed/trusted once a recruiter has explicitly saved
 * it in dataOverrides (via "Datos para el contrato" → Guardar correcciones),
 * regardless of the underlying OCR confidence — that save IS the manual
 * verification. Otherwise, a field needs review when it's missing or its
 * source document's OCR confidence is below the threshold.
 */
export function evaluateContractDataReview(candidate: Record<string, unknown>): ContractReviewResult {
  const docs = (candidate.documents ?? {}) as DocMap;
  const overrides = (candidate.dataOverrides ?? {}) as Record<string, string>;

  const fields: string[] = [];
  const reasons: string[] = [];

  for (const [fieldKey, sources] of Object.entries(CONTRACT_FIELD_SOURCES)) {
    if (overrides[fieldKey]?.trim()) continue; // recruiter already confirmed this field

    let value = '';
    let confidence = 1;
    let sourceDocType = '';
    for (const { docType, ocrKey } of sources) {
      const doc = docs[docType];
      const extracted = doc?.status === 'valid' ? doc.ocrResult?.extractedData?.[ocrKey] : undefined;
      if (extracted) {
        value = extracted;
        confidence = doc?.ocrResult?.confidence ?? 1;
        sourceDocType = docType;
        break;
      }
    }

    if (!value) {
      fields.push(fieldKey);
      reasons.push(`${FIELD_LABELS[fieldKey]}: no se pudo leer del documento.`);
    } else if (confidence < CONTRACT_REVIEW_CONFIDENCE_THRESHOLD) {
      fields.push(fieldKey);
      reasons.push(`${FIELD_LABELS[fieldKey]}: confianza baja del OCR (${Math.round(confidence * 100)}%) en ${DOC_LABELS[sourceDocType] ?? sourceDocType}.`);
    }
  }

  return { required: fields.length > 0, fields, reasons };
}
