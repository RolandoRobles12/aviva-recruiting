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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<RecruiterProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const profileSnap = await getDoc(doc(db, 'recruiters', firebaseUser.uid));
        if (profileSnap.exists()) {
          setProfile(profileSnap.data() as RecruiterProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const firebaseUser = result.user;

    // Upsert recruiter profile
    const profileRef = doc(db, 'recruiters', firebaseUser.uid);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) {
      const newProfile: RecruiterProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email!,
        displayName: firebaseUser.displayName ?? 'Reclutador',
        photoUrl: firebaseUser.photoURL ?? undefined,
        role: 'recruiter',
        createdAt: serverTimestamp() as ReturnType<typeof serverTimestamp> as never,
      };
      await setDoc(profileRef, newProfile);
      setProfile(newProfile);
    } else {
      setProfile(profileSnap.data() as RecruiterProfile);
    }
  };

  const signOut = () => firebaseSignOut(auth);

  return { user, profile, loading, signInWithGoogle, signOut };
}
