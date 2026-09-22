const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

/**
 * The two job details the onboarding sheet needs: the vacancy's external id
 * (InternalID, whose last word is the city) and the recruiter assigned in
 * Viterbit. Never throws — the row is still worth writing without them.
 *
 * Used to be copied verbatim in signContract.ts and appendSheetsRowManual.ts.
 */
export async function fetchJobSheetInfo(
  jobId: string | undefined,
  apiKey: string
): Promise<{ externalId: string | undefined; recruiterName: string }> {
  if (!jobId || !apiKey) return { externalId: undefined, recruiterName: '' };
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=custom_field_values`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) return { externalId: undefined, recruiterName: '' };
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const externalId = (data.external_id as string) || undefined;
    const custom = (data.custom_field_values as Record<string, unknown>) ?? {};
    const reclutadorId = custom.reclutador as string | undefined;
    let recruiterName = '';
    if (reclutadorId) {
      const uResp = await fetch(`${VITERBIT_API_BASE}/users/${reclutadorId}`, {
        headers: { 'X-API-Key': apiKey },
      });
      if (uResp.ok) {
        const uJson = (await uResp.json()) as Record<string, unknown>;
        const uData = (uJson.data as Record<string, unknown>) ?? uJson;
        recruiterName = (uData.full_name as string) ?? '';
      }
    }
    return { externalId, recruiterName };
  } catch {
    return { externalId: undefined, recruiterName: '' };
  }
}
