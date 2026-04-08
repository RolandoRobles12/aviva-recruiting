import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { generateContractPdf, generateEvidencePdf, stripHtml } from './contractPdfGenerator';
import { generatePdfContract, extractInitials } from './pdfTemplateProcessor';
import type { PdfFieldPosition, PdfVariableMapping } from './pdfTemplateProcessor';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

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
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 300 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const { token, signatureBase64, initialsBase64 } = req.body as {
      token?: string;
      signatureBase64?: string;
      initialsBase64?: string;
    };
    if (!token || !signatureBase64) {
      res.status(400).json({ ok: false, error: 'token and signatureBase64 are required' });
      return;
    }

    try {
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

    const firstNameVal = (candidate.firstName as string) || '';
    const lastNameVal  = (candidate.lastName  as string) || '';
    const candidateFullName = `${firstNameVal} ${lastNameVal}`.trim();
    const candidateInitials = extractInitials(candidateFullName);

    const vars: Record<string, string> = {
      name: candidateFullName,
      firstName: firstNameVal,
      lastName: lastNameVal,
      position: candidate.position as string,
      departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.position as string) || '',
      hiringManager: (candidate.viterbitHiringManager as string) || '',
      company: (candidate.viterbitCompany as string) || 'Aviva',
      salary: (candidate.viterbitSalary as string) || '',
      startDate: (candidate.viterbitStartDate as string) || 'a convenir',
      benefits: (candidate.benefits as string) || '',
      date: format(now, "d 'de' MMMM 'de' yyyy", { locale: es }),
    };

    // Get signer info for evidence
    const signerIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    const signerUserAgent = (req.headers['user-agent'] as string) || 'unknown';

    const templateType = (contractTemplate?.templateType as string) || 'html';

    let pdfBuffer: Buffer;
    let evidence: import('./contractPdfGenerator').SigningEvidence;

    if (templateType === 'pdf' && contractTemplate?.pdfStoragePath) {
      // ── PDF-based template ──
      const bucket = getStorage().bucket();
      const [pdfTemplateBytes] = await bucket.file(contractTemplate.pdfStoragePath as string).download();

      const signatureFields = (contractTemplate.signatureFields as PdfFieldPosition[] | undefined) ?? [];
      const variableMappings = (contractTemplate.variableMappings as PdfVariableMapping[] | undefined) ?? [];
      const initialsOnEveryPage = (contractTemplate.initialsOnEveryPage as boolean) ?? true;
      const initialsPosition = contractTemplate.initialsPosition as
        { x: number; y: number; width: number; height: number } | undefined;

      const result = await generatePdfContract({
        templatePdfBytes: Buffer.from(pdfTemplateBytes),
        candidateName: candidateFullName,
        candidateInitials,
        position: candidate.position as string,
        signatureBase64,
        initialsBase64: initialsBase64 || undefined,
        signedAt: now,
        signerIp,
        signerUserAgent,
        variables: vars,
        signatureFields,
        variableMappings,
        initialsOnEveryPage,
        initialsPosition,
      });
      pdfBuffer = result.pdfBuffer;
      evidence = result.evidence;
    } else {
      // ── HTML-based template (original flow) ──
      const bodyHtml = (contractTemplate?.bodyHtml as string) ?? '<p>Contrato en preparación.</p>';
      const bodyText = stripHtml(interpolate(bodyHtml, vars));

      const result = await generateContractPdf({
        candidateName: candidateFullName,
        position: candidate.position as string,
        bodyText,
        signatureBase64,
        signedAt: now,
        signerIp,
        signerUserAgent,
        candidateInitials,
        initialsBase64: initialsBase64 || undefined,
      });
      pdfBuffer = result.pdfBuffer;
      evidence = result.evidence;
    }

    // Generate evidence certificate PDF
    const evidencePdfBuffer = await generateEvidencePdf(
      evidence,
      candidateFullName,
      candidate.position as string,
    );

    // Upload to Storage
    const bucket = getStorage().bucket();
    const uploadedPaths: string[] = [];

    // Signature image
    const sigPath = `candidates/${candidateId}/contract_signature.png`;
    const sigBase64 = signatureBase64.replace(/^data:image\/png;base64,/, '');
    const sigFile = bucket.file(sigPath);
    await sigFile.save(Buffer.from(sigBase64, 'base64'), {
      metadata: { contentType: 'image/png' },
    });
    await sigFile.makePublic();
    const sigUrl = sigFile.publicUrl();
    uploadedPaths.push(sigPath);

    // Signed contract PDF
    const pdfPath = `candidates/${candidateId}/contrato_firmado.pdf`;
    const pdfFile = bucket.file(pdfPath);
    await pdfFile.save(pdfBuffer, { metadata: { contentType: 'application/pdf' } });
    await pdfFile.makePublic();
    const pdfUrl = pdfFile.publicUrl();
    uploadedPaths.push(pdfPath);

    // Evidence certificate PDF
    const evidencePath = `candidates/${candidateId}/certificado_firma.pdf`;
    const evidenceFile = bucket.file(evidencePath);
    await evidenceFile.save(evidencePdfBuffer, { metadata: { contentType: 'application/pdf' } });
    await evidenceFile.makePublic();
    const evidenceUrl = evidenceFile.publicUrl();
    uploadedPaths.push(evidencePath);

    // Update Firestore FIRST — then trigger Viterbit move.
    // Order matters: if we moved Viterbit first, the "Correos" webhook could fire
    // and overwrite the status with 'email_pending' before we set 'contract_signed'.
    try {
      await candidateDoc.ref.update({
        status: 'contract_signed',
        contractSignedAt: now,
        contractSignatureUrl: sigUrl,
        contractPdfUrl: pdfUrl,
        contractEvidenceUrl: evidenceUrl,
        contractEvidence: evidence,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (firestoreErr) {
      console.error('[signContract] Firestore update failed, cleaning up Storage files:', firestoreErr);
      await Promise.allSettled(uploadedPaths.map((p) => bucket.file(p).delete()));
      throw firestoreErr;
    }

    // Move in Viterbit to "Correos" stage (fire-and-forget after Firestore is saved)
    const apiKey = VITERBIT_API_KEY.value();
    const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
    const correosStageId = stageIds?.correos;
    const candidatureId = candidate.viterbitCandidatureId as string | undefined;

    if (apiKey && correosStageId && candidatureId) {
      void moveToStage(candidatureId, correosStageId, apiKey).catch((err) =>
        console.error('[signContract] moveToStage correos error:', err)
      );
    }

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
    } catch (err) {
      console.error('[signContract] Unhandled error:', err);
      res.status(500).json({
        ok: false,
        error: 'Ocurrió un error al procesar tu firma. Por favor intenta de nuevo. Si el problema persiste, contacta a tu reclutador.',
      });
    }
  }
);

// ─── Get Contract ─────────────────────────────────────────────────────────────

export const getContract = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public' },
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

    const firstNameVal2 = (candidate.firstName as string) || '';
    const lastNameVal2  = (candidate.lastName  as string) || '';
    const vars: Record<string, string> = {
      name: `${firstNameVal2} ${lastNameVal2}`.trim(),
      firstName: firstNameVal2,
      lastName: lastNameVal2,
      position: candidate.position as string,
      departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.position as string) || '',
      hiringManager: (candidate.viterbitHiringManager as string) || '',
      company: (candidate.viterbitCompany as string) || 'Aviva',
      salary: (candidate.viterbitSalary as string) || '',
      startDate: (candidate.viterbitStartDate as string) || 'a convenir',
      benefits: (candidate.benefits as string) || '',
      date: format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es }),
    };

    const templateType2 = (contractTemplate?.templateType as string) || 'html';
    const rawHtml = (contractTemplate?.bodyHtml as string) ?? '<p>Contrato en preparación.</p>';
    const renderedHtml = interpolate(rawHtml, vars);

    // For PDF templates, generate a public URL so the candidate can view the PDF
    let pdfPreviewUrl: string | undefined;
    if (templateType2 === 'pdf' && contractTemplate?.pdfStoragePath) {
      const bucket = getStorage().bucket();
      const templateFile = bucket.file(contractTemplate.pdfStoragePath as string);
      await templateFile.makePublic();
      pdfPreviewUrl = templateFile.publicUrl();
    }

    res.status(200).json({
      ok: true,
      contract: {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        position: candidate.position,
        salary: (candidate.viterbitSalary as string) || '',
        startDate: (candidate.viterbitStartDate as string) || 'a convenir',
        templateType: templateType2,
        bodyHtml: renderedHtml,
        pdfPreviewUrl,
        pdfPageCount: (contractTemplate?.pdfPageCount as number) || undefined,
        expiresAt: expiresAt?.toISOString(),
      },
    });
  }
);
