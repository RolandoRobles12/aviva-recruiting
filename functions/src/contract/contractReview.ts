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

// Same shape rules as CONTRACT_FIELDS in CandidateDetailPanel.tsx — keep both
// in sync. A field must satisfy this before it can be sent, whether the value
// came straight from OCR or from a recruiter's saved correction.
const FIELD_VALIDATORS: Record<string, (v: string) => boolean> = {
  curp:      (v) => /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/i.test(v.trim()),
  rfc:       (v) => /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(v.trim()),
  nss:       (v) => /^\d{11}$/.test(v.trim()),
  clabe:     (v) => /^\d{18}$/.test(v.trim()),
  banco:     (v) => v.trim().length > 1,
  domicilio: (v) => v.trim().length > 5,
};

// Claude reports its own confidence (0.0–1.0) that a document was correctly
// read. Below this, an OCR value alone isn't enough — a recruiter must save
// an explicit correction/confirmation for the field, even if the raw OCR
// value happens to already look well-formed.
export const CONTRACT_REVIEW_CONFIDENCE_THRESHOLD = 0.8;

export interface ContractReviewResult {
  required: boolean;
  /** Field keys (curp, rfc, ...) that still block sending. */
  fields: string[];
  /** Human-readable reasons, in Spanish, one per flagged field. */
  reasons: string[];
}

type DocMap = Record<string, { status?: string; ocrResult?: { extractedData?: Record<string, string>; confidence?: number } }>;

/**
 * Determines whether the contract's OCR-sourced fields (CURP, RFC, domicilio,
 * CLABE, banco, NSS) are reliable enough to email to the candidate.
 *
 * A field blocks sending when either:
 *  - it's missing, or its source document's OCR confidence is below the
 *    threshold, AND no recruiter-saved correction (dataOverrides) exists for
 *    it yet — doubt about a field always requires a manual look; or
 *  - its final value (the override if present, otherwise the OCR value)
 *    doesn't pass the same format check the contract-data editor uses — i.e.
 *    it isn't "green" yet, whether that value came from OCR or was typed in.
 */
export function evaluateContractDataReview(candidate: Record<string, unknown>): ContractReviewResult {
  const docs = (candidate.documents ?? {}) as DocMap;
  const overrides = (candidate.dataOverrides ?? {}) as Record<string, string>;

  const fields: string[] = [];
  const reasons: string[] = [];

  for (const [fieldKey, sources] of Object.entries(CONTRACT_FIELD_SOURCES)) {
    let ocrValue = '';
    let confidence = 1;
    let sourceDocType = '';
    for (const { docType, ocrKey } of sources) {
      const doc = docs[docType];
      const extracted = doc?.status === 'valid' ? doc.ocrResult?.extractedData?.[ocrKey] : undefined;
      if (extracted) {
        ocrValue = extracted;
        confidence = doc?.ocrResult?.confidence ?? 1;
        sourceDocType = docType;
        break;
      }
    }

    const override = overrides[fieldKey]?.trim() ?? '';
    const finalValue = override || ocrValue;
    const validate = FIELD_VALIDATORS[fieldKey];

    if (!override && !ocrValue) {
      fields.push(fieldKey);
      reasons.push(`${FIELD_LABELS[fieldKey]}: no se pudo leer del documento — corrígelo manualmente.`);
    } else if (!override && confidence < CONTRACT_REVIEW_CONFIDENCE_THRESHOLD) {
      fields.push(fieldKey);
      reasons.push(`${FIELD_LABELS[fieldKey]}: confianza baja del OCR (${Math.round(confidence * 100)}%) en ${DOC_LABELS[sourceDocType] ?? sourceDocType} — confírmalo o corrígelo manualmente.`);
    } else if (validate && !validate(finalValue)) {
      fields.push(fieldKey);
      reasons.push(`${FIELD_LABELS[fieldKey]}: formato inválido ("${finalValue}") — corrígelo antes de enviar.`);
    }
  }

  return { required: fields.length > 0, fields, reasons };
}
