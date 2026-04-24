interface CandidateInfo {
  firstName: string;
  lastName: string;
  position: string;
  formUrl: string;
  formExpiresAt: string;
}

function logoBlock(logoUrl?: string): string {
  if (logoUrl) {
    return `<img src="${logoUrl}" alt="Aviva" height="48" style="display:block;margin:0 auto 12px;max-height:48px;max-width:220px;object-fit:contain;" />`;
  }
  return `<div style="width:52px;height:52px;background:rgba(255,255,255,0.2);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
            <span style="color:#fff;font-size:24px;font-weight:bold;">A</span>
          </div>`;
}

export function ocrErrorTemplate(
  c: Pick<CandidateInfo, 'firstName' | 'lastName' | 'position' | 'formUrl'>,
  documentLabel: string,
  errors: string[],
  details?: { documentTypeDetected?: string; confidence?: number }
): { subject: string; html: string } {
  const errorList = errors.map((e) => `<li>${e}</li>`).join('');
  const detectedBadge =
    details?.documentTypeDetected && details.documentTypeDetected !== 'parse_error' && details.documentTypeDetected !== 'unknown'
      ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;margin-bottom:16px;">
            <p style="color:#9a3412;font-size:12px;margin:0;">
              <strong>Documento detectado:</strong> ${details.documentTypeDetected}${details.confidence != null ? ` · Confianza: ${Math.round(details.confidence * 100)}%` : ''}
            </p>
          </div>`
      : '';
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

          <!-- Detected document badge -->
          ${detectedBadge}

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

export function invitationTemplate(
  c: CandidateInfo,
  customBodyText?: string,
  logoUrl?: string,
): { subject: string; html: string } {
  const bodyText =
    customBodyText ??
    'Nos da gusto que vayas a formar parte del equipo. Para continuar con tu proceso de ingreso, necesitamos que subas los siguientes documentos a través del enlace a continuación.';
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
          ${logoBlock(logoUrl)}
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">¡Bienvenido a Aviva!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Proceso de ingreso · ${c.position}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hola <strong>${c.firstName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
            ${bodyText}
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

export function offerTemplate(c: {
  firstName: string;
  lastName: string;
  position: string;
  offerUrl: string;
  offerExpiresAt: string;
  logoUrl?: string;
}): { subject: string; html: string } {
  return {
    subject: `Aviva | Tu carta oferta está lista — ${c.position}`,
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
          ${logoBlock(c.logoUrl)}
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">¡Felicidades, ${c.firstName}!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Tu carta oferta · ${c.position}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hola <strong>${c.firstName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
            Nos da mucho gusto informarte que has sido seleccionado para formar parte del equipo de Aviva.
            Hemos preparado tu carta oferta para el puesto de <strong>${c.position}</strong>.
            Por favor léela con atención y, si estás de acuerdo, fírmala digitalmente.
          </p>
          <!-- CTA Button -->
          <div style="text-align:center;margin:28px 0;">
            <a href="${c.offerUrl}" style="background:#16b877;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;display:inline-block;">
              Ver y firmar carta oferta →
            </a>
          </div>
          <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
            Este enlace es personal e intransferible. Expira el <strong>${c.offerExpiresAt}</strong>.
          </p>
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

export function onboardingTemplate(c: {
  firstName: string;
  lastName: string;
  position: string;
  logoUrl?: string;
}): { subject: string; html: string } {
  return {
    subject: `Aviva | ¡Bienvenido al equipo! Próximos pasos — ${c.position}`,
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
          ${logoBlock(c.logoUrl)}
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">¡Bienvenido a Aviva!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">${c.position}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hola <strong>${c.firstName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 20px;">
            Tu documentación ha sido revisada y aprobada. Estás listo para comenzar tu proceso de onboarding.
            En breve recibirás más información sobre los próximos pasos.
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
            <p style="color:#15803d;font-size:14px;font-weight:600;margin:0 0 8px;">Tu proceso está completo</p>
            <p style="color:#166534;font-size:13px;margin:0;line-height:1.6;">
              Tu reclutador se pondrá en contacto contigo pronto para coordinar tu primer día y presentarte al equipo.
            </p>
          </div>
          <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
            Si tienes alguna pregunta, no dudes en responder a este correo.
          </p>
        </td></tr>
        <!-- Footer -->
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

export function contractTemplate(c: {
  firstName: string;
  lastName: string;
  position: string;
  contractUrl: string;
  contractExpiresAt: string;
  logoUrl?: string;
}): { subject: string; html: string } {
  return {
    subject: `Aviva | Tu contrato laboral está listo para firmar — ${c.position}`,
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
          ${logoBlock(c.logoUrl)}
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Contrato de Trabajo</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">${c.position}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hola <strong>${c.firstName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
            Tu contrato laboral para el puesto de <strong>${c.position}</strong> está listo.
            Por favor léelo con atención y fírmalo digitalmente desde cualquier dispositivo.
            Tu firma electrónica simple tiene validez legal conforme a la legislación mexicana.
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="color:#15803d;font-size:13px;font-weight:600;margin:0 0 6px;">Firma electrónica simple (FES)</p>
            <p style="color:#166534;font-size:12px;margin:0;line-height:1.5;">
              Tu firma será registrada con evidencia criptográfica (SHA-256), IP, fecha/hora y certificado de firma.
            </p>
          </div>
          <!-- CTA Button -->
          <div style="text-align:center;margin:28px 0;">
            <a href="${c.contractUrl}" style="background:#16b877;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;display:inline-block;">
              Ver y firmar contrato →
            </a>
          </div>
          <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
            Este enlace es personal e intransferible. Expira el <strong>${c.contractExpiresAt}</strong>.
          </p>
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

export function inductionTemplate(c: {
  firstName: string;
  lastName: string;
  position: string;
  corporateEmail: string;
  logoUrl?: string;
}): { subject: string; html: string } {
  return {
    subject: `Aviva | Tus cuentas están listas — Inducción y capacitación`,
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
          ${logoBlock(c.logoUrl)}
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">¡Todo listo, ${c.firstName}!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Inducción y Capacitación · ${c.position}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hola <strong>${c.firstName}</strong>,</p>
          <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">
            Tus cuentas corporativas han sido creadas. A continuación encontrarás la información
            que necesitas para comenzar tu capacitación e inducción.
          </p>

          <!-- Corporate email -->
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;margin-bottom:20px;">
            <p style="color:#1e40af;font-size:13px;font-weight:600;margin:0 0 6px;">Tu correo corporativo</p>
            <p style="color:#1e3a5f;font-size:16px;font-weight:700;margin:0;">${c.corporateEmail}</p>
          </div>

          <!-- Accounts info -->
          <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:24px;">
            <p style="color:#374151;font-size:13px;font-weight:600;margin:0 0 12px;">Cuentas creadas:</p>
            <ul style="margin:0;padding-left:20px;color:#6b7280;font-size:13px;line-height:2.2;">
              <li><strong>Correo corporativo:</strong> ${c.corporateEmail}</li>
              <li><strong>HubSpot:</strong> Se creó tu usuario con tu correo corporativo</li>
              <li><strong>Slack (principal):</strong> Recibirás una invitación al espacio principal de Aviva como miembro completo</li>
              <li><strong>Slack (comunicación):</strong> Recibirás una invitación a un segundo espacio con acceso al canal de tu equipo</li>
            </ul>
          </div>

          <!-- Induction steps -->
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
            <p style="color:#15803d;font-size:13px;font-weight:600;margin:0 0 12px;">Pasos de inducción:</p>
            <ol style="margin:0;padding-left:20px;color:#166534;font-size:13px;line-height:2.2;">
              <li>Inicia sesión en tu correo corporativo con las credenciales que te compartirá IT</li>
              <li>Acepta <strong>ambas</strong> invitaciones de Slack que llegarán a tu correo corporativo</li>
              <li>Inicia sesión en HubSpot con tu correo corporativo</li>
              <li>Tu reclutador o líder de equipo te contactará para coordinar tu primer día</li>
            </ol>
          </div>

          <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">
            Si tienes problemas con el acceso a cualquiera de tus cuentas, responde a este correo
            o contacta al equipo de IT.
          </p>
        </td></tr>
        <!-- Footer -->
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

export function reminderTemplate(
  c: CandidateInfo,
  missingDocs: string[],
  customBodyText?: string,
  logoUrl?: string,
): { subject: string; html: string } {
  const missingList = missingDocs.map((d) => `<li>${d}</li>`).join('');
  const bodyText =
    customBodyText ??
    'Notamos que aún tienes documentos pendientes por subir. Para no retrasar tu proceso de ingreso, te pedimos que los completes lo antes posible.';
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
            ${bodyText}
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
