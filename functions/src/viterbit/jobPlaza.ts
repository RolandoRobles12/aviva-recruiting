/**
 * Plaza (store) and city of a Viterbit job.
 *
 * Both live on the job payload rather than on custom fields: `external_id` is
 * the store identifier as operations names it ("MEX0147 Oxkutzcab BA") and is
 * stored verbatim so it matches Viterbit and the reporting sheets, while the
 * city comes from the job's address block.
 */
export interface JobPlaza {
  plaza: string;
  city: string;
}

export function extractJobPlaza(data: Record<string, unknown>): JobPlaza {
  const address =
    (data.address as Record<string, unknown> | undefined) ??
    (data.location as Record<string, unknown> | undefined) ??
    {};
  const externalId = data.external_id;
  const city = address.city;

  return {
    plaza: typeof externalId === 'string' ? externalId.trim() : '',
    city: typeof city === 'string' ? city.trim() : '',
  };
}
