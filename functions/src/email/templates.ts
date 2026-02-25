interface CandidateInfo {
  firstName: string;
  lastName: string;
  position: string;
  formUrl: string;
  formExpiresAt: string;
}

export function ocrErrorTemplate(
  c: Pick<CandidateInfo, 'firstName' | 'lastName' | 'position' | 'formUrl'>,
  documentLabel: string,
  errors: string[]
): { subject: string; html: string } {
  const errorList = errors.map((e) => `<li>${e}</li>`).join('');
  return {
    subject: `Aviva | Documento inválido, sube nuevamente — ${documentLabel}`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <!-- Header rojo -->
        <tr><td style="background:#ef4444;padding:28px 40px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">Documento Inválido</h1>
          <p style="color:rgba(255,255,255,0.9);margin:6px 0 0;font-size:13px;">Necesitamos que vuelvas a subirlo corregido</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <p style="color:#374151;font-size:15px;margin:0 0 12px;">Hola <strong>${c.firstName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 20px;">
            Revisamos el documento que subiste (<strong>${documentLabel}</strong>) y encontramos
            los siguientes problemas que impiden su validación:
          </p>

          <!-- Errors list -->
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="color:#991b1b;font-size:13px;font-weight:600;margin:0 0 8px;">Problemas encontrados:</p>
            <ul style="margin:0;padding-left:20px;color:#b91c1c;font-size:13px;line-height:2;">${errorList}</ul>
          </div>

          <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 24px;">
            Por favor asegúrate de subir el documento correcto y legible (sin recortes, buena iluminación, sin reflejos).
            Puedes volver a subir el documento usando el mismo enlace de tu proceso de ingreso.
          </p>

          <!-- CTA -->
          <div style="text-align:center;margin:24px 0;">
            <a href="${c.formUrl}" style="background:#16b877;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;display:inline-block;">
              Volver a subir documento →
            </a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            Si tienes dudas, responde a este correo o contacta a tu reclutador.<br>
            © ${new Date().getFullYear()} Aviva · Equipo de Reclutamiento
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

export function invitationTemplate(c: CandidateInfo): { subject: string; html: string } {
  return {
    subject: `Aviva | Sube tu documentación de ingreso — ${c.position}`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <!-- Header -->
        <tr><td style="background:#16b877;padding:32px 40px;text-align:center;">
          <div style="width:52px;height:52px;background:rgba(255,255,255,0.2);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
            <span style="color:#fff;font-size:24px;font-weight:bold;">A</span>
          </div>
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">¡Bienvenido a Aviva!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Proceso de ingreso · ${c.position}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hola <strong>${c.firstName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
            Nos da gusto que vayas a formar parte del equipo. Para continuar con tu proceso de ingreso,
            necesitamos que subas los siguientes documentos a través del enlace a continuación.
          </p>

          <!-- Documents list -->
          <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:24px;">
            <p style="color:#374151;font-size:13px;font-weight:600;margin:0 0 12px;">Documentos requeridos:</p>
            <ul style="margin:0;padding-left:20px;color:#6b7280;font-size:13px;line-height:2;">
              <li>INE / Identificación oficial vigente</li>
              <li>CURP</li>
              <li>RFC con homoclave (SAT)</li>
              <li>Comprobante de domicilio (máx. 3 meses)</li>
              <li>Comprobante de estudios (título o certificado)</li>
            </ul>
          </div>

          <!-- CTA Button -->
          <div style="text-align:center;margin:28px 0;">
            <a href="${c.formUrl}" style="background:#16b877;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;display:inline-block;">
              Subir mi documentación →
            </a>
          </div>

          <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
            Este enlace es personal e intransferible. Expira el <strong>${c.formExpiresAt}</strong>.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            Si tienes dudas, responde a este correo o contacta directamente a tu reclutador.<br>
            © ${new Date().getFullYear()} Aviva · Equipo de Reclutamiento
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

export function reminderTemplate(
  c: CandidateInfo,
  missingDocs: string[]
): { subject: string; html: string } {
  const missingList = missingDocs.map((d) => `<li>${d}</li>`).join('');
  return {
    subject: `Aviva | Recordatorio: Documentos pendientes — ${c.position}`,
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#f59e0b;padding:24px 40px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">📋 Documentos Pendientes</h1>
          <p style="color:rgba(255,255,255,0.9);margin:6px 0 0;font-size:13px;">Tu proceso de ingreso necesita tu atención</p>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="color:#374151;font-size:15px;margin:0 0 12px;">Hola <strong>${c.firstName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 20px;">
            Notamos que aún tienes documentos pendientes por subir. Para no retrasar tu proceso de ingreso,
            te pedimos que los completes lo antes posible.
          </p>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="color:#92400e;font-size:13px;font-weight:600;margin:0 0 8px;">Documentos faltantes:</p>
            <ul style="margin:0;padding-left:20px;color:#b45309;font-size:13px;line-height:2;">${missingList}</ul>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${c.formUrl}" style="background:#16b877;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;display:inline-block;">
              Completar documentación →
            </a>
          </div>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            © ${new Date().getFullYear()} Aviva · Equipo de Reclutamiento
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
