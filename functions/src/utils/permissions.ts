import { db } from './admin';

/**
 * Server-side mirror of the app's role permission check for a single key.
 * Reads users/{uid}.role, honors admin overrides stored in roles/{role}
 * (merged the same way useAuth does), and falls back to the given per-role
 * default when the key is absent. 'admin' always passes; unknown users and
 * roles never do.
 */
export async function userHasPermission(
  uid: string,
  permissionKey: string,
  defaultsByRole: Record<string, boolean>,
): Promise<boolean> {
  if (!uid) return false;

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return false;

  const rawRole = ((userSnap.data() as { role?: string }).role ?? '').trim();
  const role = rawRole === 'recruiter' ? 'reclutador' : rawRole; // legacy value
  if (!role) return false;
  if (role === 'admin') return true;

  try {
    const roleSnap = await db.collection('roles').doc(role).get();
    const perms = roleSnap.exists
      ? (roleSnap.data() as { permissions?: Record<string, unknown> }).permissions
      : undefined;
    if (perms && typeof perms[permissionKey] === 'boolean') {
      return perms[permissionKey] as boolean;
    }
  } catch {
    // Fall back to defaults
  }

  return defaultsByRole[role] ?? false;
}

/** Same defaults as the client's candidates_view_own / candidates_view_all. */
const VIEW_OWN_DEFAULTS = { reclutador: true, lider: true, nomina: false, legal: false };
const VIEW_ALL_DEFAULTS = { reclutador: false, lider: true, nomina: true, legal: true };

/**
 * For callables that act on a candidate from the candidate panel (sync to
 * Drive, append to Sheets): any staff role that can see candidates. Being
 * signed in used to be enough, which let any Firebase account trigger writes.
 */
export async function requireCandidateAccess(uid: string | undefined): Promise<void> {
  // Imported lazily so this module stays usable without firebase-functions.
  const { HttpsError } = await import('firebase-functions/v2/https');
  if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  const [own, all] = await Promise.all([
    userHasPermission(uid, 'candidates_view_own', VIEW_OWN_DEFAULTS),
    userHasPermission(uid, 'candidates_view_all', VIEW_ALL_DEFAULTS),
  ]);
  if (!own && !all) {
    throw new HttpsError('permission-denied', 'No tienes permiso para trabajar con candidatos.');
  }
}
