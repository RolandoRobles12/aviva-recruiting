import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../utils/admin';
import { countDealsByOwner } from '../integrations/hubspotService';
import { notifyPerformanceCheck } from '../integrations/slackService';

const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });

// ─── Monthly deal targets per company/department ──────────────────────────────
// Source: "Meta de solicitudes durante el primer mes calendario completo"
const DEAL_TARGETS: Record<string, number> = {
  'aviva contigo':    72,
  'aviva tu negocio': 17,
  'aviva tu compra':  34,
  'construrama':      17,
  'casa marchand':    17,
};

function getMonthlyTarget(viterbitCompany: string, profile: string): number {
  const key = (viterbitCompany || profile || '').toLowerCase();
  for (const [name, target] of Object.entries(DEAL_TARGETS)) {
    if (key.includes(name)) return target;
  }
  // Fallback matches by profile keyword
  if (key.includes('negocio')) return 17;
  if (key.includes('compra'))  return 34;
  return 17;
}

// Return YYYY-MM-DD for (today - n days) in UTC
function dateStrDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}

async function runCheck(daysMark: 15 | 30): Promise<void> {
  const targetDate = dateStrDaysAgo(daysMark);
  const appUrl = APP_URL.value();

  // Find candidates whose official start date was exactly N days ago
  const snap = await db
    .collection('candidates')
    .where('viterbitStartDate', '==', targetDate)
    .get();

  if (snap.empty) return;

  const alreadyCheckedField = daysMark === 15 ? 'performance15DayCheckedAt' : 'performance30DayCheckedAt';
  const dealCountField      = daysMark === 15 ? 'performance15DayDeals'      : 'performance30DayDeals';

  for (const doc of snap.docs) {
    const c = doc.data();

    // Skip if already checked (handles retries / duplicate scheduler runs)
    if (c[alreadyCheckedField]) continue;

    const hubspotOwnerId = c.hubspotOwnerId as string | undefined;
    if (!hubspotOwnerId) {
      console.warn(`[performanceCheck] ${doc.id} has no hubspotOwnerId — skipping`);
      continue;
    }

    // Count deals from start date up to now
    const startDateMs = new Date(targetDate + 'T00:00:00Z').getTime();
    let dealCount = 0;
    try {
      dealCount = await countDealsByOwner(hubspotOwnerId, startDateMs);
    } catch (err) {
      console.error(`[performanceCheck] HubSpot error for ${doc.id}:`, err);
      continue;
    }

    const company      = (c.viterbitCompany as string)         || '';
    const profile      = (c.profile        as string)         || (c.position as string) || '';
    const monthlyTarget = getMonthlyTarget(company, profile);
    const candidateName = `${c.firstName as string} ${c.lastName as string}`.trim();

    // Save result before sending Slack (idempotency)
    await doc.ref.update({
      [alreadyCheckedField]: FieldValue.serverTimestamp(),
      [dealCountField]:      dealCount,
      updatedAt:             FieldValue.serverTimestamp(),
    });

    // Slack notification
    try {
      await notifyPerformanceCheck({
        candidateId:   doc.id,
        candidateName,
        company,
        profile,
        daysMark,
        dealCount,
        monthlyTarget,
        startDate:     targetDate,
        appUrl,
      });
    } catch (err) {
      console.error(`[performanceCheck] Slack error for ${doc.id}:`, err);
    }

    console.log(`[performanceCheck] ${daysMark}d check for ${candidateName}: ${dealCount}/${monthlyTarget} deals`);
  }
}

/**
 * Runs daily at 09:00 Mexico City time.
 * Checks candidates whose viterbitStartDate was 15 or 30 days ago and sends
 * a Slack performance alert with their HubSpot deal count vs. monthly target.
 */
export const dailyPerformanceCheck = onSchedule(
  {
    schedule: 'every day 09:00',
    timeZone: 'America/Mexico_City',
    region:   'us-central1',
    memory:   '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    await Promise.allSettled([
      runCheck(15),
      runCheck(30),
    ]);
  },
);
