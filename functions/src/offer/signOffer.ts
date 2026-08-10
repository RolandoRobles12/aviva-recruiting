import { randomBytes } from 'crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '../utils/admin';
import { sendEmail } from '../email/gmailClient';
import { invitationTemplate, signedCopyTemplate } from '../email/templates';
import { getRecruiterEmail } from '../utils/recruiters';
import { getLinkDuration } from '../utils/linkDuration';
import { htmlToPdf } from '../contract/htmlToPdf';
import { getLogoUrl } from '../utils/branding';

const APP_URL = defineString('APP_URL', { default: 'https://aviva-recruiting.web.app' });
const VITERBIT_API_KEY = defineString('VITERBIT_API_KEY');
const VITERBIT_API_BASE = 'https://api.viterbit.com/v1';

// ─── Viterbit API ─────────────────────────────────────────────────────────────

async function moveToStage(candidatureId: string, stageId: string, apiKey: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s max
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidatures/${candidatureId}/stage`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: stageId }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Viterbit moveToStage ${stageId} → HTTP ${resp.status}: ${text}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function patchViterbitCandidateFile(
  candidateId: string,
  fieldName: string,
  fileUrl: string,
  apiKey: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(`${VITERBIT_API_BASE}/candidates/${candidateId}`, {
      method: 'PATCH',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ custom_field_values: { [fieldName]: fileUrl } }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`patchViterbitCandidateFile → HTTP ${resp.status}: ${text}`);
    }
  } finally {
    clearTimeout(timeout);
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

// ─── PDF scaffold: header + {{bodyContent}} slot + signature ──────────────────
// The body content is loaded from Firestore offer_templates (or the fallback below).
// Logo is injected as an <img> tag via {{logoTag}} so no base64 is embedded here.

const OFFER_PDF_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Carta Oferta Aviva</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ffffff;
      color: #1a1a1a;
      font-family: Roboto, Arial, Helvetica, sans-serif;
      font-size: 15px;
      line-height: 1.52;
    }
    .page-wrapper {
      width: 210mm;
      margin: 0;
      background: #ffffff;
      padding: 17mm 25mm 18mm 25mm;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding-bottom: 24px;
      border-bottom: 1.3px solid #00664d;
    }
    .logo { width: 88px; height: auto; display: block; }
    .company { color: #00664d; font-weight: 700; font-size: 18px; letter-spacing: .1px; padding-top: 4px; }
    .date { text-align: right; margin: 20px 0 31px 0; font-size: 15px; }
    p { margin: 0 0 16px 0; }
    h2 { color: #00664d; font-weight: 700; font-size: 18px; margin: 24px 0 8px 18px; }
    ul { margin: 3px 0 28px 28px; padding-left: 23px; list-style: disc; }
    li { padding-left: 7px; margin: 0 0 3px 0; line-height: 1.5; }
    li::marker { font-size: 1.55em; color: #000000; }
    .signature-area { padding-top: 20px; border-top: 1px solid #d0d0d0; margin-top: 20px; }
    .signature-area img { max-width: 200px; max-height: 70px; display: block; margin: 4px 0; }
    .sig-line { border-bottom: 1.3px solid #1e293b; width: 260px; margin: 4px 0 0; }
    .sig-name { margin: 4px 0 0 !important; font-size: 14px; font-weight: 700; color: #1a1a1a; }
    .sig-label { margin: 2px 0 0 !important; font-size: 12px; color: #9ca3af; }
    @media print { body { background: white; } }
  </style>
</head>
<body>
  <div class="page-wrapper">
    <header class="header">
      {{logoTag}}
      <div class="company">Aviva Financial S.A. de C.V. SOFOM ENR</div>
    </header>

    <p class="date">Ciudad de México, <b>{{dateSlash}}</b></p>

    {{bodyContent}}

    <div class="signature-area">
      {{firmaEmpleado}}
      <div class="sig-line"></div>
      <p class="sig-name">{{name}}</p>
      <p class="sig-label">El Candidato / La Candidata</p>
      <p class="sig-label">{{signedAtDate}}</p>
    </div>
  </div>
</body>
</html>`;

// ─── Fallback body used when no Firestore offer_templates doc exists ──────────

const DEFAULT_OFFER_BODY_HTML = `<p>Bienvenido/a <strong>{{name}}</strong>,</p>
<p>Después de escuchar tu historia, tu trayectoria y lo que te mueve, estamos convencidos de que tu talento puede ayudarnos a hacer realidad nuestra historia en más comunidades y transformar muchas vidas. Hoy queremos dar un paso más contigo y compartirte nuestra carta oferta, y te unas a nuestra misión de ofrecer productos financieros de calidad mediante una experiencia confiable y digna, acercando la tecnología de manera accesible.</p>
<p>Ahora déjanos contarte cómo tu posición nos ayudará en esta misión;</p>
<h2>I. Posición y organización</h2>
<p><strong>Puesto:</strong> {{departmentProfile}}<br>
<strong>Empresa:</strong> {{company}}<br>
<strong>Líder:</strong> {{hiringManager}}<br>
<strong>Fecha de inicio:</strong> {{startDate}}<br>
<strong>Horario:</strong> Lunes a Domingo 10 a 19 con Descanso Jueves*</p>
<p><em>*Pueden cambiar de acuerdo a necesidades del negocio</em></p>
<h2>II. Responsabilidades clave</h2>
<ul>
<li>Atender a clientes en piso de venta, identificar sus necesidades y cerrar ventas de forma inmediata.</li>
<li>Tener pleno conocimiento de las características de los productos que se venden en tienda física y digital.</li>
<li>Construir relaciones positivas y efectivas con gerentes, subgerentes y asociados de tienda.</li>
<li>Ejecutar estrategias de venta, activaciones y promociones dentro del punto de venta.</li>
<li>Proponer e implementar acciones comerciales en colaboración con el equipo de tienda, principalmente con el asociado de venta en línea.</li>
<li>En caso necesario, realizar actividades de cambaceo en zonas cercanas para impulsar el tráfico y las ventas.</li>
<li>Cuidar la imagen y representación de AVIVA en el punto de venta.</li>
<li><strong>El rol contempla operación durante temporadas clave como Hot Sale y Buen Fin, así como en otras fechas estratégicas del año.</strong> Estos períodos representan una <strong>oportunidad directa para maximizar ingresos</strong>, ya que el incremento en la demanda y el flujo de clientes se traduce en un <strong>mayor potencial de comisiones.</strong></li>
</ul>
<h2>III. Compensación y beneficios iniciales</h2>
<p>El plan de compensación de Aviva será dinámico, y evolucionará conforme logremos objetivos por ello te ofrecemos lo siguiente:</p>
<p><strong>Sueldo Bruto:</strong> {{salary}} (antes de impuestos)<br>
<strong>Bono Garantía Bruto:</strong> 1,750 MXN (pagado únicamente en las primeras 2 quincenas)*<br>
<strong>Bono Mensual Bruto:</strong> 0 a 14,373 MXN (acuerdo al cumplimiento de metas de venta, pagado a quincena vencida)*<br>
<strong>Premios bimestral:</strong> bono variable a los 3 primeros lugares de cada grupo de tienda*<br>
<strong>Seguridad social:</strong> IMSS<br>
<strong>Prima vacacional:</strong> 25%<br>
<strong>Prima dominical:</strong> 25%<br>
<strong>Aguinaldo:</strong> 15 días (proporcional a los días laborados en el año)<br>
<strong>Días Aviva:</strong> 7 días personales al año para reavivar tu energía, después de los 4 meses en Aviva<br>
<strong>Día de cumpleaños:</strong> 1 día al año para celebrar tu vida<br>
<strong>Bono de Maternidad o paternidad:</strong> 15 días de tu salario bruto mensual al nacer tu hijo/a</p>
<p><em>*La compensación variable y beneficios superiores están sujetos a ajustes conforme a la evolución y necesidades de la operación, garantizando siempre esquemas claros, medibles y alineados al desempeño.</em></p>
<p><strong>¡Nos encanta que estés a unos pasos de ser parte de Aviva!</strong></p>`;

// ─── Fetch offer body HTML from Firestore, falling back to the default ────────

async function fetchOfferBodyHtml(candidateData: Record<string, unknown>): Promise<string> {
  const templateId = candidateData.offerTemplateId as string | undefined;
  if (templateId) {
    const tSnap = await db.collection('offer_templates').doc(templateId).get();
    if (tSnap.exists) {
      const html = (tSnap.data() as Record<string, unknown>).bodyHtml as string | undefined;
      if (html) return html;
    }
  }
  const allSnap = await db.collection('offer_templates').limit(1).get();
  if (!allSnap.empty) {
    const html = (allSnap.docs[0].data() as Record<string, unknown>).bodyHtml as string | undefined;
    if (html) return html;
  }
  return DEFAULT_OFFER_BODY_HTML;
}

// ─── Cloud Function ────────────────────────────────────────────────────────────

export const signOffer = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 300, memory: '1GiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const { token, signatureBase64 } = req.body as { token?: string; signatureBase64?: string };
    console.log(`[signOffer] REQUEST received. token=${token ? token.slice(0,8) : 'missing'} sig=${signatureBase64 ? signatureBase64.length + ' chars' : 'missing'}`);

    if (!token || !signatureBase64) {
      res.status(400).json({ ok: false, error: 'Se requiere el token y la firma.' });
      return;
    }

    // Wrap any promise with a hard timeout — lets us identify which operation hangs.
    function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`[signOffer] TIMEOUT: ${label} after ${ms}ms`)), ms)
        ),
      ]);
    }

    try {
      // ── Find candidate by offerToken ──────────────────────────────────────────
      console.log('[signOffer] Querying Firestore...');
      const snap = await withTimeout(
        db.collection('candidates').where('offerToken', '==', token).limit(1).get(),
        10_000,
        'Firestore query'
      );

      if (snap.empty) {
        res.status(404).json({ ok: false, error: 'No se encontró la carta oferta. Verifica tu enlace.' });
        return;
      }

      const candidateDoc = snap.docs[0];
      const candidateId = candidateDoc.id;
      const candidate = candidateDoc.data();

      if (candidate.status !== 'offer_sent' && candidate.status !== 'offer_held') {
        res.status(409).json({
          ok: false,
          error: 'Esta carta oferta ya ha sido firmada. Si no recibes una copia firmada en tu correo en los próximos minutos, ponte en contacto con tu reclutadora.',
        });
        return;
      }

      const now = new Date();
      const expiresAt = candidate.offerExpiresAt?.toDate?.() as Date | undefined;
      if (expiresAt && now > expiresAt) {
        res.status(410).json({ ok: false, error: 'Este enlace ha expirado. Contacta a tu reclutador para uno nuevo.' });
        return;
      }

      // ── Build candidate data from stored Firestore values (no live API calls) ──
      const apiKey = VITERBIT_API_KEY.value();

      const firstNameVal = (candidate.firstName as string) || '';
      const lastNameVal  = (candidate.lastName  as string) || '';
      const storedFullName = `${firstNameVal} ${lastNameVal}`.trim();
      const candidateFullName = storedFullName
        || (candidate.email as string || '').split('@')[0].replace(/[._-]/g, ' ');

      const positionVal = (candidate.position as string) || 'Asesor de Ventas';
      const salary      = (candidate.viterbitSalary as string) || 'A convenir';
      const startDate   = (candidate.viterbitStartDate as string) || 'A convenir';

      const vars: Record<string, string> = {
        name:      candidateFullName,
        firstName: firstNameVal || candidateFullName.split(' ')[0],
        lastName:  lastNameVal  || candidateFullName.split(' ').slice(1).join(' '),
        position:  positionVal,
        departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.profile as string) || positionVal,
        hiringManager:     (candidate.viterbitHiringManager as string) || '',
        company:           (candidate.viterbitCompany as string) || 'Aviva Financial, S.A. de C.V., SOFOM, ENR',
        salary,
        startDate,
        date: format(now, "d 'de' MMMM 'de' yyyy", { locale: es }),
      };
      const logoUrl = await getLogoUrl();

      // Extra vars for Puppeteer PDF rendering
      vars.dateSlash     = format(now, 'dd/MM/yyyy');
      vars.logoTag       = logoUrl ? `<img class="logo" src="${logoUrl}" alt="Aviva" />` : '';
      vars.signedAtDate  = format(now, "d 'de' MMMM 'de' yyyy", { locale: es });
      vars.firmaEmpleado = `<img src="${signatureBase64}" alt="Firma" style="max-width:200px;max-height:70px;display:block;margin:4px 0;">`;

      // Fetch body content from Firestore offer_templates (falls back to hardcoded default)
      const rawBodyHtml = await withTimeout(fetchOfferBodyHtml(candidate), 8_000, 'fetch offer template');
      vars.bodyContent = interpolate(rawBodyHtml, vars);

      // ── Generate PDF ──────────────────────────────────────────────────────────
      console.log('[signOffer] Starting PDF generation...');
      const t0 = Date.now();
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await withTimeout(
          htmlToPdf(interpolate(OFFER_PDF_HTML_TEMPLATE, vars), {}),
          90_000,
          'PDF generation'
        );
        console.log(`[signOffer] PDF generated in ${Date.now() - t0}ms`);
      } catch (pdfErr) {
        console.error('[signOffer] PDF generation error:', pdfErr);
        res.status(500).json({ ok: false, error: 'Error al generar el PDF. Intenta de nuevo en unos segundos.' });
        return;
      }

      // ── Upload signature PNG & offer PDF to Storage in parallel ───────────────
      // Each GCS call is wrapped in a 20s timeout — the SDK default totalTimeout
      // is 600s which would cause the function to hang until the 300s Cloud Run
      // timeout kills it.
      const bucket = getStorage().bucket();
      const sigBase64 = signatureBase64.replace(/^data:image\/png;base64,/, '');

      const gcsTimeout = (ms: number, label: string) =>
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`[signOffer] GCS timeout (${label}) after ${ms}ms`)), ms)
        );

      let sigUrl: string;
      let pdfUrl: string;
      try {
        // Embed Firebase download tokens — URLs work under Uniform Bucket-Level Access without ACLs
        const fbUrl = (path: string, token: string) =>
          `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

        const sigPath = `candidates/${candidateId}/offer_signature.png`;
        const sigToken = randomBytes(16).toString('hex');
        const pdfPath = `candidates/${candidateId}/carta_oferta_firmada.pdf`;
        const pdfToken = randomBytes(16).toString('hex');

        [sigUrl, pdfUrl] = await Promise.all([
          (async () => {
            const f = bucket.file(sigPath);
            await Promise.race([
              f.save(Buffer.from(sigBase64, 'base64'), {
                metadata: { contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: sigToken } },
              }),
              gcsTimeout(20_000, 'sig save'),
            ]);
            return fbUrl(sigPath, sigToken);
          })(),
          (async () => {
            const f = bucket.file(pdfPath);
            await Promise.race([
              f.save(pdfBuffer, {
                metadata: { contentType: 'application/pdf', metadata: { firebaseStorageDownloadTokens: pdfToken } },
              }),
              gcsTimeout(20_000, 'pdf save'),
            ]);
            return fbUrl(pdfPath, pdfToken);
          })(),
        ]);
        console.log(`[signOffer] Storage uploads done in ${Date.now() - t0}ms`);
      } catch (storageErr) {
        console.error('[signOffer] Storage upload error:', storageErr);
        res.status(500).json({ ok: false, error: 'Error al guardar los archivos. Intenta de nuevo.' });
        return;
      }

      // ── Reissued offer? Resume the flow where it was before the reissue ───────
      // reissueOffer stores the prior status; candidates whose documents were
      // already complete go straight back to under_review, which makes
      // onCandidateUpdated regenerate and send the contract with corrected data.
      const reissuePriorStatus = candidate.reissuePriorStatus as string | undefined;
      const DOCS_COMPLETE_STATUSES = [
        'under_review', 'approved', 'contract_sent', 'contract_signed',
        'email_pending', 'email_ready', 'induction', 'onboarding_iniciado', 'promotor_exitoso',
        'bajo_desempeno',
      ];
      const resumeDocsComplete = !!reissuePriorStatus && DOCS_COMPLETE_STATUSES.includes(reissuePriorStatus);

      // ── Move candidate in Viterbit to "Documentos" (fire-and-forget) ──────────
      // Skipped when resuming a docs-complete reissue: onCandidateUpdated will
      // move them to "Contrato" as soon as the new contract goes out.
      const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
      const documentosStageId = stageIds?.documentos;
      const candidatureId = candidate.viterbitCandidatureId as string | undefined;

      if (apiKey && documentosStageId && candidatureId && !resumeDocsComplete) {
        void moveToStage(candidatureId, documentosStageId, apiKey).catch((err) =>
          console.error('[signOffer] moveToStage documentos error:', err)
        );
      }

      // ── Update carta_oferta field in Viterbit (fire-and-forget) ──────────────
      const viterbitCandidateId = candidate.viterbitCandidateId as string | undefined;
      if (apiKey && viterbitCandidateId) {
        void patchViterbitCandidateFile(viterbitCandidateId, 'carta_oferta', pdfUrl, apiKey).catch((err) =>
          console.error('[signOffer] patchViterbitCandidateFile carta_oferta error:', err)
        );
      }

      // ── Generate documents form token ─────────────────────────────────────────
      // Reissued offers keep the existing form link so already-uploaded documents
      // and the candidate's original URL stay valid.
      const existingFormToken = candidate.formToken as string | undefined;
      const formToken = existingFormToken ?? randomBytes(32).toString('hex');
      const linkDurations = await withTimeout(getLinkDuration(), 8_000, 'getLinkDuration');
      const formExpiresAt = new Date(now.getTime() + linkDurations.formDays * 24 * 60 * 60 * 1000);

      const nextStatus = resumeDocsComplete
        ? 'under_review'
        : (reissuePriorStatus === 'invited' || reissuePriorStatus === 'in_progress')
          ? reissuePriorStatus
          : 'offer_signed';

      // ── Update candidate in Firestore ─────────────────────────────────────────
      await withTimeout(
        candidateDoc.ref.update({
          status: nextStatus,
          offerSignedAt: now,
          offerSignatureUrl: sigUrl,
          offerPdfUrl: pdfUrl,
          ...(existingFormToken ? {} : { formToken, formExpiresAt }),
          reissuePriorStatus: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
        10_000,
        'Firestore update'
      );

      // ── Respond immediately — email runs in background ───────────────────────
      console.log(`[signOffer] sending 200 at ${Date.now() - t0}ms`);
      res.status(200).json({ ok: true, pdfUrl });

      // ── Fire-and-forget: send invitation email ────────────────────────────────
      // Do NOT await — handler must return now so the response is flushed to client.
      const appUrl = APP_URL.value();
      const formUrl = `${appUrl}/form/${formToken}`;
      const formExpiresAtStr = format(formExpiresAt, "d 'de' MMMM 'de' yyyy", { locale: es });
      const createdBy = candidate.createdBy as string;

      void (async () => {
        try {
          const offerLogoUrl = await getLogoUrl();
          const senderEmail = await getRecruiterEmail(createdBy).catch(() => undefined);

          // Send invitation email (submit documents) — only for a newly minted
          // form link. Reissued offers keep the old link and its documents, so
          // re-inviting the candidate to upload would be confusing.
          if (!existingFormToken) {
            const { subject: invSubject, html: invHtml } = invitationTemplate({
              firstName: candidate.firstName as string,
              lastName: candidate.lastName as string,
              position: candidate.position as string,
              formUrl,
              formExpiresAt: formExpiresAtStr,
            }, undefined, offerLogoUrl);
            await sendEmail({
              to: candidate.email as string,
              subject: invSubject,
              html: invHtml,
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
          }

          // Send signed copy email to candidate (with PDF attached)
          const { subject: copySubject, html: copyHtml } = signedCopyTemplate({
            firstName: candidate.firstName as string,
            position: candidate.position as string,
            type: 'offer',
            pdfUrl,
            logoUrl: offerLogoUrl,
          });
          await sendEmail({
            to: candidate.email as string,
            subject: copySubject,
            html: copyHtml,
            senderEmail,
            recruiterUid: createdBy !== 'viterbit_webhook' ? createdBy : undefined,
            attachments: [{ filename: 'carta_oferta_firmada.pdf', content: pdfBuffer, contentType: 'application/pdf' }],
          });
          await db.collection('email_logs').add({
            candidateId,
            templateType: 'offer_signed_copy',
            sentTo: candidate.email,
            sentAt: FieldValue.serverTimestamp(),
            sentBy: 'sign_offer',
            success: true,
          });
        } catch (emailErr) {
          console.error('[signOffer] send email error:', emailErr);
          void db.collection('email_logs').add({
            candidateId,
            templateType: 'invitation',
            sentTo: candidate.email,
            sentAt: FieldValue.serverTimestamp(),
            sentBy: 'sign_offer',
            success: false,
            error: String(emailErr),
          });
        }
      })();
    } catch (err) {
      console.error('[signOffer] Unhandled error:', err);
      res.status(500).json({
        ok: false,
        error: 'Ocurrió un error al procesar tu firma. Por favor intenta de nuevo. Si el problema persiste, contacta a tu reclutador.',
      });
    }
  }
);

// ─── Public endpoint: get offer data by token ─────────────────────────────────

export const getOffer = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 120 },
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
        .where('offerToken', '==', token)
        .limit(1)
        .get();

      if (snap.empty) {
        res.status(404).json({ ok: false, error: 'Offer not found' });
        return;
      }

      const candidate = snap.docs[0].data();

      if (candidate.status !== 'offer_sent' && candidate.status !== 'offer_held') {
        res.status(409).json({ ok: false, error: 'already_signed' });
        return;
      }

      const expiresAt = candidate.offerExpiresAt?.toDate?.() as Date | undefined;
      if (expiresAt && new Date() > expiresAt) {
        res.status(410).json({ ok: false, error: 'expired' });
        return;
      }

      // Use stored Firestore values (set by webhook) — no live API calls to avoid hangs
      const firstNameVal = (candidate.firstName as string) || '';
      const lastNameVal  = (candidate.lastName  as string) || '';
      const storedFullName2 = `${firstNameVal} ${lastNameVal}`.trim();
      const candidateFullName2 = storedFullName2
        || (candidate.email as string || '').split('@')[0].replace(/[._-]/g, ' ');

      const positionVal    = (candidate.position as string) || 'Asesor de Ventas';
      const offerSalary    = (candidate.viterbitSalary as string) || 'A convenir';
      const offerStartDate = (candidate.viterbitStartDate as string) || 'A convenir';

      const vars: Record<string, string> = {
        name:      candidateFullName2,
        firstName: firstNameVal || candidateFullName2.split(' ')[0],
        lastName:  lastNameVal  || candidateFullName2.split(' ').slice(1).join(' '),
        position:  positionVal,
        departmentProfile: (candidate.viterbitDepartmentProfile as string) || (candidate.profile as string) || positionVal,
        hiringManager:     (candidate.viterbitHiringManager as string) || '',
        company:           (candidate.viterbitCompany as string) || 'Aviva Financial, S.A. de C.V., SOFOM, ENR',
        salary:    offerSalary,
        startDate: offerStartDate,
        date: format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es }),
      };

      const rawBodyHtml = await fetchOfferBodyHtml(candidate);
      const renderedHtml = interpolate(rawBodyHtml, vars);
      const logoUrl = await getLogoUrl();

      res.status(200).json({
        ok: true,
        offer: {
          candidateName: candidateFullName2,
          position: positionVal,
          salary: offerSalary,
          startDate: offerStartDate,
          bodyHtml: renderedHtml,
          expiresAt: expiresAt?.toISOString(),
          logoUrl,
        },
      });
    } catch (err) {
      console.error('[getOffer] Unhandled error:', err);
      res.status(500).json({
        ok: false,
        error: 'Error al cargar la carta oferta. Intenta recargar la página.',
      });
    }
  }
);
