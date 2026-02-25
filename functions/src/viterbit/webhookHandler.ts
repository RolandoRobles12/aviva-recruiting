import * as functions from 'firebase-functions/v1';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { createGmailTransport, getFromAddress } from '../email/gmailClient';
import { invitationTemplate } from '../email/templates';

// ─── Config params — set with: firebase functions:config:set ──────────────────
const VITERBIT_WEBHOOK_SECRET = defineString('VITERBIT_WEBHOOK_SECRET');
const HIRING_STAGE_NAME = defineString('HIRING_STAGE_NAME', { default: 'Contratación' });
const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });

const DOCUMENT_TYPES = ['ine', 'curp', 'rfc', 'comprobante_domicilio', 'comprobante_estudios'];

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function buildInitialDocuments() {
  return Object.fromEntries(
    DOCUMENT_TYPES.map((type) => [type, { id: type, type, status: 'pending' }])
  );
}

// ─── Viterbit payload parser ───────────────────────────────────────────────────
// Flexible parsing to handle possible variations in Viterbit's webhook format.
// The raw payload is always stored in viterbit_webhook_logs for debugging.
interface ParsedViterbitEvent {
  event: string;
  stageName: string;
  candidatureId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string;
  jobTitle: string;
}

function parseViterbitPayload(body: Record<string, unknown>): ParsedViterbitEvent | null {
  const event =
    (body.event as string) ??
    (body.type as string) ??
    (body.action as string) ??
    '';

  // Navigate to candidature — Viterbit may nest it under 'data' or at the root
  const data = (body.data as Record<string, unknown>) ?? body;
  const candidature = (data.candidature as Record<string, unknown>) ?? data;

  // Stage
  const stage = (candidature.stage as Record<string, unknown>) ?? {};
  const stageName =
    (stage.name as string) ??
    (stage.title as string) ??
    (candidature.stage_name as string) ??
    '';

  // Candidature ID (used for idempotency)
  const candidatureId =
    (candidature.id as string) ??
    (candidature.uuid as string) ??
    (data.id as string) ??
    '';

  // Candidate personal data
  const candidateObj = (candidature.candidate as Record<string, unknown>) ?? {};
  const firstName = (candidateObj.first_name as string) ?? '';
  const lastName = (candidateObj.last_name as string) ?? '';
  const candidateName =
    (candidateObj.name as string) ??
    `${firstName} ${lastName}`.trim();
  const candidateEmail =
    (candidateObj.email as string) ??
    (candidateObj.email_address as string) ??
    '';
  const candidatePhone =
    (candidateObj.phone as string) ??
    (candidateObj.phone_number as string) ??
    undefined;

  // Job / position
  const job =
    (candidature.job as Record<string, unknown>) ??
    (candidature.position as Record<string, unknown>) ??
    (candidature.vacancy as Record<string, unknown>) ??
    {};
  const jobTitle =
    (job.name as string) ??
    (job.title as string) ??
    (candidature.job_title as string) ??
    '';

  if (!candidateEmail) return null;

  return { event, stageName, candidatureId, candidateName, candidateEmail, candidatePhone, jobTitle };
}

// ─── Cloud Function ────────────────────────────────────────────────────────────
export const viterbitWebhook = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // Verify webhook secret sent by Viterbit
    // Configure the secret in: Viterbit → Webhooks → Secret
    // Set it here with: firebase functions:config:set VITERBIT_WEBHOOK_SECRET="your_secret"
    const secret = VITERBIT_WEBHOOK_SECRET.value();
    if (secret) {
      const received =
        (req.headers['x-viterbit-secret'] as string) ??
        (req.headers['x-webhook-secret'] as string) ??
        '';
      if (received !== secret) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
    }

    const body = req.body as Record<string, unknown>;

    // Always log raw payload — helps debug Viterbit's exact format
    const logRef = await db.collection('viterbit_webhook_logs').add({
      payload: body,
      receivedAt: FieldValue.serverTimestamp(),
    });

    const parsed = parseViterbitPayload(body);
    if (!parsed) {
      await logRef.update({ status: 'ignored', reason: 'could not parse payload' });
      res.status(200).json({ ok: true, action: 'ignored', reason: 'unparseable payload' });
      return;
    }

    const {
      stageName,
      candidatureId,
      candidateName,
      candidateEmail,
      candidatePhone,
      jobTitle,
    } = parsed;

    // Only trigger when candidate reaches the configured hiring stage
    const hiringStage = HIRING_STAGE_NAME.value();
    const isHiringStage = stageName.toLowerCase().includes(hiringStage.toLowerCase());
    if (!isHiringStage) {
      await logRef.update({ status: 'ignored', reason: `stage "${stageName}" is not the hiring stage` });
      res.status(200).json({ ok: true, action: 'ignored', reason: `stage "${stageName}" skipped` });
      return;
    }

    // Idempotency: skip if this Viterbit candidature already has a candidate record
    if (candidatureId) {
      const existing = await db
        .collection('candidates')
        .where('viterbitCandidatureId', '==', candidatureId)
        .limit(1)
        .get();

      if (!existing.empty) {
        await logRef.update({ status: 'ignored', reason: 'candidate already exists', candidateId: existing.docs[0].id });
        res.status(200).json({ ok: true, action: 'ignored', reason: 'already created' });
        return;
      }
    }

    // Split full name into first / last
    const nameParts = candidateName.trim().split(/\s+/);
    const firstName = nameParts[0] ?? candidateName;
    const lastName = nameParts.slice(1).join(' ') || '';

    // Create candidate document
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const candidateRef = db.collection('candidates').doc();
    await candidateRef.set({
      firstName,
      lastName,
      email: candidateEmail,
      phone: candidatePhone ?? null,
      position: jobTitle || 'Sin especificar',
      status: 'invited',
      formToken: token,
      formExpiresAt: expiresAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: 'viterbit_webhook',
      documents: buildInitialDocuments(),
      completionPercentage: 0,
      reminderCount: 0,
      viterbitCandidatureId: candidatureId || null,
    });

    // Send invitation email
    const appUrl = APP_URL.value();
    const formUrl = `${appUrl}/form/${token}`;
    const formExpiresAt = format(expiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

    const { subject, html } = invitationTemplate({
      firstName,
      lastName,
      position: jobTitle || 'Sin especificar',
      formUrl,
      formExpiresAt,
    });

    const transport = await createGmailTransport();
    await transport.sendMail({
      from: getFromAddress(),
      to: candidateEmail,
      subject,
      html,
    });

    await db.collection('email_logs').add({
      candidateId: candidateRef.id,
      templateType: 'invitation',
      sentTo: candidateEmail,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: 'viterbit_webhook',
      success: true,
    });

    await logRef.update({ status: 'processed', candidateId: candidateRef.id });

    res.status(200).json({ ok: true, action: 'created', candidateId: candidateRef.id });
  });
