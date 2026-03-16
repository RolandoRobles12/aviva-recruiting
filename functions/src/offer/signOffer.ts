import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { sendEmail } from '../email/gmailClient';
import { invitationTemplate } from '../email/templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { generateOfferPdf, stripHtml } from './pdfGenerator';

const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });
const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

// ─── Viterbit API ─────────────────────────────────────────────────────────────

async function moveToStage(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage_id: stageId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Viterbit moveToStage ${stageId} → HTTP ${resp.status}: ${text}`);
  }
}

// ─── Helper: interpolate template variables ────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ─── Cloud Function ────────────────────────────────────────────────────────────

export const signOffer = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const { token, signatureBase64 } = req.body as { token?: string; signatureBase64?: string };

    if (!token || !signatureBase64) {
      res.status(400).json({ ok: false, error: 'token and signatureBase64 are required' });
      return;
    }

    // ── Find candidate by offerToken ────────────────────────────────────────────
    const snap = await db
      .collection('candidates')
      .where('offerToken', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      res.status(404).json({ ok: false, error: 'Offer not found' });
      return;
    }

    const candidateDoc = snap.docs[0];
    const candidateId = candidateDoc.id;
    const candidate = candidateDoc.data();

    if (candidate.status !== 'offer_sent') {
      res.status(409).json({ ok: false, error: 'Offer already signed or invalid status' });
      return;
    }

    const now = new Date();
    const expiresAt = candidate.offerExpiresAt?.toDate?.() as Date | undefined;
    if (expiresAt && now > expiresAt) {
      res.status(410).json({ ok: false, error: 'Offer link has expired' });
      return;
    }

    // ── Fetch offer template ────────────────────────────────────────────────────
    const templateId = candidate.offerTemplateId as string | undefined;
    let offerTemplate: Record<string, unknown> | null = null;
    if (templateId) {
      const tSnap = await db.collection('offer_templates').doc(templateId).get();
      if (tSnap.exists) offerTemplate = tSnap.data() as Record<string, unknown>;
    }
    // Fallback: find any template matching the position
    if (!offerTemplate) {
      const allTemplates = await db.collection('offer_templates').limit(1).get();
      if (!allTemplates.empty) offerTemplate = allTemplates.docs[0].data() as Record<string, unknown>;
    }

    // Viterbit job fields take priority; template fields are fallbacks
    const salary      = (candidate.viterbitSalary      as string) || (offerTemplate?.salary      as string) || '';
    const startDate   = (candidate.viterbitStartDate   as string) || (offerTemplate?.startDate   as string) || 'a convenir';
    const hiringManager     = (candidate.viterbitHiringManager     as string) || '';
    const company           = (candidate.viterbitCompany           as string) || 'Aviva';
    const departmentProfile = (candidate.viterbitDepartmentProfile as string) || (candidate.position as string) || '';
    const benefits    = (offerTemplate?.benefits as string) ?? '';
    const bodyHtml    = (offerTemplate?.bodyHtml as string) ?? '';

    const vars: Record<string, string> = {
      firstName: candidate.firstName as string,
      lastName:  candidate.lastName  as string,
      position:  candidate.position  as string,
      departmentProfile,
      hiringManager,
      company,
      salary,
      benefits,
      startDate,
      date: format(now, "d 'de' MMMM 'de' yyyy", { locale: es }),
    };
    const bodyText = stripHtml(interpolate(bodyHtml, vars));

    // ── Generate PDF ────────────────────────────────────────────────────────────
    const pdfBuffer = await generateOfferPdf({
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      position: candidate.position as string,
      salary,
      benefits,
      startDate,
      bodyText,
      signatureBase64,
      signedAt: now,
    });

    // ── Upload signature image & PDF to Storage ─────────────────────────────────
    const bucket = getStorage().bucket();

    const sigPath = `candidates/${candidateId}/offer_signature.png`;
    const sigBase64 = signatureBase64.replace(/^data:image\/png;base64,/, '');
    await bucket.file(sigPath).save(Buffer.from(sigBase64, 'base64'), {
      metadata: { contentType: 'image/png' },
    });
    const [sigUrl] = await bucket.file(sigPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000, // 10 years
    });

    const pdfPath = `candidates/${candidateId}/carta_oferta_firmada.pdf`;
    await bucket.file(pdfPath).save(pdfBuffer, { metadata: { contentType: 'application/pdf' } });
    const [pdfUrl] = await bucket.file(pdfPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    });

    // ── Move candidate in Viterbit to "Documentos" ──────────────────────────────
    const apiKey = VITERBIT_API_KEY.value();
    const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
    const documentosStageId = stageIds?.documentos;
    const candidatureId = candidate.viterbitCandidatureId as string | undefined;

    if (apiKey && documentosStageId && candidatureId) {
      try {
        await moveToStage(candidatureId, documentosStageId, apiKey);
      } catch (err) {
        console.error('[signOffer] moveToStage documentos error:', err);
        // Non-fatal: continue so candidate is not blocked
      }
    }

    // ── Generate documents form token ───────────────────────────────────────────
    const crypto = await import('crypto');
    const formToken = crypto.randomBytes(32).toString('hex');
    const formExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // ── Update candidate in Firestore ───────────────────────────────────────────
    await candidateDoc.ref.update({
      status: 'offer_signed',
      offerSignedAt: now,
      offerSignatureUrl: sigUrl,
      offerPdfUrl: pdfUrl,
      formToken,
      formExpiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // ── Send documents invitation email ─────────────────────────────────────────
    const appUrl = APP_URL.value();
    const formUrl = `${appUrl}/form/${formToken}`;
    const formExpiresAtStr = format(formExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });

    const { subject, html } = invitationTemplate({
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
      position: candidate.position as string,
      formUrl,
      formExpiresAt: formExpiresAtStr,
    });

    try {
      const senderEmail = await getRecruiterEmail(candidate.createdBy as string);
      await sendEmail({
        to: candidate.email as string,
        subject,
        html,
        senderEmail,
      });
      await db.collection('email_logs').add({
        candidateId,
        templateType: 'invitation',
        sentTo: candidate.email,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'sign_offer',
        success: true,
      });
    } catch (emailErr) {
      console.error('[signOffer] send invitation email error:', emailErr);
      await db.collection('email_logs').add({
        candidateId,
        templateType: 'invitation',
        sentTo: candidate.email,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'sign_offer',
        success: false,
        error: String(emailErr),
      });
    }

    res.status(200).json({ ok: true, pdfUrl });
  }
);

// ─── Public endpoint: get offer data by token ─────────────────────────────────

export const getOffer = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const token = req.query['token'] as string | undefined;
    if (!token) {
      res.status(400).json({ ok: false, error: 'token is required' });
      return;
    }

    const snap = await db
      .collection('candidates')
      .where('offerToken', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      res.status(404).json({ ok: false, error: 'Offer not found' });
      return;
    }

    const candidate = snap.docs[0].data();

    if (candidate.status !== 'offer_sent') {
      res.status(409).json({ ok: false, error: 'already_signed' });
      return;
    }

    const expiresAt = candidate.offerExpiresAt?.toDate?.() as Date | undefined;
    if (expiresAt && new Date() > expiresAt) {
      res.status(410).json({ ok: false, error: 'expired' });
      return;
    }

    // Fetch offer template
    const templateId = candidate.offerTemplateId as string | undefined;
    let offerTemplate: Record<string, unknown> | null = null;
    if (templateId) {
      const tSnap = await db.collection('offer_templates').doc(templateId).get();
      if (tSnap.exists) offerTemplate = tSnap.data() as Record<string, unknown>;
    }
    if (!offerTemplate) {
      const allTemplates = await db.collection('offer_templates').limit(1).get();
      if (!allTemplates.empty) offerTemplate = allTemplates.docs[0].data() as Record<string, unknown>;
    }

    const offerSalary    = (candidate.viterbitSalary      as string) || (offerTemplate?.salary    as string) || '';
    const offerStartDate = (candidate.viterbitStartDate   as string) || (offerTemplate?.startDate as string) || 'a convenir';
    const offerBenefits  = (offerTemplate?.benefits as string) ?? '';

    const vars: Record<string, string> = {
      firstName: candidate.firstName as string,
      lastName:  candidate.lastName  as string,
      position:  candidate.position  as string,
      departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.position as string) || '',
      hiringManager:     (candidate.viterbitHiringManager     as string) || '',
      company:           (candidate.viterbitCompany           as string) || 'Aviva',
      salary:    offerSalary,
      benefits:  offerBenefits,
      startDate: offerStartDate,
      date: format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es }),
    };

    const rawHtml = (offerTemplate?.bodyHtml as string) ?? '<p>Carta oferta en preparación.</p>';
    const renderedHtml = rawHtml.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

    res.status(200).json({
      ok: true,
      offer: {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        position: candidate.position,
        salary: offerSalary,
        benefits: offerBenefits,
        startDate: offerStartDate,
        bodyHtml: renderedHtml,
        expiresAt: expiresAt?.toISOString(),
      },
    });
  }
);
