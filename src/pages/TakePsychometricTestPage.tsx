import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Clock, Cloud, CloudOff, ShieldCheck } from 'lucide-react';
import {
  clockOffsetMs,
  savePsychometricProgress,
  submitPsychometricTest,
  usePsychometricTestSession,
  type AnswerPayload,
  type TestQuestion,
} from '../hooks/usePsychometricTestSession';

const LIKERT_LABELS = [
  'Totalmente en desacuerdo',
  'En desacuerdo',
  'Neutral',
  'De acuerdo',
  'Totalmente de acuerdo',
];

const SECTION_LABELS: Record<TestQuestion['section'], string> = {
  personalidad: 'Parte 1 · Cómo te describes',
  escenarios: 'Parte 2 · Situaciones de trabajo',
};

/** Debounce for the autosave, long enough to batch fast clicking. */
const AUTOSAVE_DELAY_MS = 1200;

function formatTime(totalSeconds: number): string {
  const m = Math.max(0, Math.floor(totalSeconds / 60));
  const s = Math.max(0, Math.floor(totalSeconds % 60));
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TakePsychometricTestPage() {
  const { token } = useParams<{ token: string }>();
  const { data, preview, loading, error, peek, start } = usePsychometricTestSession(token);
  const [consented, setConsented] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Guards the submit path. Unlike a plain "already submitted" flag, this one is
  // released when a submission fails, so a candidate whose connection dropped on
  // the last question can retry instead of being locked out of finishing.
  const submitInFlight = useRef(false);
  const submitSucceeded = useRef(false);

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Time each question stayed on screen before the candidate moved on — used
  // server-side to flag responses faster than the item can be read.
  const responseTimesRef = useRef<Record<string, number>>({});
  const questionShownAtRef = useRef(0);
  useEffect(() => {
    questionShownAtRef.current = Date.now();
  }, [currentIndex]);

  useEffect(() => {
    void peek();
    // peek is stable for the lifetime of the token; re-running it would restart
    // the request on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Restore a session the candidate had already started elsewhere, and continue
  // from the first question they had not answered.
  useEffect(() => {
    if (!data?.savedAnswers?.length) return;
    const restored: Record<string, number> = {};
    for (const answer of data.savedAnswers) restored[answer.questionId] = answer.value;
    setAnswers(restored);
    const firstUnanswered = data.questions.findIndex((question) => restored[question.id] === undefined);
    setCurrentIndex(firstUnanswered === -1 ? data.questions.length - 1 : firstUnanswered);
  }, [data]);

  const buildPayload = useCallback(
    (): AnswerPayload[] =>
      Object.entries(answersRef.current).map(([questionId, value]) => ({
        questionId,
        value,
        responseMs: responseTimesRef.current[questionId],
      })),
    []
  );

  const submit = useCallback(async () => {
    if (!token || submitSucceeded.current || submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);

    const result = await submitPsychometricTest(token, buildPayload());

    setSubmitting(false);
    submitInFlight.current = false;
    if (result.ok) {
      submitSucceeded.current = true;
      setSubmitted(true);
    } else {
      setSubmitError(result.error ?? 'Error al enviar tus respuestas.');
    }
  }, [token, buildPayload]);

  // Autosave: the server-side timer cannot be paused, so a closed tab or a lost
  // connection used to cost the candidate everything they had answered.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueSave = useCallback(() => {
    if (!token || submitSucceeded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState('saving');
      const ok = await savePsychometricProgress(token, buildPayload());
      setSaveState(ok ? 'saved' : 'error');
    }, AUTOSAVE_DELAY_MS);
  }, [token, buildPayload]);

  // Also flush when the page is being hidden — on mobile this is the only
  // reliable moment before the browser suspends the tab.
  useEffect(() => {
    const flush = () => {
      if (!token || submitSucceeded.current || document.visibilityState !== 'hidden') return;
      void savePsychometricProgress(token, buildPayload());
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [token, buildPayload]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // Countdown against the server-assigned start, corrected for a device clock
  // that disagrees with the server.
  const offsetMs = useMemo(() => clockOffsetMs(data), [data]);
  useEffect(() => {
    if (!data?.startedAtIso) return;
    const deadline = new Date(data.startedAtIso).getTime() + data.timeLimitMinutes * 60 * 1000;

    const tick = () => {
      const secondsLeft = (deadline - (Date.now() + offsetMs)) / 1000;
      setRemainingSeconds(secondsLeft);
      if (secondsLeft <= 0) void submit();
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [data, offsetMs, submit]);

  if (loading && !data && !preview) {
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
    const minutes = preview?.timeLimitMinutes ?? 30;
    return (
      <div className="min-h-screen flex items-center justify-center bg-aviva-fondo px-4 py-8">
        <div className="card p-8 max-w-lg w-full space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Prueba psicométrica</h2>
          {preview?.alreadyStarted && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
              Ya habías iniciado esta prueba. Al continuar retomarás donde te quedaste, con el
              tiempo que reste.
            </p>
          )}
          <ul className="text-sm text-gray-600 space-y-1.5 list-disc list-inside">
            <li>
              La prueba tiene {preview ? `${preview.totalQuestions} preguntas` : 'preguntas de opción múltiple'} y
              dura un máximo de <strong>{minutes} minutos</strong>.
            </li>
            <li>Una vez iniciada, el tiempo corre de forma continua y no se puede pausar.</li>
            <li>Tus respuestas se guardan solas: si se corta tu conexión, puedes volver a entrar con el mismo enlace.</li>
            <li>No podrás regresar a una pregunta ya respondida.</li>
            <li>Responde con honestidad — no hay respuestas correctas o incorrectas.</li>
          </ul>

          {/* An explicit honesty warning measurably reduces answer inflation in
              selection settings, and it is fair to tell candidates that response
              patterns are checked rather than checking them silently. */}
          <div className="flex gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <ShieldCheck size={16} className="text-primary-600 shrink-0 mt-0.5" />
            <p>
              La prueba incluye preguntas de control y mide la consistencia de tus respuestas. Contestar
              lo que crees que "queremos oír", muy rápido o sin leer hace que el resultado se marque como
              poco confiable y puede requerir volver a aplicarla. Responder con honestidad es lo que
              mejor te conviene.
            </p>
          </div>

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
            disabled={!consented || loading}
            className="btn-primary w-full text-sm py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Cargando...' : preview?.alreadyStarted ? 'Continuar la prueba' : 'Comenzar la prueba'}
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
  const sectionChanged = currentIndex === 0 || data.questions[currentIndex - 1].section !== question.section;

  const handleAnswer = (value: number) => {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    queueSave();
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
          <div className="flex items-center gap-3">
            <SaveIndicator state={saveState} />
            <div className={`flex items-center gap-1.5 text-xs font-medium ${lowTime ? 'text-red-600' : 'text-gray-500'}`}>
              <Clock size={14} />
              {remainingSeconds !== null ? formatTime(remainingSeconds) : '--:--'}
            </div>
          </div>
        </div>
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 transition-all"
            style={{ width: `${((currentIndex + 1) / data.questions.length) * 100}%` }}
          />
        </div>

        {sectionChanged && (
          <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide">
            {SECTION_LABELS[question.section]}
          </p>
        )}

        {/* Question card */}
        <div className="card p-6 space-y-4">
          <p className="text-sm font-medium text-gray-900">{question.text}</p>
          <QuestionInput question={question} value={answers[question.id]} onAnswer={handleAnswer} />
        </div>

        {submitError && (
          <div className="text-center space-y-2">
            <p className="text-xs text-red-600">{submitError}</p>
            <button onClick={() => void submit()} disabled={submitting} className="text-xs text-primary-600 underline">
              Intentar enviar de nuevo
            </button>
          </div>
        )}

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

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return null;
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-600" title="Seguimos intentando guardar tu avance">
        <CloudOff size={13} /> Sin guardar
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-gray-400">
      <Cloud size={13} /> {state === 'saving' ? 'Guardando' : 'Guardado'}
    </span>
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
  if (question.type === 'sjt') {
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

  // Likert items and attention checks share the same scale, on purpose: a check
  // that looked different would be spotted and answered correctly by somebody who
  // is not reading anything else.
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
