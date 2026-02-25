import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Candidate, DashboardStats } from '../types';

export function useCandidates() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'candidates'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setCandidates(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate)));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const stats: DashboardStats = {
    total: candidates.length,
    invited: candidates.filter((c) => c.status === 'invited').length,
    inProgress: candidates.filter((c) => c.status === 'in_progress').length,
    underReview: candidates.filter((c) => c.status === 'under_review').length,
    approved: candidates.filter((c) => c.status === 'approved').length,
    rejected: candidates.filter((c) => c.status === 'rejected').length,
  };

  return { candidates, loading, stats };
}

export function useCandidate(id: string | undefined) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    const unsubscribe = onSnapshot(doc(db, 'candidates', id), (snap) => {
      if (snap.exists()) {
        setCandidate({ id: snap.id, ...snap.data() } as Candidate);
      } else {
        setCandidate(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [id]);

  return { candidate, loading };
}
