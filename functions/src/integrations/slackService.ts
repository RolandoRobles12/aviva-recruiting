import { defineString, defineSecret } from 'firebase-functions/params';

// ─── Primary workspace: full member ─────────────────────────────────────────
const SLACK_BOT_TOKEN = defineString('SLACK_BOT_TOKEN');

// ─── Performance check channel ───────────────────────────────────────────────
/** Channel ID for 15/30-day performance check alerts (e.g. C08XXXXXXXX). */
const SLACK_PERFORMANCE_CHANNEL_ID = defineString('SLACK_PERFORMANCE_CHANNEL_ID', { default: '' });

// ─── OCR alert bot token + channel ───────────────────────────────────────────
/**
 * Bot token (xoxb-...) with chat:write scope for posting OCR alerts.
 * Store securely: firebase functions:secrets:set SLACK_CHAT_BOT_TOKEN
 */
const SLACK_CHAT_BOT_TOKEN = defineSecret('SLACK_CHAT_BOT_TOKEN');
/** Channel ID (e.g. C08XXXXXXXX) where OCR alerts are posted. */
const SLACK_OCR_CHANNEL_ID = defineString('SLACK_OCR_CHANNEL_ID', { default: '' });

// ─── Secondary workspace: single-channel guest ─────────────────────────────
const SLACK_GUEST_BOT_TOKEN = defineString('SLACK_GUEST_BOT_TOKEN', { default: '' });
const SLACK_GUEST_CHANNEL_ID = defineString('SLACK_GUEST_CHANNEL_ID', { default: '' });

const SLACK_API_BASE = 'https://slack.com/api';

export interface SlackInviteResult {
  ok: boolean;
  userId?: string;
  error?: string;
}

export interface DualSlackResult {
  primary: SlackInviteResult;
  guest: SlackInviteResult;
}

// ─── Internal: invite helper ────────────────────────────────────────────────

async function slackInvite(params: {
  token: string;
  email: string;
  realName: string;
  channelIds?: string[];
  /** Make the user a single-channel guest (ultra_restricted) */
  singleChannelGuest?: boolean;
}): Promise<SlackInviteResult> {
  const { token, email, realName, channelIds, singleChannelGuest } = params;

  if (!token) {
    return { ok: false, error: 'no_token_configured' };
  }

  // ── 1) Try admin.users.invite (Business+ / Enterprise Grid) ──────────────
  const body: Record<string, unknown> = {
    email,
    channel_ids: channelIds ?? [],
    real_name: realName,
  };

  // Single-channel guest = ultra_restricted in Slack API
  if (singleChannelGuest) {
    body.is_ultra_restricted = true;
  }

  const resp = await fetch(`${SLACK_API_BASE}/admin.users.invite`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await resp.json()) as { ok: boolean; error?: string; user_id?: string };

  if (data.ok) {
    return { ok: true, userId: data.user_id };
  }

  // Already invited or already in team counts as success
  if (data.error === 'already_invited' || data.error === 'already_in_team') {
    return { ok: true };
  }

  // ── 2) Fallback: legacy undocumented invite ──────────────────────────────
  if (data.error === 'not_allowed' || data.error === 'paid_teams_only' || data.error === 'missing_scope') {
    console.warn(`[slack] admin.users.invite not available (${data.error}), trying legacy invite`);

    const formParams: Record<string, string> = {
      email,
      real_name: realName,
    };

    if (singleChannelGuest) {
      formParams.ultra_restricted = '1';
    }

    if (channelIds?.length) {
      formParams.channels = channelIds.join(',');
    }

    const legacyResp = await fetch(`${SLACK_API_BASE}/users.admin.invite`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(formParams),
    });

    const legacyData = (await legacyResp.json()) as { ok: boolean; error?: string };

    if (legacyData.ok) {
      return { ok: true };
    }

    if (legacyData.error === 'already_invited' || legacyData.error === 'already_in_team') {
      return { ok: true };
    }

    console.error(`[slack] legacy invite failed: ${legacyData.error}`);
    return { ok: false, error: legacyData.error };
  }

  console.error(`[slack] invite failed: ${data.error}`);
  return { ok: false, error: data.error };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Invite a user as a FULL MEMBER to the primary Slack workspace.
 */
export async function inviteSlackUser(params: {
  corporateEmail: string;
  firstName: string;
  lastName: string;
  channelIds?: string[];
}): Promise<SlackInviteResult> {
  return slackInvite({
    token: SLACK_BOT_TOKEN.value(),
    email: params.corporateEmail,
    realName: `${params.firstName} ${params.lastName}`,
    channelIds: params.channelIds,
  });
}

/**
 * Invite a user as a SINGLE-CHANNEL GUEST to the secondary Slack workspace.
 *
 * The user will only have access to the channel configured in SLACK_GUEST_CHANNEL_ID.
 * This is useful for workspaces where new hires need limited, view-only style access.
 *
 * In Slack terms this is an "ultra_restricted" user — they can only see and
 * participate in a single channel.
 */
export async function inviteSlackGuest(params: {
  corporateEmail: string;
  firstName: string;
  lastName: string;
}): Promise<SlackInviteResult> {
  const guestToken = SLACK_GUEST_BOT_TOKEN.value();
  const guestChannelId = SLACK_GUEST_CHANNEL_ID.value();

  if (!guestToken) {
    console.warn('[slack] SLACK_GUEST_BOT_TOKEN not configured, skipping guest workspace invite');
    return { ok: false, error: 'no_token_configured' };
  }

  if (!guestChannelId) {
    console.warn('[slack] SLACK_GUEST_CHANNEL_ID not configured, skipping guest workspace invite');
    return { ok: false, error: 'no_channel_configured' };
  }

  return slackInvite({
    token: guestToken,
    email: params.corporateEmail,
    realName: `${params.firstName} ${params.lastName}`,
    channelIds: [guestChannelId],
    singleChannelGuest: true,
  });
}

/**
 * Invite a user to BOTH Slack workspaces:
 *  - Primary: full member
 *  - Secondary: single-channel guest
 *
 * Returns results for both invitations independently.
 * Failures in one workspace do not block the other.
 */
export async function inviteSlackDual(params: {
  corporateEmail: string;
  firstName: string;
  lastName: string;
  primaryChannelIds?: string[];
}): Promise<DualSlackResult> {
  const [primary, guest] = await Promise.allSettled([
    inviteSlackUser({
      corporateEmail: params.corporateEmail,
      firstName: params.firstName,
      lastName: params.lastName,
      channelIds: params.primaryChannelIds,
    }),
    inviteSlackGuest({
      corporateEmail: params.corporateEmail,
      firstName: params.firstName,
      lastName: params.lastName,
    }),
  ]);

  return {
    primary: primary.status === 'fulfilled'
      ? primary.value
      : { ok: false, error: String(primary.reason) },
    guest: guest.status === 'fulfilled'
      ? guest.value
      : { ok: false, error: String(guest.reason) },
  };
}

// ─── OCR data-integrity alerts ───────────────────────────────────────────────

const OCR_DOC_LABELS: Record<string, string> = {
  ine:                  'INE',
  curp:                 'CURP',
  nss:                  'NSS',
  acta_nacimiento:      'Acta de Nacimiento',
  caratula_bancaria:    'Carátula Bancaria',
  certificado_estudios: 'Certificado de Estudios',
  constancia_fiscal:    'Constancia Fiscal',
  comprobante_domicilio:'Comprobante de Domicilio',
};

const OCR_FIELD_LABELS: Record<string, string> = {
  curp:  'CURP (18 caracteres)',
  rfc:   'RFC (12-13 caracteres)',
  nss:   'NSS (11 dígitos)',
  clabe: 'CLABE interbancaria (18 dígitos)',
  cp:    'Código Postal (5 dígitos)',
};

async function postOcrAlert(blocks: object[]): Promise<void> {
  const token     = SLACK_CHAT_BOT_TOKEN.value();
  const channelId = SLACK_OCR_CHANNEL_ID.value();
  if (!token || !channelId) return;

  const resp = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channelId, blocks }),
  });
  const data = (await resp.json()) as { ok: boolean; error?: string };
  if (!data.ok) console.error(`[slack] OCR alert failed: ${data.error}`);
}

/**
 * Alert that a valid document still has unreadable critical fields after two
 * OCR attempts.  The recruiter should review the document or ask the candidate
 * to re-upload it before the contract is generated.
 */
export async function notifyFieldsUnreadable(
  candidateId: string,
  candidateName: string,
  documentType: string,
  unreadableFields: string[],
  appUrl: string,
): Promise<void> {
  const docLabel  = OCR_DOC_LABELS[documentType] ?? documentType;
  const fieldList = unreadableFields.map((f) => `• ${OCR_FIELD_LABELS[f] ?? f}`).join('\n');

  await postOcrAlert([
    {
      type: 'header',
      text: { type: 'plain_text', text: '⚠️ OCR: Dato(s) no legibles tras 2 intentos' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Candidato:*\n${candidateName}` },
        { type: 'mrkdwn', text: `*Documento:*\n${docLabel}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Campo(s) sin extraer:*\n${fieldList}\n\nEl documento fue aceptado pero estos datos quedarán en blanco en el contrato. Revísalo o pide al candidato que lo suba de nuevo.`,
      },
    },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Ir al dashboard' }, url: appUrl, style: 'primary' },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `ID: \`${candidateId}\`` }] },
  ]);
}

/**
 * Alert that the CURP read from the INE and the CURP document disagree.
 * This indicates a data-integrity problem that must be resolved before contract
 * generation — one of the documents likely does not belong to this candidate.
 */
export async function notifyCurpMismatch(
  candidateId: string,
  candidateName: string,
  curpFromIne: string,
  curpFromCurpDoc: string,
  appUrl: string,
): Promise<void> {
  await postOcrAlert([
    {
      type: 'header',
      text: { type: 'plain_text', text: '🚨 OCR: CURP no coincide entre documentos' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Candidato:*\n${candidateName}` },
        { type: 'mrkdwn', text: `*CURP en INE:*\n\`${curpFromIne}\`` },
        { type: 'mrkdwn', text: `*CURP en doc. CURP:*\n\`${curpFromCurpDoc}\`` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Los valores no coinciden. Verifica ambos documentos — uno de ellos puede no corresponder a este candidato.',
      },
    },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Ir al dashboard' }, url: appUrl, style: 'danger' },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `ID: \`${candidateId}\`` }] },
  ]);
}

/**
 * Alert that the contract was generated but NOT emailed to the candidate
 * because one or more OCR-sourced fields (CURP, RFC, domicilio, CLABE, banco,
 * NSS) are missing or below the confidence threshold. A recruiter must review
 * and confirm the data in "Datos para el contrato" before it can be sent.
 */
export async function notifyContractReviewRequired(
  candidateId: string,
  candidateName: string,
  reasons: string[],
  appUrl: string,
): Promise<void> {
  await postOcrAlert([
    {
      type: 'header',
      text: { type: 'plain_text', text: '📝 Contrato pendiente de revisión manual' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Candidato:*\n${candidateName}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `El contrato NO se envió automáticamente — el OCR no está seguro de estos datos:\n${reasons.map((r) => `• ${r}`).join('\n')}\n\nRevisa y confirma los valores en la pestaña Contrato antes de enviarlo.`,
      },
    },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Ir al dashboard' }, url: appUrl, style: 'primary' },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `ID: \`${candidateId}\`` }] },
  ]);
}

// ─── 15/30-day performance check alerts ──────────────────────────────────────

export interface PerformanceCheckResult {
  candidateId: string;
  candidateName: string;
  company: string;
  profile: string;
  daysMark: 15 | 30;
  dealCount: number;
  monthlyTarget: number;
  startDate: string;
  appUrl: string;
}

export async function notifyPerformanceCheck(r: PerformanceCheckResult): Promise<void> {
  const token     = SLACK_CHAT_BOT_TOKEN.value();
  const channelId = SLACK_PERFORMANCE_CHANNEL_ID.value();
  if (!token || !channelId) return;

  const proportionalTarget = r.daysMark === 15 ? Math.ceil(r.monthlyTarget / 2) : r.monthlyTarget;
  const onTrack = r.dealCount >= proportionalTarget;
  const pct = r.monthlyTarget > 0 ? Math.round((r.dealCount / r.monthlyTarget) * 100) : 0;

  const headerEmoji = r.daysMark === 30
    ? (onTrack ? '🏆' : '❌')
    : (onTrack ? '✅' : '⚠️');
  const headerText = r.daysMark === 15
    ? `${headerEmoji} Revisión 15 días — ${r.candidateName}`
    : `${headerEmoji} Revisión 30 días — ${r.candidateName}`;
  const statusText = r.daysMark === 15
    ? (onTrack ? 'Va encaminado/a a cumplir la meta mensual' : 'No está en camino a cumplir la meta mensual')
    : (onTrack ? 'Promotor/a exitoso/a — cumplió o superó la meta' : 'No alcanzó la meta mensual — considerar reemplazo');
  const dealsText = r.daysMark === 15
    ? `*Deals creados:* ${r.dealCount} / ${proportionalTarget} esperados a mitad de mes`
    : `*Deals creados:* ${r.dealCount} / ${r.monthlyTarget} meta mensual (${pct}%)`;

  const resp = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: channelId,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: headerText } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Empresa / Dpto:*\n${r.company || '—'}` },
            { type: 'mrkdwn', text: `*Puesto:*\n${r.profile || '—'}` },
            { type: 'mrkdwn', text: `*Fecha de inicio:*\n${r.startDate}` },
            { type: 'mrkdwn', text: `*Meta mensual:*\n${r.monthlyTarget} deals` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `${dealsText}\n\n*${statusText}*` },
        },
        {
          type: 'actions',
          elements: [
            { type: 'button', text: { type: 'plain_text', text: 'Ver expediente' }, url: r.appUrl, style: onTrack ? 'primary' : 'danger' },
          ],
        },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `ID: \`${r.candidateId}\`` }] },
      ],
    }),
  });

  const data = (await resp.json()) as { ok: boolean; error?: string };
  if (!data.ok) console.error(`[slack] performance notify failed: ${data.error}`);
}
