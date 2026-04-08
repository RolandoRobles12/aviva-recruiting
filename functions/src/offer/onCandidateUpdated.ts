import * as functions from 'firebase-functions/v1';
import { randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { sendEmail } from '../email/gmailClient';
import { invitationTemplate, contractTemplate } from '../email/templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { getLinkDuration } from '../utils/linkDuration';
import { updateCandidateCompletion } from '../utils/candidates';
import { DOCUMENT_TYPES_REQUIRED } from '../utils/documentTypes';

const APP_URL = process.env.APP_URL ?? 'https://aviva-recruiting.web.app';
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

async function moveToViterbitStage(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: stageId }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`moveToStage ${stageId} → HTTP ${resp.status}: ${text}`);
    }
  } catch (err) {
    console.error('[onCandidateUpdated] moveToViterbitStage error:', err);
  }
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

async function findContractTemplate(
  position: string
): Promise<{ id: string } | null> {
  const snap = await db.collection('contract_templates').get();
  if (snap.empty) return null;
  const posLower = position.toLowerCase();
  for (const doc of snap.docs) {
    const data = doc.data();
    const keywords = (data.positionKeywords as string[]) ?? [];
    if (keywords.some((kw) => posLower.includes(kw.toLowerCase()))) {
      return { id: doc.id };
    }
  }
  return { id: snap.docs[0].id };
}

/**
 * Firestore trigger: reacts to candidate status changes.
 *
 * 1. offer_signed (no formToken) → generate formToken + send invitation email
 * 2. under_review               → generate contractToken + send contract email
 */
export const onCandidateUpdated = functions
  .region('us-central1')
  .firestore.document('candidates/{candidateId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const candidateId = context.params.candidateId;

    const prevStatus = before.status as string;
    const newStatus = after.status as string;

    // ── 0. Recalculate completionPercentage if any document status changed ──
    // This handles admin overrides (e.g. manual Firestore edits or UI button).
    // We skip the update if only completionPercentage itself changed (anti-loop).
    const beforeDocs = (before.documents ?? {}) as Record<string, { status?: string }>;
    const afterDocs = (after.documents ?? {}) as Record<string, { status?: string }>;
    const allDocKeys = new Set([
      ...DOCUMENT_TYPES_REQUIRED,
      'aviso_retencion',
      'estado_cuenta_fonacot',
      ...Object.keys(beforeDocs),
      ...Object.keys(afterDocs),
    ]);
    const docStatusChanged = [...allDocKeys].some(
      (k) => beforeDocs[k]?.status !== afterDocs[k]?.status,
    );
    if (docStatusChanged) {
      // updateCandidateCompletion reads fresh data and writes completionPercentage + status.
      // Since it reads from Firestore, it's safe to call even mid-trigger.
      await updateCandidateCompletion(candidateId);
    }

    // ── 1. offer_signed without formToken → generate form link + send invitation ──
    if (newStatus === 'offer_signed' && !after.formToken) {
      try {
        const now = new Date();
        const linkDurations = await getLinkDuration();
        const formToken = generateToken();
        const formExpiresAt = new Date(now.getTime() + linkDurations.formDays * 24 * 60 * 60 * 1000);

        await change.after.ref.update({
          formToken,
          formExpiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        });

        const appUrl = APP_URL;
        const formUrl = `${appUrl}/form/${formToken}`;
        const formExpiresAtStr = format(formExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

        const { subject, html } = invitationTemplate({
          firstName: after.firstName as string,
          lastName: after.lastName as string,
          position: after.position as string,
          formUrl,
          formExpiresAt: formExpiresAtStr,
        });

        const createdBy = after.createdBy as string;
        const senderEmail = await getRecruiterEmail(createdBy);
        await sendEmail({
          to: after.email as string,
          subject,
          html,
          senderEmail,
          recruiterUid: createdBy !== 'viterbit_webhook' ? createdBy : undefined,
        });

        await db.collection('email_logs').add({
          candidateId,
          templateType: 'invitation',
          sentTo: after.email,
          sentAt: FieldValue.serverTimestamp(),
          sentBy: 'onCandidateUpdated_offer_signed',
          success: true,
        });

        console.log(`[onCandidateUpdated] formToken generated for ${candidateId}`);
      } catch (err) {
        console.error(`[onCandidateUpdated] formToken generation error for ${candidateId}:`, err);
        await db.collection('email_logs').add({
          candidateId,
          templateType: 'invitation',
          sentTo: after.email,
          sentAt: FieldValue.serverTimestamp(),
          sentBy: 'onCandidateUpdated_offer_signed',
          success: false,
          error: String(err),
        });
      }
    }

    // ── 2. under_review → auto-generate contract link + send contract email ──
    if (prevStatus !== 'under_review' && newStatus === 'under_review') {
      // Skip if contractToken already exists (e.g. set by Viterbit webhook)
      if (after.contractToken) return null;


      try {
        const now = new Date();
        const linkDurations = await getLinkDuration();
        const contractTokenValue = generateToken();
        const contractExpiresAt = new Date(now.getTime() + linkDurations.contractDays * 24 * 60 * 60 * 1000);

        const templateMatch = await findContractTemplate(after.position as string ?? '');

        await change.after.ref.update({
          status: 'contract_sent',
          contractToken: contractTokenValue,
          contractExpiresAt,
          contractTemplateId: templateMatch?.id ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        });

        const appUrl = APP_URL;
        const contractUrl = `${appUrl}/contract/${contractTokenValue}`;
        const contractExpiresAtStr = format(contractExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

        const { subject, html } = contractTemplate({
          firstName: after.firstName as string,
          lastName: after.lastName as string,
          position: after.position as string,
          contractUrl,
          contractExpiresAt: contractExpiresAtStr,
        });

        await sendEmail({ to: after.email as string, subject, html });

        await db.collection('email_logs').add({
          candidateId,
          templateType: 'contract',
          sentTo: after.email,
          sentAt: FieldValue.serverTimestamp(),
          sentBy: 'onCandidateUpdated_under_review',
          success: true,
        });

        console.log(`[onCandidateUpdated] contractToken generated for ${candidateId}`);

        // Move candidate to "Contrato" stage in Viterbit
        const viterbitApiKey = process.env.VITERBIT_API_KEY;
        const viterbitCandidatureId = after.viterbitCandidatureId as string | undefined;
        const viterbitStageIds = after.viterbitStageIds as Record<string, string> | undefined;
        const contratoStageId = viterbitStageIds?.contrato;
        if (viterbitApiKey && viterbitCandidatureId && contratoStageId) {
          void moveToViterbitStage(viterbitCandidatureId, contratoStageId, viterbitApiKey);
        }
      } catch (err) {
        console.error(`[onCandidateUpdated] contractToken generation error for ${candidateId}:`, err);
        await db.collection('email_logs').add({
          candidateId,
          templateType: 'contract',
          sentTo: after.email,
          sentAt: FieldValue.serverTimestamp(),
          sentBy: 'onCandidateUpdated_under_review',
          success: false,
          error: String(err),
        });
      }
    }

    return null;
  });
