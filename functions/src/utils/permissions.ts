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
