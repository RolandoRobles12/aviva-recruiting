import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Candidate } from '../types';
import { getCandidateByToken } from '../services/candidates';

export function useCandidateForm(token: string | undefined) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Token inválido.');
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;

    getCandidateByToken(token)
      .then((found) => {
        if (!found) {
          setError('El enlace no es válido o ha expirado.');
          setLoading(false);
          return;
        }

        const now = new Date();
        const expiresAt = found.formExpiresAt?.toDate?.();
        if (expiresAt && expiresAt < now) {
          setError('Este enlace ha expirado. Contacta al reclutador para solicitar uno nuevo.');
          setLoading(false);
          return;
        }

        // Subscribe to real-time updates
        unsubscribe = onSnapshot(doc(db, 'candidates', found.id), (snap) => {
          if (snap.exists()) {
            setCandidate({ id: snap.id, ...snap.data() } as Candidate);
          }
          setLoading(false);
        });
      })
      .catch(() => {
        setError('Error al cargar el formulario. Intenta de nuevo.');
        setLoading(false);
      });

    return () => unsubscribe?.();
  }, [token]);

  return { candidate, loading, error };
}
