import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { findOwnerIdByEmail } from '../integrations/hubspotService';
import { SIGNED_STATUSES } from './scheduleChecks';

/** HubSpot lookups run in small parallel batches — enough to be quick, not enough to hammer the API. */
const BATCH_SIZE = 10;

export interface OwnerRecovery {
  /** Candidates with a corporate email but no owner id yet. */
  checked: number;
  /** How many of them HubSpot now recognises. */
  recovered: number;
}

/**
 * Catches up on promoters whose HubSpot account was created but not yet active
 * when they were provisioned.
 *
 * Creating a HubSpot user does not make them an owner: that happens when the
 * person accepts the invitation. provisionAccounts looks the owner id up once,
 * seconds after creating the user, so for anyone who activates later it stores
 * nothing — and until now the only place that looked again was the check of a
 * promoter whose 15/30-day cut was already due. Someone who activates on their
 * third day was therefore counted from scratch by that first due check, while
 * someone who never had a due check stayed invisible.
 *
 * Asking again for everyone who signed keeps the owner id fresh, so the count
 * lands as soon as the person activates rather than whenever their cut arrives.
 */
export async function recoverPendingHubspotOwners(): Promise<OwnerRecovery> {
  const snapshot = await db
    .collection('candidates')
    .where('status', 'in', SIGNED_STATUSES)
    .get();

  const pending = snapshot.docs.filter((doc) => {
    const c = doc.data();
    return !c.hubspotOwnerId && typeof c.corporateEmail === 'string' && c.corporateEmail.trim() !== '';
  });

  let recovered = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const found = await Promise.all(
      batch.map(async (doc) => ({
        doc,
        ownerId: await findOwnerIdByEmail((doc.data().corporateEmail as string).trim()),
      })),
    );

    for (const { doc, ownerId } of found) {
      if (!ownerId) continue;
      await doc.ref.update({
        hubspotOwnerId: ownerId,
        // The block is gone: the next check has someone to count deals for.
        performanceBlockedReason: FieldValue.delete(),
        performanceBlockedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      recovered++;
      console.info(`[recoverHubspotOwners] ${doc.id}: owner ${ownerId} recovered`);
    }
  }

  return { checked: pending.length, recovered };
}
