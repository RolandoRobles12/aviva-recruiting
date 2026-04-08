import { useState, useEffect, useCallback } from 'react';
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';
import type { RecruiterProfile } from '../types';
import type { PermissionKey, RolePermissions } from '../types/permissions';
import { ROLE_DEFAULTS, ALL_PERMISSIONS, normalizeRole } from '../types/permissions';

async function upsertProfile(firebaseUser: User): Promise<RecruiterProfile> {
  const profileRef = doc(db, 'users', firebaseUser.uid);
  const profileSnap = await getDoc(profileRef);
  if (!profileSnap.exists()) {
    const newProfile: RecruiterProfile = {
      uid: firebaseUser.uid,
      email: firebaseUser.email!,
      displayName: firebaseUser.displayName ?? 'Reclutador',
      photoUrl: firebaseUser.photoURL ?? undefined,
      role: 'reclutador',
      createdAt: serverTimestamp() as never,
    };
    await setDoc(profileRef, newProfile);
    return newProfile;
  }
  return profileSnap.data() as RecruiterProfile;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<RecruiterProfile | null>(null);
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Subscribe to role permissions in Firestore whenever the user's role changes
  useEffect(() => {
    if (!profile?.role) {
      setPermissions(null);
      return;
    }

    const role = normalizeRole(profile.role as Parameters<typeof normalizeRole>[0]);

    if (role === 'admin') {
      setPermissions(ALL_PERMISSIONS);
      return;
    }

    // Pre-populate with hardcoded defaults immediately (no flash)
    setPermissions(ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.reclutador);

    // Then subscribe for live Firestore updates (admin can edit permissions in real-time)
    const unsubscribe = onSnapshot(
      doc(db, 'roles', role),
      (snap) => {
        if (snap.exists() && snap.data().permissions) {
          setPermissions(snap.data().permissions as RolePermissions);
        }
      },
      () => {
        // Permission denied or offline — keep defaults already set
      }
    );

    return unsubscribe;
  }, [profile?.role]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const profileSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (profileSnap.exists()) {
            setProfile(profileSnap.data() as RecruiterProfile);
          }
        } catch {
          // Firestore rules pending deploy — non-blocking
        }
      } else {
        setProfile(null);
        setPermissions(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  /**
   * Check if the current user has a specific permission.
   * Admin always returns true. Falls back to hardcoded defaults while Firestore loads.
   */
  const can = useCallback(
    (permission: PermissionKey): boolean => {
      if (!profile) return false;
      const role = normalizeRole(profile.role as Parameters<typeof normalizeRole>[0]);
      if (role === 'admin') return true;
      const perms = permissions ?? ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.reclutador;
      return perms[permission] ?? false;
    },
    [profile, permissions]
  );

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result?.user) {
        try {
          const p = await upsertProfile(result.user);
          setProfile(p);
        } catch (err) {
          console.warn('Profile save failed (deploy rules to fix):', err);
        }
      }
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      const code = error?.code ?? '';
      const messages: Record<string, string> = {
        'auth/unauthorized-domain':
          'Este dominio no está autorizado en Firebase. Agrega "localhost" en Authentication → Settings → Authorized domains.',
        'auth/operation-not-allowed':
          'El proveedor de Google no está habilitado. Actívalo en Firebase Console → Authentication → Sign-in method → Google.',
        'auth/invalid-api-key':
          'La API key de Firebase es inválida. Revisa tu archivo .env.',
        'auth/configuration-not-found':
          'Configuración de Firebase no encontrada. Verifica que el .env tiene los valores correctos.',
        'auth/popup-closed-by-user':
          'Cerraste la ventana de Google antes de completar el inicio de sesión.',
        'auth/popup-blocked':
          'El navegador bloqueó la ventana emergente. Permite los popups para localhost.',
      };
      setAuthError(messages[code] ?? `Error de autenticación: ${error?.message ?? code}`);
      console.error('signInWithPopup error:', err);
    }
  };

  const signOut = () => firebaseSignOut(auth);

  return { user, profile, permissions, loading, authError, can, signInWithGoogle, signOut };
}
