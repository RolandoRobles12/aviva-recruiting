import { readScreeningFields, type ViterbitScreeningFields } from '../utils/viterbitFields';

const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

/**
 * Fetches a Viterbit candidate with its custom fields.
 *
 * The `includes[]=custom_field_values` parameter is what makes Viterbit return
 * the custom fields at all — without it the response carries no
 * `custom_field_values` key. A plain fetch is kept as a fallback so a rejected
 * include degrades (missing screening data → offer held) instead of failing the
 * whole candidate lookup.
 */
export async function fetchCandidateRaw(
  candidateViterbitId: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const urls = [
    `${VITERBIT_API_BASE}/candidates/${candidateViterbitId}?includes[]=custom_field_values`,
    `${VITERBIT_API_BASE}/candidates/${candidateViterbitId}`,
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers: { 'X-API-Key': apiKey } });
      if (!resp.ok) {
        console.error(`[viterbit] fetchCandidateRaw ${candidateViterbitId} → HTTP ${resp.status} (${url})`);
        continue;
      }
      const json = (await resp.json()) as Record<string, unknown>;
      return (json.data as Record<string, unknown>) ?? json;
    } catch (err) {
      console.error('[viterbit] fetchCandidateRaw error:', err);
    }
  }
  return null;
}

/**
 * Reads the buró and psicometría de integridad results from the candidate's
 * custom fields. Both are stored as links to the uploaded report, so a value
 * simply being present is what "conocido" means — see utils/hiringDetails.
 */
export async function fetchCandidateScreening(
  candidateViterbitId: string,
  apiKey: string,
): Promise<ViterbitScreeningFields> {
  const data = await fetchCandidateRaw(candidateViterbitId, apiKey);
  if (!data) return { buro: '', psicometriaIntegridad: '' };
  return readScreeningFields(data);
}
