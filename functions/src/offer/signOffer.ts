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
import { getLinkDuration } from '../utils/linkDuration';
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

// Maps Viterbit ${variable} names (from Word templates) to system variable names.
const VITERBIT_VAR_MAP: Record<string, string> = {
  name:                       'name',
  first_name:                 'firstName',
  last_name:                  'lastName',
  job_department_profile:     'departmentProfile',
  custom_job_empresa:         'company',
  custom_job_hiring_manager:  'hiringManager',
  hired_start_date_job:       'startDate',
  hired_salary_job:           'salary',
  position:                   'position',
  date:                       'date',
  benefits:                   'benefits',
};

function interpolate(template: string, vars: Record<string, string>): string {
  // Replace {{variable}} patterns (system syntax)
  let result = template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  // Replace ${variable} patterns (Viterbit / Word syntax)
  result = result.replace(/\$\{\s*(\w+)\s*\}/g, (_, key: string) => {
    const systemKey = VITERBIT_VAR_MAP[key] ?? key;
    return vars[systemKey] ?? '';
  });
  return result;
}

// ─── Default offer letter body (matches Carta Oferta design) ─────────────────

const DEFAULT_OFFER_BODY_HTML = `
<p>Bienvenido/a {{name}},</p>
<p>Después de escuchar tu historia, tu trayectoria y lo que te mueve, estamos convencidos de que tu talento puede ayudarnos a hacer realidad nuestra misión. Hoy queremos darte un paso más y compartirte nuestra carta oferta.</p>
<p>I. Posición y organización</p>
<p><strong>Puesto:</strong> {{position}}<br>
<strong>Empresa:</strong> Aviva Financial S.A. de C.V. SOFOM ENR<br>
<strong>Líder:</strong> {{hiringManager}}<br>
<strong>Fecha de inicio:</strong> {{startDate}}</p>
<p>II. Compensación y beneficios</p>
<p><strong>Sueldo Bruto:</strong> {{salary}}</p>
<p>Esta oferta está sujeta a la satisfactoria entrega y validación de tu documentación de ingreso.</p>
<p>Atentamente,</p>
<p><strong>Equipo de Reclutamiento · Aviva</strong></p>
`;

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
    const bodyHtml    = DEFAULT_OFFER_BODY_HTML;

    const firstNameVal = (candidate.firstName as string) || '';
    const lastNameVal  = (candidate.lastName  as string) || '';
    const vars: Record<string, string> = {
      name:      `${firstNameVal} ${lastNameVal}`.trim(),
      firstName: firstNameVal,
      lastName:  lastNameVal,
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
    const linkDurations = await getLinkDuration();
    const formExpiresAt = new Date(now.getTime() + linkDurations.formDays * 24 * 60 * 60 * 1000);

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
      const createdBy = candidate.createdBy as string;
      const senderEmail = await getRecruiterEmail(createdBy);
      await sendEmail({
        to: candidate.email as string,
        subject,
        html,
        senderEmail,
        recruiterUid: createdBy !== 'viterbit_webhook' ? createdBy : undefined,
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

    const firstNameVal = (candidate.firstName as string) || '';
    const lastNameVal  = (candidate.lastName  as string) || '';
    const vars: Record<string, string> = {
      name:      `${firstNameVal} ${lastNameVal}`.trim(),
      firstName: firstNameVal,
      lastName:  lastNameVal,
      position:  candidate.position  as string,
      departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.position as string) || '',
      hiringManager:     (candidate.viterbitHiringManager     as string) || '',
      company:           (candidate.viterbitCompany           as string) || 'Aviva',
      salary:    offerSalary,
      benefits:  offerBenefits,
      startDate: offerStartDate,
      date: format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es }),
    };

    const rawHtml = DEFAULT_OFFER_BODY_HTML;
    const renderedHtml = interpolate(rawHtml, vars);

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
