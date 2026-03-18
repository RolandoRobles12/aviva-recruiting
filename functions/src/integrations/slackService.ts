import { defineString } from 'firebase-functions/params';

// ─── Primary workspace: full member ─────────────────────────────────────────
const SLACK_BOT_TOKEN = defineString('SLACK_BOT_TOKEN');

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
