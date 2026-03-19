import { useEffect, useState } from 'react';
import { getFormQuestions } from '../services/formQuestions';
import type { FormQuestion } from '../types';

export function useFormQuestions() {
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFormQuestions()
      .then((qs) => setQuestions(qs.filter((q) => q.enabled).sort((a, b) => a.order - b.order)))
      .finally(() => setLoading(false));
  }, []);

  return { questions, loading };
}
