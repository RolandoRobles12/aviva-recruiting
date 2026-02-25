import { useState, useEffect } from 'react';
import {
  signInWithRedirect,
  getRedirectResult,
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

  useEffect(() => {
    // Handle the result after Google redirect returns to the app
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          const p = await upsertProfile(result.user);
          setProfile(p);
        }
      })
      .catch(console.error);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const profileSnap = await getDoc(doc(db, 'recruiters', firebaseUser.uid));
          if (profileSnap.exists()) {
            setProfile(profileSnap.data() as RecruiterProfile);
          }
        } catch {
          // Rules not yet deployed — profile fetch will succeed after deploy
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Redirect to Google → after auth Google redirects back to the app
  // getRedirectResult (above) picks up the result on the return
  const signInWithGoogle = () => signInWithRedirect(auth, googleProvider);

  const signOut = () => firebaseSignOut(auth);

  return { user, profile, loading, signInWithGoogle, signOut };
}
