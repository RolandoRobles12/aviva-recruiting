import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  updateDoc,
  collection,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { RoleType, RolePermissions } from '../types/permissions';
import { ROLE_DEFAULTS, normalizeRole } from '../types/permissions';
import type { RecruiterProfile } from '../types';

// ─── Role permissions ──────────────────────────────────────────────────────────

export async function getRolePermissions(role: RoleType): Promise<RolePermissions> {
  if (role === 'admin') return ROLE_DEFAULTS.admin;
  try {
    const snap = await getDoc(doc(db, 'roles', role));
    if (snap.exists() && snap.data().permissions) {
      return snap.data().permissions as RolePermissions;
    }
  } catch {
    // Firestore rules may deny — fall through to defaults
  }
  return ROLE_DEFAULTS[role];
}

export async function updateRolePermissions(
  role: RoleType,
  permissions: RolePermissions
): Promise<void> {
  if (role === 'admin') throw new Error('El rol Admin no se puede modificar.');
  await setDoc(
    doc(db, 'roles', role),
    { permissions, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ─── Users (recruiters) ────────────────────────────────────────────────────────

export async function getAllRecruiters(): Promise<RecruiterProfile[]> {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => d.data() as RecruiterProfile);
}

export async function updateUserRole(uid: string, role: RoleType): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    role,
    updatedAt: serverTimestamp(),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count users per (normalized) role from a list of profiles */
export function countByRole(recruiters: RecruiterProfile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of recruiters) {
    const role = normalizeRole(r.role as import('../types/permissions').StoredRoleType);
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}
