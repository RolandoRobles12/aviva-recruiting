/**
 * Helpers to read Viterbit custom fields.
 *
 * Viterbit returns custom fields in two different shapes depending on the
 * endpoint and the includes used:
 *
 *   array:  [{ field_id, name, value }, ...]
 *   record: { <key>: { value } | string, ... }
 *
 * readCustomField normalises both and accepts several key aliases, since the
 * same concept is named slightly differently across jobs, candidates and
 * candidatures.
 */

function asText(val: unknown): string {
  if (val == null) return '';
  if (Array.isArray(val)) return val.map(asText).filter(Boolean).join(', ');
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('value' in obj) return asText(obj.value);
    if ('label' in obj) return asText(obj.label);
    if ('name' in obj) return asText(obj.name);
    return '';
  }
  return String(val);
}

/** Reads the first non-empty value matching any of `keys` (case-insensitive). */
export function readCustomField(raw: unknown, keys: string[]): string {
  if (!raw || typeof raw !== 'object') return '';
  const wanted = keys.map((k) => k.toLowerCase());

  if (Array.isArray(raw)) {
    for (const entry of raw as Array<Record<string, unknown>>) {
      const ids = [entry.field_id, entry.id, entry.key, entry.name, entry.slug]
        .filter((v) => typeof v === 'string')
        .map((v) => (v as string).toLowerCase());
      if (ids.some((id) => wanted.includes(id))) {
        const text = asText(entry.value);
        if (text) return text;
      }
    }
    return '';
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (wanted.includes(key.toLowerCase())) {
      const text = asText(value);
      if (text) return text;
    }
  }
  return '';
}

/** Field-id aliases for the credit bureau check result. */
export const BURO_FIELD_KEYS = [
  'buro',
  'buró',
  'buro_credito',
  'buro_de_credito',
  'buró_de_crédito',
  'candidate_buro',
  'custom_candidate_buro',
];

/** Field-id aliases for the integrity psychometrics result. */
export const PSICOMETRIA_INTEGRIDAD_FIELD_KEYS = [
  'psicometria_integridad',
  'psicometría_integridad',
  'psicometria_de_integridad',
  'psicometria',
  'psicometría',
  'candidate_psicometria_integridad',
  'custom_candidate_psicometria_integridad',
];

export interface ViterbitScreeningFields {
  /** Credit bureau result, empty string when Viterbit has no value yet. */
  buro: string;
  /** Integrity psychometrics result, empty string when not filled in yet. */
  psicometriaIntegridad: string;
}

/**
 * Extracts the buró and integrity-psychometrics results from a Viterbit
 * candidate or candidature payload. Both are recruiter-filled custom fields,
 * so either object may carry them depending on how the account is configured.
 */
export function readScreeningFields(data: Record<string, unknown>): ViterbitScreeningFields {
  const raw = data.custom_field_values ?? data.custom_fields;
  return {
    buro: readCustomField(raw, BURO_FIELD_KEYS) || asText(data.buro),
    psicometriaIntegridad:
      readCustomField(raw, PSICOMETRIA_INTEGRIDAD_FIELD_KEYS) || asText(data.psicometria_integridad),
  };
}

/** Merges screening fields, preferring the first non-empty value per field. */
export function mergeScreeningFields(
  ...sources: Array<Partial<ViterbitScreeningFields> | null | undefined>
): ViterbitScreeningFields {
  const pick = (key: keyof ViterbitScreeningFields): string => {
    for (const source of sources) {
      const value = source?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  };
  return { buro: pick('buro'), psicometriaIntegridad: pick('psicometriaIntegridad') };
}
