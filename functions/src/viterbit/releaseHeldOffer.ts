/**
 * Sends the offer letter for a candidate parked in `offer_held` once Viterbit
 * finally carries every hiring detail.
 *
 * Holding the letter is only meant to be a wait for data, so the moment a sync
 * fills the last missing field the letter should go out by itself — otherwise
 * the recruiter has to notice the candidate unblocked and press send.
 */

import { getMissingHiringDetails, type HiringDetailFields } from '../utils/hiringDetails';
import { sendOfferEmailCore } from '../offer/sendOfferEmail';

export interface ReleaseResult {
  sent: boolean;
  error: string | null;
}

/**
 * `stored` is the candidate as it was read; `updates` are the fields a sync
 * just wrote, so the check runs against the merged, current state.
 */
export async function releaseHeldOffer(
  candidateId: string,
  stored: Record<string, unknown>,
  updates: Record<string, unknown>,
  sentBy: string,
): Promise<ReleaseResult> {
  if (stored.status !== 'offer_held') return { sent: false, error: null };

  const merged: HiringDetailFields = {
    viterbitSalary: updates.viterbitSalary ?? stored.viterbitSalary,
    viterbitStartDate: updates.viterbitStartDate ?? stored.viterbitStartDate,
    viterbitBuro: updates.viterbitBuro ?? stored.viterbitBuro,
    viterbitPsicometriaIntegridad:
      updates.viterbitPsicometriaIntegridad ?? stored.viterbitPsicometriaIntegridad,
  };
  if (getMissingHiringDetails(merged).length > 0) return { sent: false, error: null };

  try {
    await sendOfferEmailCore(candidateId, { ...stored, ...updates }, sentBy);
    return { sent: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[releaseHeldOffer] ${candidateId} failed:`, err);
    return { sent: false, error: message };
  }
}
