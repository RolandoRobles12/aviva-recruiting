import { defineString } from 'firebase-functions/params';

const SLACK_BOT_TOKEN = defineString('SLACK_BOT_TOKEN');

const SLACK_API_BASE = 'https://slack.com/api';

/**
 * Invite a user to the Slack workspace using their corporate email.
 * Uses the undiscovered admin.users.invite if available, otherwise
 * falls back to conversations.invite after user joins.
 *
 * Note: Slack user invitation via API requires an admin/owner token
 * with the `admin.users:write` scope (Enterprise Grid) or
 * `users:write` scope. For standard workspaces, use
 * the SCIM API or manual invitation as fallback.
 */
export async function inviteSlackUser(params: {
  corporateEmail: string;
  firstName: string;
  lastName: string;
  channelIds?: string[];
}): Promise<{ ok: boolean; userId?: string }> {
  const token = SLACK_BOT_TOKEN.value();

  // Try admin.users.invite (Enterprise Grid / Business+)
  const resp = await fetch(`${SLACK_API_BASE}/admin.users.invite`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: params.corporateEmail,
      channel_ids: params.channelIds ?? [],
      real_name: `${params.firstName} ${params.lastName}`,
    }),
  });

  const data = (await resp.json()) as { ok: boolean; error?: string; user_id?: string };

  if (data.ok) {
    return { ok: true, userId: data.user_id };
  }

  // If admin API is not available, try legacy undocumented invite
  if (data.error === 'not_allowed' || data.error === 'paid_teams_only' || data.error === 'missing_scope') {
    console.warn(`[slack] admin.users.invite not available (${data.error}), trying legacy invite`);

    const legacyResp = await fetch(`${SLACK_API_BASE}/users.admin.invite`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: params.corporateEmail,
        real_name: `${params.firstName} ${params.lastName}`,
      }),
    });

    const legacyData = (await legacyResp.json()) as { ok: boolean; error?: string };

    if (legacyData.ok) {
      return { ok: true };
    }

    // Already invited or already in team is still a success
    if (legacyData.error === 'already_invited' || legacyData.error === 'already_in_team') {
      return { ok: true };
    }

    console.error(`[slack] invite failed: ${legacyData.error}`);
    return { ok: false };
  }

  // already_invited / already_in_team counts as success
  if (data.error === 'already_invited' || data.error === 'already_in_team') {
    return { ok: true };
  }

  console.error(`[slack] invite failed: ${data.error}`);
  return { ok: false };
}
