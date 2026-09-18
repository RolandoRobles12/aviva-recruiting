/**
 * Admin callables behind Configuración → HubSpot.
 *
 * The role that grants "ver todos los contactos y negocios" is a portal-level
 * decision, and its id is only discoverable from HubSpot itself, so the app
 * lists the portal's roles, stores the chosen one in `settings/hubspot`, and
 * can top up the accounts created before it was configured.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../utils/admin';
import { userHasPermission } from '../utils/permissions';
import {
  clearHubSpotSettingsCache,
  ensureHubSpotUserRole,
  getHubSpotPortalSettings,
  listHubSpotRoles,
  type RoleAssignment,
} from './hubspotService';

/** Same defaults as the client's config_settings permission. */
const SETTINGS_DEFAULTS = {
  reclutador: false,
  lider: true,
  nomina: false,
  legal: false,
};

async function requireSettingsManager(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'No autenticado');
  const allowed = await userHasPermission(uid, 'config_settings', SETTINGS_DEFAULTS);
  if (!allowed) {
    throw new HttpsError('permission-denied', 'No tienes permiso para configurar la integración con HubSpot.');
  }
}

/** Roles defined in the HubSpot portal, plus which one is configured here. */
export const listHubspotRoles = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    await requireSettingsManager(request.auth?.uid);
    clearHubSpotSettingsCache();

    try {
      const [roles, settings] = await Promise.all([listHubSpotRoles(), getHubSpotPortalSettings()]);
      return { roles, roleId: settings.roleId, primaryTeamId: settings.primaryTeamId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpsError('unavailable', `No se pudieron leer los roles de HubSpot: ${message}`);
    }
  },
);

export interface RoleSyncEntry {
  candidateId: string;
  name: string;
  email: string;
  status: RoleAssignment;
  error?: string;
}

/**
 * Applies the configured role to every provisioned HubSpot account that has
 * none — the accounts created before this setting existed, which is why they
 * landed on "solo sus propios contactos y negocios". Accounts that already
 * carry a role are reported and left untouched.
 */
export const syncHubspotUserRoles = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 540 },
  async (request) => {
    await requireSettingsManager(request.auth?.uid);
    clearHubSpotSettingsCache();

    const { dryRun = false } = (request.data ?? {}) as { dryRun?: boolean };

    const { roleId } = await getHubSpotPortalSettings();
    if (!roleId) {
      throw new HttpsError(
        'failed-precondition',
        'Primero elige el rol de HubSpot que deben tener las cuentas nuevas.',
      );
    }

    const snap = await db.collection('candidates').where('corporateEmail', '!=', null).get();

    const seen = new Set<string>();
    const targets: Array<{ candidateId: string; name: string; email: string }> = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      const email = String(data.corporateEmail ?? '').trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        candidateId: doc.id,
        name: `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim(),
        email,
      });
    }

    const entries: RoleSyncEntry[] = [];
    // Sequential on purpose: the HubSpot settings API is rate limited far more
    // tightly than the CRM one, and this runs at most a few times.
    for (const target of targets) {
      const result = await ensureHubSpotUserRole(target.email, { dryRun });
      entries.push({ ...target, status: result.status, error: result.error });
    }

    const count = (status: RoleAssignment) => entries.filter((e) => e.status === status).length;
    const assigned = count(dryRun ? 'would_assign' : 'assigned');
    const alreadySet = count('already_set');
    const notFound = count('user_not_found');
    const errors = count('error');

    const message = dryRun
      ? `${entries.length} cuenta(s) revisada(s): ${assigned} sin rol, ${alreadySet} ya con rol, ${notFound} sin usuario en HubSpot, ${errors} con error.`
      : `${entries.length} cuenta(s) revisada(s): ${assigned} actualizada(s), ${alreadySet} ya con rol, ${notFound} sin usuario en HubSpot, ${errors} con error.`;

    return {
      dryRun,
      roleId,
      checked: entries.length,
      assigned,
      alreadySet,
      notFound,
      errors,
      // Only the accounts that need attention — a full list would be noise.
      details: entries.filter((e) => e.status !== 'already_set'),
      message,
    };
  },
);
