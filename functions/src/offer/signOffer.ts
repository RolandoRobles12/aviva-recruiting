import { randomBytes } from 'crypto';
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
import { generateOfferPdf } from './pdfGenerator';

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
<p>Bienvenido/a <strong>\${name}</strong>,</p>
<p>Después de escuchar tu historia, tu trayectoria y lo que te mueve, estamos convencidos de que  tu talento puede ayudarnos a hacer realidad nuestra historia en más comunidades y transformar muchas vidas. Hoy queremos dar un paso más contigo y compartirte nuestra carta oferta, y te unas a nuestra misión de ofrecer productos financieros de calidad mediante una experiencia confiable y digna, acercando la tecnología de manera accesible.</p>
<p>Ahora déjanos contarte cómo tu posición nos ayudará en esta misión;</p>
<h2>I. Posición y organización</h2>
<p><strong>Puesto:</strong> \${job_department_profile}<br>
<strong>Empresa:</strong> \${custom_job_empresa}<br>
<strong>Líder:</strong> \${custom_job_hiring_manager}<br>
<strong>Fecha de inicio:</strong> \${hired_start_date_job}<br>
<strong>Horario:</strong> Lunes a Domingo 10 a 19 con Descanso Jueves*<br>
<em>*Pueden cambiar de acuerdo a necesidades del negocio</em></p>
<h2>II. Responsabilidades clave</h2>
<ul>
<li>Atender a clientes en piso de venta, identificar sus necesidades y cerrar ventas de forma inmediata.</li>
<li>Tener pleno conocimiento de las características de los productos que se venden en tienda física y digital.</li>
<li>Construir relaciones positivas y efectivas con gerentes, subgerentes y asociados de tienda.</li>
<li>Ejecutar estrategias de venta, activaciones y promociones dentro del punto de venta.</li>
<li>Proponer e implementar acciones comerciales en colaboración con el equipo de tienda, principalmente con el asociado de venta en línea.</li>
<li>En caso necesario, realizar actividades de cambaceo en zonas cercanas para impulsar el tráfico y las ventas.</li>
<li>Cuidar la imagen y representación de AVIVA en el punto de venta.</li>
</ul>
<h2>III. Compensación y beneficios iniciales</h2>
<p>El plan de compensación de Aviva será dinámico, y evolucionará conforme logremos objetivos por ello te ofrecemos lo siguiente:</p>
<p><strong>Sueldo Bruto:</strong> \${hired_salary_job} (antes de impuestos)<br>
<strong>Bono Garantía Bruto:</strong> 1750 MXN (pagado únicamente en las primeras 2 quincenas)*<br>
<strong>Bono Mensual Bruto:</strong> 0 a 14373 MXN (acuerdo al cumplimiento de metas de venta, pagado a quincena vencida)*<br>
<strong>Premios bimestral:</strong> bono variable a los 3 primeros lugares de cada grupo de tienda*<br>
<strong>Seguridad social:</strong> IMSS<br>
<strong>Prima vacacional:</strong> 25%<br>
<strong>Prima dominical:</strong> 25%<br>
<strong>Aguinaldo:</strong> 15 días (proporcional a los días laborados en el año)<br>
<strong>Días Aviva:</strong> 7 días personales al año para reavivar tu energía, después de los 4 meses en Aviva<br>
<strong>Día de cumpleaños:</strong> 1 día al año para celebrar tu vida<br>
<strong>Bono de Maternidad o paternidad:</strong> 15 días de tu salario bruto mensual al nacer tu hijo/a</p>
<p><em>*La compensación variable y beneficios superiores  están sujetos a ajustes conforme a la evolución y necesidades de la operación, garantizando siempre esquemas claros, medibles y alineados al desempeño.</em></p>
<p><strong>¡Nos encanta que estés a unos pasos de ser parte de Aviva!</strong></p>
`;

// ─── Cloud Function ────────────────────────────────────────────────────────────

export const signOffer = onRequest(
  { region: 'us-central1', cors: true, invoker: 'public', timeoutSeconds: 300 },
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

      if (candidate.status !== 'offer_sent') {
        res.status(409).json({ ok: false, error: 'Esta carta oferta ya fue firmada.' });
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
        departmentProfile: 'Promotor/a Aviva tu Compra',
        hiringManager:     'Alonso Vargas Díaz',
        company:           'Aviva Financial, S.A. de C.V., SOFOM, ENR',
        salary,
        startDate,
        date: format(now, "d 'de' MMMM 'de' yyyy", { locale: es }),
      };
      const bodyHtml = interpolate(DEFAULT_OFFER_BODY_HTML, vars);

      // ── Generate PDF ──────────────────────────────────────────────────────────
      console.log('[signOffer] Starting PDF generation...');
      const t0 = Date.now();
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await withTimeout(
          generateOfferPdf({
            candidateName: candidateFullName,
            position: positionVal,
            bodyHtml,
            signatureBase64,
            signedAt: now,
          }),
          30_000,
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
        [sigUrl, pdfUrl] = await Promise.all([
          (async () => {
            const f = bucket.file(`candidates/${candidateId}/offer_signature.png`);
            await Promise.race([
              f.save(Buffer.from(sigBase64, 'base64'), { metadata: { contentType: 'image/png' } }),
              gcsTimeout(20_000, 'sig save'),
            ]);
            await Promise.race([f.makePublic(), gcsTimeout(10_000, 'sig makePublic')]);
            return f.publicUrl();
          })(),
          (async () => {
            const f = bucket.file(`candidates/${candidateId}/carta_oferta_firmada.pdf`);
            await Promise.race([
              f.save(pdfBuffer, { metadata: { contentType: 'application/pdf' } }),
              gcsTimeout(20_000, 'pdf save'),
            ]);
            await Promise.race([f.makePublic(), gcsTimeout(10_000, 'pdf makePublic')]);
            return f.publicUrl();
          })(),
        ]);
        console.log(`[signOffer] Storage uploads done in ${Date.now() - t0}ms`);
      } catch (storageErr) {
        console.error('[signOffer] Storage upload error:', storageErr);
        res.status(500).json({ ok: false, error: 'Error al guardar los archivos. Intenta de nuevo.' });
        return;
      }

      // ── Move candidate in Viterbit to "Documentos" (fire-and-forget) ──────────
      const stageIds = candidate.viterbitStageIds as Record<string, string> | undefined;
      const documentosStageId = stageIds?.documentos;
      const candidatureId = candidate.viterbitCandidatureId as string | undefined;

      if (apiKey && documentosStageId && candidatureId) {
        void moveToStage(candidatureId, documentosStageId, apiKey).catch((err) =>
          console.error('[signOffer] moveToStage documentos error:', err)
        );
      }

      // ── Generate documents form token ─────────────────────────────────────────
      const formToken = randomBytes(32).toString('hex');
      const linkDurations = await withTimeout(getLinkDuration(), 8_000, 'getLinkDuration');
      const formExpiresAt = new Date(now.getTime() + linkDurations.formDays * 24 * 60 * 60 * 1000);

      // ── Update candidate in Firestore ─────────────────────────────────────────
      await withTimeout(
        candidateDoc.ref.update({
          status: 'offer_signed',
          offerSignedAt: now,
          offerSignatureUrl: sigUrl,
          offerPdfUrl: pdfUrl,
          formToken,
          formExpiresAt,
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
      const { subject, html } = invitationTemplate({
        firstName: candidate.firstName as string,
        lastName: candidate.lastName as string,
        position: candidate.position as string,
        formUrl,
        formExpiresAt: formExpiresAtStr,
      });
      const createdBy = candidate.createdBy as string;

      void (async () => {
        try {
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

      if (candidate.status !== 'offer_sent') {
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
        departmentProfile: 'Promotor/a Aviva tu Compra',
        hiringManager:     'Alonso Vargas Díaz',
        company:           'Aviva Financial, S.A. de C.V., SOFOM, ENR',
        salary:    offerSalary,
        startDate: offerStartDate,
        date: format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es }),
      };

      const renderedHtml = interpolate(DEFAULT_OFFER_BODY_HTML, vars);

      res.status(200).json({
        ok: true,
        offer: {
          candidateName: candidateFullName2,
          position: positionVal,
          salary: offerSalary,
          startDate: offerStartDate,
          bodyHtml: renderedHtml,
          expiresAt: expiresAt?.toISOString(),
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
