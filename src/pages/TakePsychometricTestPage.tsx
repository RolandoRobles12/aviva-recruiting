import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { usePsychometricTestSession, submitPsychometricTest, type TestQuestion } from '../hooks/usePsychometricTestSession';

const LIKERT_LABELS = [
  'Totalmente en desacuerdo',
  'En desacuerdo',
  'Neutral',
  'De acuerdo',
  'Totalmente de acuerdo',
];

function formatTime(totalSeconds: number): string {
  const m = Math.max(0, Math.floor(totalSeconds / 60));
  const s = Math.max(0, Math.floor(totalSeconds % 60));
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TakePsychometricTestPage() {
  const { token } = useParams<{ token: string }>();
  const { data, loading, error, start } = usePsychometricTestSession(token);
  const [consented, setConsented] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const autoSubmitted = useRef(false);

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Tracks how long each question stayed on screen before the candidate moved
  // on — used server-side to flag suspiciously fast (careless) responses.
  const responseTimesRef = useRef<Record<string, number>>({});
  const questionShownAtRef = useRef(0);
  useEffect(() => {
    questionShownAtRef.current = Date.now();
  }, [currentIndex]);

  const submit = useMemo(
    () => async () => {
      if (!token || autoSubmitted.current) return;
      autoSubmitted.current = true;
      setSubmitting(true);
      const payload = Object.entries(answersRef.current).map(([questionId, value]) => ({
        questionId,
        value,
        responseMs: responseTimesRef.current[questionId],
      }));
      const result = await submitPsychometricTest(token, payload);
      setSubmitting(false);
      if (result.ok) {
        setSubmitted(true);
      } else {
        setSubmitError(result.error ?? 'Error al enviar tus respuestas.');
      }
    },
    [token]
  );

  // Countdown, driven by the server-assigned start time.
  useEffect(() => {
    if (!data?.startedAtIso) return;
    const deadline = new Date(data.startedAtIso).getTime() + data.timeLimitMinutes * 60 * 1000;

    const tick = () => {
      const secondsLeft = (deadline - Date.now()) / 1000;
      setRemainingSeconds(secondsLeft);
      if (secondsLeft <= 0) {
        void submit();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [data, submit]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo">
        <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo px-4">
        <div className="card p-8 max-w-md w-full text-center">
          <AlertTriangle size={40} className="mx-auto text-yellow-400 mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Enlace no válido</h2>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo px-4">
        <div className="card p-8 max-w-md w-full text-center">
          <CheckCircle size={48} className="mx-auto mb-4" style={{ color: '#16b877' }} />
          <h2 className="text-xl font-bold text-gray-900 mb-2">¡Gracias por completar la prueba!</h2>
          <p className="text-sm text-gray-600">
            Tus respuestas fueron recibidas. El equipo de reclutamiento dará seguimiento a tu proceso.
          </p>
        </div>
      </div>
    );
  }

  // ── Instructions / consent screen (shown before the timer starts) ──
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo px-4">
        <div className="card p-8 max-w-lg w-full space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Prueba psicométrica</h2>
          <ul className="text-sm text-gray-600 space-y-1.5 list-disc list-inside">
            <li>La prueba dura un máximo de <strong>30 minutos</strong>.</li>
            <li>Una vez iniciada, el tiempo corre de forma continua y no se puede pausar.</li>
            <li>No podrás regresar a una pregunta ya respondida.</li>
            <li>Responde con honestidad — no hay respuestas correctas o incorrectas.</li>
          </ul>
          <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer pt-2 border-t border-gray-100">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <span>
              Acepto que mis respuestas sean usadas únicamente como parte de mi proceso de reclutamiento
              en Aviva y no serán compartidas con terceros.
            </span>
          </label>
          {submitError && <p className="text-xs text-red-600">{submitError}</p>}
          <button
            onClick={start}
            disabled={!consented}
            className="btn-primary w-full text-sm py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Comenzar la prueba
          </button>
        </div>
      </div>
    );
  }

  if (data.questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo px-4">
        <div className="card p-8 max-w-md w-full text-center">
          <AlertTriangle size={40} className="mx-auto text-yellow-400 mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Prueba no disponible</h2>
          <p className="text-sm text-gray-500">
            No hay preguntas configuradas todavía. Contacta al equipo de reclutamiento.
          </p>
        </div>
      </div>
    );
  }

  const question = data.questions[currentIndex];
  const isLast = currentIndex === data.questions.length - 1;
  const answered = answers[question.id] !== undefined;
  const lowTime = remainingSeconds !== null && remainingSeconds < 60;

  const handleAnswer = (value: number) => {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
  };

  const handleNext = () => {
    responseTimesRef.current[question.id] = Date.now() - questionShownAtRef.current;
    if (isLast) {
      void submit();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  return (
    <div className="min-h-screen bg-aviva-fondo">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
        {/* Header: progress + timer */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Pregunta {currentIndex + 1} de {data.questions.length}
          </p>
          <div className={`flex items-center gap-1.5 text-xs font-medium ${lowTime ? 'text-red-600' : 'text-gray-500'}`}>
            <Clock size={14} />
            {remainingSeconds !== null ? formatTime(remainingSeconds) : '--:--'}
          </div>
        </div>
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 transition-all"
            style={{ width: `${((currentIndex + 1) / data.questions.length) * 100}%` }}
          />
        </div>

        {/* Question card */}
        <div className="card p-6 space-y-4">
          <p className="text-sm font-medium text-gray-900">{question.text}</p>
          <QuestionInput question={question} value={answers[question.id]} onAnswer={handleAnswer} />
        </div>

        {submitError && <p className="text-xs text-red-600 text-center">{submitError}</p>}

        <button
          onClick={handleNext}
          disabled={!answered || submitting}
          className="btn-primary w-full text-sm py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Enviando...' : isLast ? 'Finalizar prueba' : 'Siguiente'}
        </button>
      </div>
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onAnswer,
}: {
  question: TestQuestion;
  value: number | undefined;
  onAnswer: (value: number) => void;
}) {
  if (question.type === 'likert') {
    return (
      <div className="space-y-2">
        {LIKERT_LABELS.map((label, idx) => {
          const optionValue = idx + 1;
          const selected = value === optionValue;
          return (
            <button
              key={optionValue}
              onClick={() => onAnswer(optionValue)}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-sm border transition-colors ${
                selected
                  ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {question.options.map((opt, idx) => {
        const selected = value === idx;
        return (
          <button
            key={idx}
            onClick={() => onAnswer(idx)}
            className={`w-full text-left px-4 py-2.5 rounded-lg text-sm border transition-colors ${
              selected
                ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
