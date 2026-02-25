import { useState, useEffect } from 'react';
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';
import type { RecruiterProfile } from '../types';

async function upsertProfile(firebaseUser: User): Promise<RecruiterProfile> {
  const profileRef = doc(db, 'recruiters', firebaseUser.uid);
  const profileSnap = await getDoc(profileRef);
  if (!profileSnap.exists()) {
    const newProfile: RecruiterProfile = {
      uid: firebaseUser.uid,
      email: firebaseUser.email!,
      displayName: firebaseUser.displayName ?? 'Reclutador',
      photoUrl: firebaseUser.photoURL ?? undefined,
      role: 'recruiter',
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
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const profileSnap = await getDoc(doc(db, 'recruiters', firebaseUser.uid));
          if (profileSnap.exists()) {
            setProfile(profileSnap.data() as RecruiterProfile);
          }
        } catch {
          // Firestore rules pending deploy — non-blocking
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

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

  return { user, profile, loading, authError, signInWithGoogle, signOut };
}
