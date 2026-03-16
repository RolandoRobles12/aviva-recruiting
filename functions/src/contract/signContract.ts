import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { generateContractPdf, generateEvidencePdf, stripHtml } from './contractPdfGenerator';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

async function moveToStage(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage_id: stageId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`moveToStage ${stageId} → HTTP ${resp.status}: ${text}`);
  }
}

// ─── Sign Contract ────────────────────────────────────────────────────────────

export const signContract = onRequest(
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

    // Find candidate by contractToken
    const snap = await db
      .collection('candidates')
      .where('contractToken', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      res.status(404).json({ ok: false, error: 'Contract not found' });
      return;
    }

    const candidateDoc = snap.docs[0];
    const candidateId = candidateDoc.id;
    const candidate = candidateDoc.data();

    if (candidate.status !== 'contract_sent') {
      res.status(409).json({ ok: false, error: 'Contract already signed or invalid status' });
      return;
    }

    const now = new Date();
    const expiresAt = candidate.contractExpiresAt?.toDate?.() as Date | undefined;
    if (expiresAt && now > expiresAt) {
      res.status(410).json({ ok: false, error: 'Contract link has expired' });
      return;
    }

    // Fetch contract template
    const templateId = candidate.contractTemplateId as string | undefined;
    let contractTemplate: Record<string, unknown> | null = null;
    if (templateId) {
      const tSnap = await db.collection('contract_templates').doc(templateId).get();
      if (tSnap.exists) contractTemplate = tSnap.data() as Record<string, unknown>;
    }
    if (!contractTemplate) {
      const allTemplates = await db.collection('contract_templates').limit(1).get();
      if (!allTemplates.empty) contractTemplate = allTemplates.docs[0].data() as Record<string, unknown>;
    }

    const bodyHtml = (contractTemplate?.bodyHtml as string) ?? '<p>Contrato en preparación.</p>';
    const vars: Record<string, string> = {
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
      position: candidate.position as string,
      departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.position as string) || '',
      hiringManager: (candidate.viterbitHiringManager as string) || '',
      company: (candidate.viterbitCompany as string) || 'Aviva',
      salary: (candidate.viterbitSalary as string) || '',
      startDate: (candidate.viterbitStartDate as string) || 'a convenir',
      date: format(now, "d 'de' MMMM 'de' yyyy", { locale: es }),
    };
    const bodyText = stripHtml(interpolate(bodyHtml, vars));

    // Get signer info for evidence
    const signerIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    const signerUserAgent = (req.headers['user-agent'] as string) || 'unknown';

    // Generate signed PDF + evidence
    const { pdfBuffer, evidence } = await generateContractPdf({
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      position: candidate.position as string,
      bodyText,
      signatureBase64,
      signedAt: now,
      signerIp,
      signerUserAgent,
    });

    // Generate evidence certificate PDF
    const evidencePdfBuffer = await generateEvidencePdf(
      evidence,
      `${candidate.firstName} ${candidate.lastName}`,
      candidate.position as string,
    );

    // Upload to Storage
    const bucket = getStorage().bucket();
    const tenYears = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;

    // Signature image
    const sigPath = `candidates/${candidateId}/contract_signature.png`;
    const sigBase64 = signatureBase64.replace(/^data:image\/png;base64,/, '');
    await bucket.file(sigPath).save(Buffer.from(sigBase64, 'base64'), {
      metadata: { contentType: 'image/png' },
    });
    const [sigUrl] = await bucket.file(sigPath).getSignedUrl({ action: 'read', expires: tenYears });

    // Signed contract PDF
    const pdfPath = `candidates/${candidateId}/contrato_firmado.pdf`;
    await bucket.file(pdfPath).save(pdfBuffer, { metadata: { contentType: 'application/pdf' } });
    const [pdfUrl] = await bucket.file(pdfPath).getSignedUrl({ action: 'read', expires: tenYears });

    // Evidence certificate PDF
    const evidencePath = `candidates/${candidateId}/certificado_firma.pdf`;
    await bucket.file(evidencePath).save(evidencePdfBuffer, { metadata: { contentType: 'application/pdf' } });
    const [evidenceUrl] = await bucket.file(evidencePath).getSignedUrl({ action: 'read', expires: tenYears });

    // Move in Viterbit to "Correos" stage
    const apiKey = VITERBIT_API_KEY.value();
    const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
    const correosStageId = stageIds?.correos;
    const candidatureId = candidate.viterbitCandidatureId as string | undefined;

    if (apiKey && correosStageId && candidatureId) {
      try {
        await moveToStage(candidatureId, correosStageId, apiKey);
      } catch (err) {
        console.error('[signContract] moveToStage correos error:', err);
      }
    }

    // Update candidate
    await candidateDoc.ref.update({
      status: 'contract_signed',
      contractSignedAt: now,
      contractSignatureUrl: sigUrl,
      contractPdfUrl: pdfUrl,
      contractEvidenceUrl: evidenceUrl,
      contractEvidence: evidence,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Log
    await db.collection('email_logs').add({
      candidateId,
      templateType: 'contract',
      sentTo: candidate.email,
      sentAt: FieldValue.serverTimestamp(),
      sentBy: 'sign_contract',
      success: true,
      metadata: { evidenceId: evidence.evidenceId },
    });

    res.status(200).json({ ok: true, pdfUrl, evidenceUrl });
  }
);

// ─── Get Contract ─────────────────────────────────────────────────────────────

export const getContract = onRequest(
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
      .where('contractToken', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      res.status(404).json({ ok: false, error: 'Contract not found' });
      return;
    }

    const candidate = snap.docs[0].data();

    if (candidate.status !== 'contract_sent') {
      res.status(409).json({ ok: false, error: 'already_signed' });
      return;
    }

    const expiresAt = candidate.contractExpiresAt?.toDate?.() as Date | undefined;
    if (expiresAt && new Date() > expiresAt) {
      res.status(410).json({ ok: false, error: 'expired' });
      return;
    }

    // Fetch template and render
    const templateId = candidate.contractTemplateId as string | undefined;
    let contractTemplate: Record<string, unknown> | null = null;
    if (templateId) {
      const tSnap = await db.collection('contract_templates').doc(templateId).get();
      if (tSnap.exists) contractTemplate = tSnap.data() as Record<string, unknown>;
    }
    if (!contractTemplate) {
      const allTemplates = await db.collection('contract_templates').limit(1).get();
      if (!allTemplates.empty) contractTemplate = allTemplates.docs[0].data() as Record<string, unknown>;
    }

    const vars: Record<string, string> = {
      firstName: candidate.firstName as string,
      lastName: candidate.lastName as string,
      position: candidate.position as string,
      departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.position as string) || '',
      hiringManager: (candidate.viterbitHiringManager as string) || '',
      company: (candidate.viterbitCompany as string) || 'Aviva',
      salary: (candidate.viterbitSalary as string) || '',
      startDate: (candidate.viterbitStartDate as string) || 'a convenir',
      date: format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es }),
    };

    const rawHtml = (contractTemplate?.bodyHtml as string) ?? '<p>Contrato en preparación.</p>';
    const renderedHtml = rawHtml.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

    res.status(200).json({
      ok: true,
      contract: {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        position: candidate.position,
        salary: (candidate.viterbitSalary as string) || '',
        startDate: (candidate.viterbitStartDate as string) || 'a convenir',
        bodyHtml: renderedHtml,
        expiresAt: expiresAt?.toISOString(),
      },
    });
  }
);
