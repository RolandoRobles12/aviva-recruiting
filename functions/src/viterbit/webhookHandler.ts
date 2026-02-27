import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { createGmailTransport, getFromAddress } from '../email/gmailClient';
import { invitationTemplate } from '../email/templates';

// ─── Config params ─────────────────────────────────────────────────────────────
// VITERBIT_WEBHOOK_SECRET: leave empty if Viterbit does not send a secret header.
const VITERBIT_WEBHOOK_SECRET = defineString('VITERBIT_WEBHOOK_SECRET');
// VITERBIT_API_KEY: API key for calling Viterbit REST API (Settings → API Keys).
const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
// Stage name OR stage ID that triggers the portal. Example: "Documentos"
const HIRING_STAGE_NAME = defineString('HIRING_STAGE_NAME', { default: 'Documentos' });
const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });
// Comma-separated job IDs (or names) to filter. Leave empty to allow all.
// Example: "65f0b66ce4a5529b820ab3a6,otro_id"
const HIRING_JOB_NAMES = defineString('HIRING_JOB_NAMES', { default: '' });

const DOCUMENT_TYPES = ['ine', 'curp', 'rfc', 'comprobante_domicilio', 'comprobante_estudios'];
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function buildInitialDocuments() {
  return Object.fromEntries(
    DOCUMENT_TYPES.map((type) => [type, { id: type, type, status: 'pending' }])
  );
}

// ─── Viterbit webhook payload parser ──────────────────────────────────────────
// Viterbit webhook format (candidature stage changed):
// {
//   "event": "recruitment_candidature_stage_was_changed",
//   "payload": {
//     "id": "<candidature_id>",
//     "current_stage": { "id": "...", "name": "..." },
//     "candidate_id": "<candidate_id>",
//     "job_id": "<job_id>"
//   }
// }
// The webhook does NOT include candidate name/email — those must be fetched via API.
interface ParsedViterbitEvent {
  event: string;
  stageName: string;
  stageId: string;
  candidatureId: string;
  candidateViterbitId: string;
  jobId: string;
}

function parseViterbitPayload(body: Record<string, unknown>): ParsedViterbitEvent | null {
  const event = (body.event as string) ?? (body.type as string) ?? '';

  // Candidature data lives in body.payload
  const payload = (body.payload as Record<string, unknown>) ?? body;

  // Stage info
  const currentStage = (payload.current_stage as Record<string, unknown>) ?? {};
  const stageName = (currentStage.name as string) ?? (currentStage.title as string) ?? '';
  const stageId = (currentStage.id as string) ?? '';

  // IDs
  const candidatureId = (payload.id as string) ?? '';
  const candidateViterbitId = (payload.candidate_id as string) ?? '';
  const jobId = (payload.job_id as string) ?? '';

  if (!candidateViterbitId) return null;

  return { event, stageName, stageId, candidatureId, candidateViterbitId, jobId };
}

// ─── Viterbit API helpers ──────────────────────────────────────────────────────
interface ViterbitCandidate {
  name: string;
  email: string;
  phone?: string;
}

async function fetchViterbitCandidate(
  candidateId: string,
  apiKey: string
): Promise<ViterbitCandidate | null> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidates/${candidateId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) {
      console.error(`[viterbit] fetchCandidate ${candidateId} → HTTP ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;

    const firstName = (data.first_name as string) ?? '';
    const lastName = (data.last_name as string) ?? '';
    const name = (data.name as string) ?? `${firstName} ${lastName}`.trim();
    const email = (data.email as string) ?? '';
    const phone = (data.phone as string) ?? undefined;

    if (!email) return null;
    return { name, email, phone };
  } catch (err) {
    console.error('[viterbit] fetchCandidate error:', err);
    return null;
  }
}

async function fetchViterbitJobTitle(jobId: string, apiKey: string): Promise<string> {
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/jobs/${jobId}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) return jobId;
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    return (data.name as string) ?? (data.title as string) ?? jobId;
  } catch {
    return jobId;
  }
}

// ─── Cloud Function ────────────────────────────────────────────────────────────
export const viterbitWebhook = onRequest(
  { region: 'us-central1' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // Verify webhook secret if configured.
    // Leave VITERBIT_WEBHOOK_SECRET empty to skip this check (Viterbit may not send one).
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

    // Always log raw payload for debugging
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

    const { stageName, stageId, candidatureId, candidateViterbitId, jobId } = parsed;

    // Only trigger when candidate reaches the configured hiring stage.
    // Matches against stage name OR stage id.
    const hiringStage = HIRING_STAGE_NAME.value().toLowerCase();
    const isHiringStage =
      stageName.toLowerCase().includes(hiringStage) ||
      stageId.toLowerCase() === hiringStage;
    if (!isHiringStage) {
      await logRef.update({
        status: 'ignored',
        reason: `stage "${stageName}" (${stageId}) is not the hiring stage`,
      });
      res.status(200).json({ ok: true, action: 'ignored', reason: `stage "${stageName}" skipped` });
      return;
    }

    const apiKey = VITERBIT_API_KEY.value();
    if (!apiKey) {
      await logRef.update({ status: 'error', reason: 'VITERBIT_API_KEY not configured' });
      res.status(500).json({ ok: false, error: 'Server misconfiguration: missing API key' });
      return;
    }

    // Filter by allowed jobs if configured (accepts job IDs or job names, comma-separated).
    const allowedJobs = HIRING_JOB_NAMES.value()
      .split(',')
      .map((j) => j.trim().toLowerCase())
      .filter(Boolean);
    if (allowedJobs.length > 0) {
      // Try to match by job ID first (no extra API call needed)
      let jobTitle = '';
      const matchesById = allowedJobs.some((allowed) => jobId.toLowerCase() === allowed);
      if (!matchesById) {
        // Fetch job title for name-based matching
        jobTitle = await fetchViterbitJobTitle(jobId, apiKey);
        const matchesByName = allowedJobs.some((allowed) =>
          jobTitle.toLowerCase().includes(allowed)
        );
        if (!matchesByName) {
          await logRef.update({
            status: 'ignored',
            reason: `job "${jobTitle}" (${jobId}) not in allowed list`,
          });
          res
            .status(200)
            .json({ ok: true, action: 'ignored', reason: `job "${jobTitle}" not configured` });
          return;
        }
      }
    }

    // Fetch candidate details from Viterbit API
    const viterbitCandidate = await fetchViterbitCandidate(candidateViterbitId, apiKey);
    if (!viterbitCandidate) {
      await logRef.update({
        status: 'error',
        reason: `could not fetch candidate ${candidateViterbitId} from Viterbit API`,
      });
      res.status(200).json({ ok: true, action: 'ignored', reason: 'candidate fetch failed' });
      return;
    }

    const { name: candidateName, email: candidateEmail, phone: candidatePhone } = viterbitCandidate;

    // Idempotency: skip if this Viterbit candidature already has a candidate record
    if (candidatureId) {
      const existing = await db
        .collection('candidates')
        .where('viterbitCandidatureId', '==', candidatureId)
        .limit(1)
        .get();

      if (!existing.empty) {
        await logRef.update({
          status: 'ignored',
          reason: 'candidate already exists',
          candidateId: existing.docs[0].id,
        });
        res.status(200).json({ ok: true, action: 'ignored', reason: 'already created' });
        return;
      }
    }

    // Fetch job title for the invitation email
    const jobTitle = await fetchViterbitJobTitle(jobId, apiKey);

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
      position: jobTitle,
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
      position: jobTitle,
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
  }
);
