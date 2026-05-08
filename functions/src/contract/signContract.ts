import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../utils/admin';
import { generateContractPdf, generateEvidencePdf, appendEvidenceToPdf, stripHtml } from './contractPdfGenerator';
import { generatePdfContract, extractInitials } from './pdfTemplateProcessor';
import { htmlToPdf } from './htmlToPdf';
import type { PdfFieldPosition, PdfVariableMapping } from './pdfTemplateProcessor';
import { salaryToSpanishWords } from '../utils/numberToSpanishWords';
import { getLogoUrl, getCompanySignatureUrl, getLegalRepInitialsUrl } from '../utils/branding';
import { sendEmail } from '../email/gmailClient';
import { signedCopyTemplate } from '../email/templates';
import { getRecruiterEmail } from '../utils/recruiters';

const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const ANTHROPIC_API_KEY = defineString('ANTHROPIC_API_KEY');
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

function toTitleCase(str: string): string {
  if (!str) return str;
  const keep = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'en', 'al', 'con', 'por', 'sin']);
  return str.toLowerCase().split(' ').map((word, i) => {
    if (i === 0 || !keep.has(word)) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  }).join(' ');
}

function buildContractVars(candidate: Record<string, unknown>, now: Date): Record<string, string> {
  const firstName = (candidate.firstName as string) || '';
  const lastName  = (candidate.lastName  as string) || '';
  const rawSalary = (candidate.viterbitSalary as string) || '';

  const vars: Record<string, string> = {
    name:              `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    position:          (candidate.position as string) || '',
    departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.position as string) || '',
    hiringManager:     (candidate.viterbitHiringManager as string) || '',
    company:           (candidate.viterbitCompany as string) || 'Aviva',
    salary:            rawSalary.replace(/^\$\s*/, ''),
    salarioTexto:      salaryToSpanishWords(rawSalary),
    startDate:         (candidate.viterbitStartDate as string) || 'a convenir',
    benefits:          (candidate.benefits as string) || '',
    date:              format(now, "d 'de' MMMM 'de' yyyy", { locale: es }),
  };

  // Form answers: beneficiario and parentesco
  const fa = (candidate.formAnswers ?? {}) as Record<string, unknown>;
  vars.beneficiario = (fa.beneficiarioNombre as string) || '';
  const parentescoRaw = (fa.beneficiarioParentesco as string) || '';
  const PARENTESCO_LABELS: Record<string, string> = {
    padre_madre: 'Padre/Madre', hermano: 'Hermano/a', esposo: 'Esposo/a', hijo: 'Hijo/a',
  };
  vars.parentesco = PARENTESCO_LABELS[parentescoRaw] || parentescoRaw;

  // Carta de No Inhabilitación — depends on whether candidate worked at a financial institution
  const trabajoFinanciera = fa.trabajoEntidadFinanciera as boolean | undefined;
  vars.marcaNoLaboro = !trabajoFinanciera ? 'X' : '';
  vars.marcaSiLaboro = trabajoFinanciera ? 'X' : '';
  vars.nombreEntidadFinanciera = (fa.nombreEntidadFinanciera as string) || '';

  // OCR-extracted fields from validated documents
  const docs = (candidate.documents ?? {}) as Record<string, {
    status?: string;
    ocrResult?: { extractedData?: Record<string, string> };
  }>;
  const ocr = (docType: string) => docs[docType]?.status === 'valid'
    ? (docs[docType].ocrResult?.extractedData ?? {})
    : {};

  const ineData        = ocr('ine');
  const actaData       = ocr('acta_nacimiento');
  const curpData       = ocr('curp');
  const constanciaData = ocr('constancia_fiscal');
  const caratulaData   = ocr('caratula_bancaria');
  const nssData        = ocr('nss');

  // Manual overrides take priority over OCR-extracted values (recruiter corrections)
  const ov = (candidate.dataOverrides ?? {}) as Record<string, string>;

  vars.curp      = ov.curp      || curpData.curp || ineData.curp || '';
  vars.rfc       = ov.rfc       || constanciaData.rfc || '';
  vars.domicilio = ov.domicilio || toTitleCase(ineData.domicilio || '');
  vars.clabe     = ov.clabe     || caratulaData.clabe || '';
  vars.banco     = ov.banco     || caratulaData.banco || '';
  vars.nss       = ov.nss       || nssData.nss || '';

  // sexo: prefer acta (full word), fallback to INE (H/M) normalized
  const sexoRaw = actaData.sexo || ineData.sexo || '';
  if (sexoRaw === 'H' || sexoRaw.toLowerCase() === 'masculino') vars.sexo = 'Masculino';
  else if (sexoRaw === 'M' || sexoRaw.toLowerCase() === 'femenino') vars.sexo = 'Femenino';
  else vars.sexo = sexoRaw;

  vars.nacionalidad = actaData.nacionalidad || ineData.nacionalidad || '';

  return vars;
}

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

// Resolves the "Correo corporativo" stage ID from the candidate's stored viterbitStageIds,
// falling back to a live Viterbit API lookup when the value is missing (e.g. the stage was
// added after the candidate record was created).
async function resolveCorreosStageId(
  candidate: Record<string, unknown>,
  apiKey: string,
): Promise<string> {
  const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
  if (stageIds?.correos) return stageIds.correos;

  const jobId = candidate.viterbitJobId as string | undefined;
  if (!jobId || !apiKey) return '';

  try {
    const resp = await fetch(
      `${VITERBIT_API_BASE}/jobs/${jobId}?includes[]=stages`,
      { headers: { 'X-API-Key': apiKey } },
    );
    if (!resp.ok) return '';
    const json = (await resp.json()) as Record<string, unknown>;
    const data = (json.data as Record<string, unknown>) ?? json;
    const stages = (data.stages as Array<{ id: string; name: string }>) ?? [];
    const match = stages.find((s) => s.name.toLowerCase().includes('correo corporativo'));
    return match?.id ?? '';
  } catch {
    return '';
  }
}

// ─── Sign Contract ────────────────────────────────────────────────────────────

export const signContract = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 300, memory: '1GiB' },
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

    const vars = buildContractVars(candidate, now);

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
      // ── HTML-based template — both signatures injected into the HTML, Puppeteer renders ──
      const [companySigUrl, legalRepInitialsUrl] = await Promise.all([
        getCompanySignatureUrl(),
        getLegalRepInitialsUrl(),
      ]);
      vars.firmaEmpresa = companySigUrl
        ? `<img src="${companySigUrl}" alt="Firma Representante Legal" style="max-width:200px;max-height:70px;display:block;margin:4px auto;">`
        : '';

      // Convert legal rep initials URL to base64 so Puppeteer footer can embed it inline
      let legalRepInitialsBase64: string | undefined;
      if (legalRepInitialsUrl) {
        try {
          const imgResp = await fetch(legalRepInitialsUrl);
          if (imgResp.ok) {
            const imgBuf = Buffer.from(await imgResp.arrayBuffer());
            legalRepInitialsBase64 = `data:image/png;base64,${imgBuf.toString('base64')}`;
          }
        } catch (err) {
          console.error('[signContract] fetch legalRepInitials error:', err);
        }
      }

      const bodyHtml = (contractTemplate?.bodyHtml as string) ?? '<p>Contrato en preparación.</p>';

      // Hash contract content BEFORE candidate signature is added (cryptographic baseline)
      const bodyTextForHash = stripHtml(interpolate(bodyHtml, { ...vars, firmaEmpleado: '' }));

      // Inject candidate's drawn signature so it appears in the correct place in the HTML
      vars.firmaEmpleado = `<img src="${signatureBase64}" alt="Firma del Empleado" style="max-width:200px;max-height:70px;display:block;margin:4px auto;">`;

      // Render the complete HTML (both signatures already embedded) to PDF
      // pageMargins are handled by Puppeteer so they apply consistently to every page,
      // including pages 2+ after section breaks. The HTML template must set padding: 0
      // in @media print so these don't compound with the CSS padding.
      const htmlPdfBuffer = await htmlToPdf(interpolate(bodyHtml, vars), {
        initials: candidateInitials,
        initialsBase64: initialsBase64 || undefined,
        legalRepInitialsBase64,
        pageMargins: { top: '20mm', right: '20mm', bottom: '16mm', left: '20mm' },
      });

      const result = await generateContractPdf({
        candidateName: candidateFullName,
        position: candidate.position as string,
        bodyText: bodyTextForHash,
        signatureBase64,
        signedAt: now,
        signerIp,
        signerUserAgent,
        htmlPdfBuffer,
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

    // Merge evidence as the last page of the contract PDF (ZapSign-style)
    const mergedPdfBuffer = await appendEvidenceToPdf(pdfBuffer, evidencePdfBuffer);

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

    // Signed contract PDF (with certificate appended as last page)
    const pdfPath = `candidates/${candidateId}/contrato_firmado.pdf`;
    const pdfFile = bucket.file(pdfPath);
    await pdfFile.save(mergedPdfBuffer, { metadata: { contentType: 'application/pdf' } });
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

    // Move in Viterbit to "Correos" stage.
    // resolveCorreosStageId falls back to a live API lookup when the stored ID is missing.
    const apiKey = VITERBIT_API_KEY.value();
    const candidatureId = candidate.viterbitCandidatureId as string | undefined;
    const correosStageId = await resolveCorreosStageId(candidate, apiKey);

    if (apiKey && correosStageId && candidatureId) {
      try {
        await moveToStage(candidatureId, correosStageId, apiKey);
      } catch (err) {
        console.error('[signContract] moveToStage correos error:', err);
        await db.collection('webhook_logs').add({
          type: 'moveToStage_error',
          stage: 'correos',
          candidateId,
          candidatureId,
          correosStageId,
          error: String(err),
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } else {
      console.warn('[signContract] skipping moveToStage correos — missing ids', {
        candidateId,
        candidatureId,
        correosStageId,
        hasApiKey: !!apiKey,
      });
    }

    // Send signed copy email BEFORE responding — fire-and-forget after res.json()
    // is unreliable in Cloud Functions because the runtime may terminate early.
    const copyLogoUrl = await getLogoUrl();
    const createdBy = candidate.createdBy as string;
    const senderEmail = await getRecruiterEmail(createdBy).catch(() => undefined);
    const { subject: copySubject, html: copyHtml } = signedCopyTemplate({
      firstName: candidate.firstName as string,
      position: candidate.position as string,
      type: 'contract',
      pdfUrl,
      evidenceUrl,
      logoUrl: copyLogoUrl,
    });
    try {
      await sendEmail({
        to: candidate.email as string,
        subject: copySubject,
        html: copyHtml,
        senderEmail,
        recruiterUid: createdBy !== 'viterbit_webhook' ? createdBy : undefined,
        attachments: [
          { filename: 'contrato_firmado.pdf', content: mergedPdfBuffer, contentType: 'application/pdf' },
        ],
      });
      await db.collection('email_logs').add({
        candidateId,
        templateType: 'contract_signed_copy',
        sentTo: candidate.email,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'sign_contract',
        success: true,
      });
    } catch (emailErr) {
      console.error('[signContract] send signed copy email error:', emailErr);
      await db.collection('email_logs').add({
        candidateId,
        templateType: 'contract_signed_copy',
        sentTo: candidate.email,
        sentAt: FieldValue.serverTimestamp(),
        sentBy: 'sign_contract',
        success: false,
        error: String(emailErr),
      });
    }

    // Log the signing event
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

/**
 * Strip CSS blocks and HTML boilerplate from text extracted from a PDF.
 * PDFs exported from HTML often carry the full <style> block in their text layer.
 */
function sanitizeExtractedText(text: string): string {
  let result = text;

  // If it's a full HTML document, extract body content only
  const bodyMatch = result.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) result = bodyMatch[1];

  // Strip all HTML tags (including <style> blocks with their contents)
  result = result.replace(/<style[\s\S]*?<\/style>/gi, '');
  result = result.replace(/<[^>]+>/g, ' ');

  // Strip CSS rule blocks — matches: optional-selector { any content }
  result = result.replace(/[^{}\n]*\{[^{}]*\}/g, '');

  // Strip HTML entities
  result = result.replace(/&[a-z#0-9]+;/gi, ' ');

  // Strip lines that are purely CSS property declarations: "font-size: 12pt;"
  // CSS properties are lowercase-kebab-only before the colon, end with ";"
  result = result
    .split('\n')
    .filter((line: string) => {
      const t = line.trim();
      if (!t) return false;
      if (t === '}' || t === '{') return false;
      if (t.startsWith('@')) return false; // @media, @charset, etc.
      // CSS property: no uppercase, no spaces in the key, ends with semicolon
      if (/^[a-z][a-z-]*\s*:\s*\S[^;]*;?\s*$/.test(t) && !/[A-Z\s]/.test(t.split(':')[0] ?? '')) return false;
      return true;
    })
    .join('\n');

  return result.trim();
}

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

    try {
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

    if (candidate.status === 'contract_signed') {
      res.status(409).json({ ok: false, error: 'already_signed' });
      return;
    }
    if (candidate.status !== 'contract_sent') {
      // Status was reset (e.g. by a document review after sending) — treat as not ready yet
      res.status(409).json({ ok: false, error: 'not_ready' });
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

    const vars = buildContractVars(candidate, new Date());

    // Add company signature as an injectable HTML img (use {{firmaEmpresa}} in the template)
    const companySigUrl = await getCompanySignatureUrl();
    vars.firmaEmpresa = companySigUrl
      ? `<img src="${companySigUrl}" alt="Firma Representante Legal" style="max-width:220px;max-height:80px;display:block;margin:0 auto 4px;">`
      : '';
    // Candidate hasn't signed yet in preview — leave blank so the line shows
    vars.firmaEmpleado = '';

    const templateType2 = (contractTemplate?.templateType as string) || 'html';
    const rawHtml = (contractTemplate?.bodyHtml as string) ?? '<p>Contrato en preparación.</p>';
    const renderedHtml = interpolate(rawHtml, vars);

    // For PDF templates: get plain text, replace *** with candidate data, render as HTML
    let finalHtml = renderedHtml;
    if (templateType2 === 'pdf') {
      let rawText = (contractTemplate?.pdfExtractedText as string) ?? '';
      const templateDocId = candidate.contractTemplateId as string | undefined;

      // If text not stored yet: try pdf-parse, then Claude as last resort
      if (!rawText && contractTemplate?.pdfStoragePath) {
        const bucket = getStorage().bucket();
        const [pdfBytes] = await bucket.file(contractTemplate.pdfStoragePath as string).download();
        const pdfBuffer = Buffer.from(pdfBytes);

        // Try pdf-parse first (fast, free)
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const pdfParse: (b: Buffer) => Promise<{ text: string }> =
            require('pdf-parse/lib/pdf-parse.js');
          const pdfData = await pdfParse(pdfBuffer);
          rawText = pdfData.text ?? '';
        } catch { /* font encoding issue — fall through to Claude */ }

        // Last resort: Claude text extraction (works for any PDF encoding)
        if (!rawText) {
          try {
            const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
            const pdfBase64 = pdfBuffer.toString('base64');
            const msg = await client.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 8192,
              messages: [{
                role: 'user',
                content: [
                  { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
                  { type: 'text', text: 'Extract all text from this PDF. Keep every *** placeholder exactly as written. Return ONLY the text, no commentary.' },
                ],
              }],
            });
            rawText = msg.content
              .filter((b): b is Anthropic.TextBlock => b.type === 'text')
              .map((b) => b.text)
              .join('');
          } catch (claudeErr) {
            console.error('[getContract] Claude text extraction failed:', claudeErr);
          }
        }

        // Cache the sanitized text so future loads are instant and already clean
        const sanitized = sanitizeExtractedText(rawText);
        rawText = sanitized;
        if (rawText && templateDocId) {
          db.collection('contract_templates').doc(templateDocId).update({ pdfExtractedText: rawText }).catch(() => {});
        }
      }

      if (rawText) {
        // Strip CSS/HTML boilerplate that appears when the PDF was generated from HTML
        const cleanText = sanitizeExtractedText(rawText);

        // Update the cached text if it was dirty (avoid re-stripping on every load)
        if (cleanText !== rawText && templateDocId) {
          db.collection('contract_templates').doc(templateDocId).update({ pdfExtractedText: cleanText }).catch(() => {});
        }

        const mappings = (contractTemplate?.variableMappings as PdfVariableMapping[]) ?? [];
        let text = cleanText;
        for (const mapping of mappings) {
          const value = (vars[mapping.variableName] as string) || '';
          text = text.replace('***', value);
        }
        finalHtml = text
          .split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0)
          .map((l: string) => `<p>${l}</p>`)
          .join('');
      } else {
        finalHtml = '<p>El contrato está siendo preparado. Por favor contacta a tu reclutador.</p>';
      }
    }

    const logoUrl = await getLogoUrl();

    res.status(200).json({
      ok: true,
      contract: {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        position: candidate.position,
        salary: (candidate.viterbitSalary as string) || '',
        startDate: (candidate.viterbitStartDate as string) || 'a convenir',
        templateType: 'html',
        bodyHtml: finalHtml,
        expiresAt: expiresAt?.toISOString(),
        logoUrl,
      },
    });
    } catch (err) {
      console.error('[getContract] Unhandled error:', err);
      res.status(500).json({ ok: false, error: 'Error al cargar el contrato. Por favor intenta de nuevo.' });
    }
  }
);
