import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  Check,
  AlertTriangle,
  Download,
  Info,
  Search,
  ChevronRight,
  X,
  ArrowRight,
  Wrench,
} from 'lucide-react';
import type {
  PsychometricAttentionQuestion,
  PsychometricLikertQuestion,
  PsychometricLikertScale,
  PsychometricQuestion,
  PsychometricSjtQuestion,
  PsychometricTestConfig,
} from '../../types';
import {
  PSYCHOMETRIC_LIKERT_SCALES,
  PSYCHOMETRIC_SCALE_LABELS,
  PSYCHOMETRIC_SCORED_SCALES,
  PSYCHOMETRIC_TRAITS,
  PSYCHOMETRIC_VALIDITY_SCALES,
} from '../../types';
import {
  getPsychometricQuestions,
  savePsychometricQuestions,
  getPsychometricConfig,
  savePsychometricConfig,
  validateBank,
  applyBankFix,
  RECOMMENDED_PER_TRAIT,
  RECOMMENDED_SJT_SCENARIOS,
  type BankConfigField,
  type BankValidationIssue,
} from '../../services/psychometricQuestions';
import { seedPsychometricBank } from '../../services/functions';

const LIKERT_VALUE_LABELS = [
  '1 · Totalmente en desacuerdo',
  '2 · En desacuerdo',
  '3 · Neutral',
  '4 · De acuerdo',
  '5 · Totalmente de acuerdo',
];

const SJT_SCORE_OPTIONS = [0, 1, 2, 3];

/** Section keys: one per Likert scale, plus the two non-Likert groups. */
type SectionKey = PsychometricLikertScale | 'atencion' | 'sjt';

const SCALE_HELP: Partial<Record<SectionKey, string>> = {
  deseabilidad_social:
    'Afirmaciones deseables pero improbables. No suman al perfil: solo alertan de un posible intento de dar buena impresión.',
  infrecuencia:
    'Afirmaciones que nadie puede sostener con honestidad. Estar de acuerdo indica que no se está leyendo.',
  atencion:
    'El texto indica qué opción marcar. Es la señal más directa de que alguien no está leyendo: fallar dos marca el resultado como no confiable.',
  sjt: 'Ordena las opciones por efectividad: el puntaje más alto es la mejor respuesta. El máximo de cada escenario se toma de su propia opción más alta.',
};

const LIKERT_HELP =
  'Escala 1 (Totalmente en desacuerdo) a 5 (Totalmente de acuerdo). Mezcla ítems normales e invertidos.';

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sectionOf(question: PsychometricQuestion): SectionKey {
  if (question.type === 'sjt') return 'sjt';
  if (question.type === 'attention') return 'atencion';
  return question.scale;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface QuestionBankTabProps {
  /** Item to reveal and highlight, e.g. after clicking it in the analysis tab. */
  focusQuestionId?: string | null;
  onFocusHandled?: () => void;
}

export function QuestionBankTab({ focusQuestionId, onFocusHandled }: QuestionBankTabProps = {}) {
  const [questions, setQuestions] = useState<PsychometricQuestion[]>([]);
  const [config, setConfig] = useState<PsychometricTestConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(new Set());
  const [showConfig, setShowConfig] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [highlightedField, setHighlightedField] = useState<BankConfigField | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([getPsychometricQuestions(), getPsychometricConfig()])
      .then(([qs, cfg]) => {
        setQuestions(qs.sort((a, b) => a.order - b.order));
        setConfig(cfg);
        setLoadError(null);
        setDirty(false);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Error al cargar el banco de preguntas'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Editing 98 items and closing the tab used to lose everything silently.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
    setSaveError(null);
  };

  /** Opens the section holding an item, scrolls to it and flashes it. */
  const revealQuestion = useCallback(
    (id: string) => {
      const question = questions.find((q) => q.id === id);
      if (!question) return;
      setSearch('');
      setOpenSections((prev) => new Set(prev).add(sectionOf(question)));
      setHighlighted(id);
      // Wait for the section to render before scrolling to the item.
      requestAnimationFrame(() => {
        document.getElementById(`q-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      window.setTimeout(() => setHighlighted((current) => (current === id ? null : current)), 2500);
    },
    [questions]
  );

  const scrollTo = (elementId: string) =>
    requestAnimationFrame(() =>
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );

  /** Takes the admin to wherever an issue is actually fixed. */
  const goToIssue = (issue: BankValidationIssue) => {
    const anchor = issue.anchor;
    if (!anchor) return;
    setSearch('');

    if (anchor.kind === 'question') {
      revealQuestion(anchor.questionId);
      return;
    }
    if (anchor.kind === 'section') {
      setOpenSections((prev) => new Set(prev).add(anchor.section as SectionKey));
      scrollTo(`sec-${anchor.section}`);
      return;
    }
    // Config: open the panel, scroll to the field and ring it so it is obvious
    // which input the message was talking about.
    setShowConfig(true);
    setHighlightedField(anchor.field);
    scrollTo(`cfg-${anchor.field}`);
    window.setTimeout(
      () => setHighlightedField((current) => (current === anchor.field ? null : current)),
      3000
    );
  };

  const handledFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusQuestionId || loading) return;
    if (handledFocusRef.current === focusQuestionId) return;
    handledFocusRef.current = focusQuestionId;
    revealQuestion(focusQuestionId);
    onFocusHandled?.();
  }, [focusQuestionId, loading, revealQuestion, onFocusHandled]);

  const update = (id: string, patch: Partial<PsychometricQuestion>) => {
    markDirty();
    setQuestions((prev) => prev.map((q) => (q.id === id ? ({ ...q, ...patch } as PsychometricQuestion) : q)));
  };

  const remove = (id: string) => {
    markDirty();
    setConfirmDelete(null);
    setQuestions((prev) => prev.filter((q) => q.id !== id).map((q, i) => ({ ...q, order: i })));
  };

  const addLikert = (scale: PsychometricLikertScale) => {
    markDirty();
    const newQ: PsychometricLikertQuestion = {
      id: generateId('lik'),
      type: 'likert',
      text: '',
      scale,
      reverseScored: false,
      enabled: true,
      order: questions.length,
    };
    setQuestions((prev) => [...prev, newQ]);
    setOpenSections((prev) => new Set(prev).add(scale));
    requestAnimationFrame(() => revealQuestion(newQ.id));
  };

  const addAttention = () => {
    markDirty();
    const newQ: PsychometricAttentionQuestion = {
      id: generateId('aten'),
      type: 'attention',
      text: 'Para verificar que estás leyendo con calma, selecciona "En desacuerdo" en esta afirmación.',
      expectedValue: 2,
      enabled: true,
      order: questions.length,
    };
    setQuestions((prev) => [...prev, newQ]);
    setOpenSections((prev) => new Set(prev).add('atencion'));
  };

  const addSjt = () => {
    markDirty();
    const newQ: PsychometricSjtQuestion = {
      id: generateId('sjt'),
      type: 'sjt',
      text: '',
      options: [
        { text: '', score: 3 },
        { text: '', score: 2 },
        { text: '', score: 1 },
        { text: '', score: 0 },
      ],
      enabled: true,
      order: questions.length,
    };
    setQuestions((prev) => [...prev, newQ]);
    setOpenSections((prev) => new Set(prev).add('sjt'));
  };

  const updateSjtOption = (qId: string, optIdx: number, patch: { text?: string; score?: number }) => {
    markDirty();
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId || q.type !== 'sjt') return q;
        const options = [...q.options];
        options[optIdx] = { ...options[optIdx], ...patch };
        return { ...q, options };
      })
    );
  };

  const addSjtOption = (qId: string) => {
    markDirty();
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === qId && q.type === 'sjt' ? { ...q, options: [...q.options, { text: '', score: 0 }] } : q
      )
    );
  };

  const removeSjtOption = (qId: string, optIdx: number) => {
    markDirty();
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === qId && q.type === 'sjt'
          ? { ...q, options: q.options.filter((_, i) => i !== optIdx) }
          : q
      )
    );
  };

  const issues = useMemo(() => (config ? validateBank(questions, config) : []), [questions, config]);
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  const issuesByQuestion = useMemo(() => {
    const map = new Map<string, BankValidationIssue[]>();
    for (const issue of issues) {
      if (!issue.questionId) continue;
      map.set(issue.questionId, [...(map.get(issue.questionId) ?? []), issue]);
    }
    return map;
  }, [issues]);

  const handleSave = async () => {
    if (!config || errors.length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await savePsychometricQuestions(questions);
      await savePsychometricConfig(config);
      setSaved(true);
      setDirty(false);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleSeed = async (mode: 'append' | 'replace') => {
    if (mode === 'replace' && !window.confirm('Esto reemplaza todo el banco actual por el banco base. ¿Continuar?')) {
      return;
    }
    setSeeding(true);
    setSeedMessage(null);
    try {
      const { data } = await seedPsychometricBank({ mode, applyConfig: mode === 'replace' });
      setSeedMessage(
        `Banco base cargado: ${data.added} preguntas agregadas, ${data.skipped} ya existían. Total: ${data.total}.`
      );
      load();
    } catch (err) {
      setSeedMessage(err instanceof Error ? err.message : 'No se pudo cargar el banco base.');
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card p-4 text-sm text-red-600 bg-red-50 border border-red-200">
        Error al cargar el banco de preguntas: {loadError}
      </div>
    );
  }

  const likertQuestions = questions.filter((q): q is PsychometricLikertQuestion => q.type === 'likert');
  const attentionQuestions = questions.filter((q): q is PsychometricAttentionQuestion => q.type === 'attention');
  const sjtQuestions = questions.filter((q): q is PsychometricSjtQuestion => q.type === 'sjt');

  const countFor = (scale: PsychometricLikertScale) => {
    const items = likertQuestions.filter((q) => q.scale === scale && q.enabled);
    return { total: items.length, reversed: items.filter((q) => q.reverseScored).length };
  };

  // A search hides everything that does not match, and opens what does — so
  // finding one item among ~100 no longer means scrolling through all of them.
  const term = normalize(search.trim());
  const matches = (question: PsychometricQuestion): boolean => {
    if (!term) return true;
    if (normalize(question.text).includes(term)) return true;
    if (question.type === 'sjt') {
      return question.options.some((option) => normalize(option.text).includes(term));
    }
    return false;
  };

  const visible = questions.filter(matches);
  const sectionsWithMatches = new Set(visible.map(sectionOf));
  const isOpen = (key: SectionKey) => (term ? sectionsWithMatches.has(key) : openSections.has(key));
  const toggle = (key: SectionKey) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sectionIssueCount = (key: SectionKey) => {
    const ids = new Set(questions.filter((q) => sectionOf(q) === key).map((q) => q.id));
    const own = issues.filter((issue) => issue.questionId && ids.has(issue.questionId));
    // Scale-level issues carry no questionId; match them by the scale name.
    const scoped = issues.filter((issue) => !issue.questionId && issue.message.includes(`"${key}"`));
    return {
      errors: [...own, ...scoped].filter((issue) => issue.level === 'error').length,
      warnings: [...own, ...scoped].filter((issue) => issue.level === 'warning').length,
    };
  };

  const renderLikertItem = (q: PsychometricLikertQuestion) => (
    <ItemCard key={q.id} id={q.id} highlighted={highlighted === q.id} issues={issuesByQuestion.get(q.id)}>
      <input
        type="text"
        value={q.text}
        onChange={(e) => update(q.id, { text: e.target.value })}
        placeholder="Texto de la afirmación"
        className="input-field text-sm w-full"
      />
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={q.scale}
          onChange={(e) => update(q.id, { scale: e.target.value as PsychometricLikertScale })}
          className="input-field text-xs py-1.5 w-auto"
          title="Cambiar la escala mueve el ítem a otra sección"
        >
          {PSYCHOMETRIC_LIKERT_SCALES.map((s) => (
            <option key={s} value={s}>{PSYCHOMETRIC_SCALE_LABELS[s]}</option>
          ))}
        </select>
        <Toggle
          label="Invertida"
          checked={q.reverseScored}
          onChange={(reverseScored) => update(q.id, { reverseScored })}
          hint="Estar de acuerdo indica MENOS del rasgo"
        />
        <Toggle label="Activa" checked={q.enabled} onChange={(enabled) => update(q.id, { enabled })} />
        <DeleteButton
          confirming={confirmDelete === q.id}
          onAsk={() => setConfirmDelete(q.id)}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => remove(q.id)}
        />
      </div>
    </ItemCard>
  );

  return (
    <div className="max-w-3xl">
      {/* Save bar. Sticky because the item list is long: the old layout put the
          only save button below ~100 cards. */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-3 bg-white border-b border-gray-200 shadow-sm mb-5">
        <div className="flex items-center justify-between gap-3 max-w-3xl">
          <div className="min-w-0 text-xs">
            {errors.length > 0 ? (
              <button
                onClick={() => scrollTo('bank-issues')}
                className="flex items-center gap-1.5 text-red-600 font-medium hover:underline"
              >
                <AlertTriangle size={13} />
                {errors.length} {errors.length === 1 ? 'error' : 'errores'} por corregir · ver
              </button>
            ) : warnings.length > 0 ? (
              <button
                onClick={() => scrollTo('bank-issues')}
                className="flex items-center gap-1.5 text-amber-600 hover:underline"
              >
                <AlertTriangle size={13} /> Sin errores · {warnings.length}{' '}
                {warnings.length === 1 ? 'sugerencia' : 'sugerencias'} · ver
              </button>
            ) : (
              <span className="text-gray-400">{questions.length} preguntas en el banco</span>
            )}
            {saveError && <p className="text-red-600 mt-0.5">{saveError}</p>}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {dirty && <span className="text-xs text-amber-600">Cambios sin guardar</span>}
            <button
              onClick={handleSave}
              disabled={saving || errors.length > 0 || (!dirty && !saved)}
              className="btn-primary text-sm flex items-center gap-2 px-4 py-2 disabled:opacity-40"
              title={errors.length > 0 ? 'Corrige los errores antes de guardar' : undefined}
            >
              {saved ? <Check size={15} /> : <Save size={15} />}
              {saving ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {questions.length === 0 && (
          <div className="card p-4 space-y-3 border-primary-200 bg-primary-50/40">
            <div className="flex gap-2">
              <Info size={16} className="text-primary-600 shrink-0 mt-0.5" />
              <div className="text-xs text-gray-600 space-y-1">
                <p className="font-medium text-gray-900">El banco está vacío</p>
                <p>
                  Puedes cargar el banco base: 5 rasgos con 14 ítems cada uno (mitad invertidos), escalas de
                  validez, controles de atención y 14 escenarios de juicio situacional, redactados para los
                  puestos de crédito, venta y cobranza. Después puedes editar, desactivar o agregar lo que
                  necesites.
                </p>
              </div>
            </div>
            <button
              onClick={() => handleSeed('append')}
              disabled={seeding}
              className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2"
            >
              <Download size={14} /> {seeding ? 'Cargando...' : 'Cargar banco base'}
            </button>
          </div>
        )}

        {seedMessage && <div className="card p-3 text-xs text-gray-600">{seedMessage}</div>}

        {/* Coverage: what actually decides whether a score is interpretable. */}
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Cobertura del banco</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PSYCHOMETRIC_LIKERT_SCALES.map((scale) => {
              const { total, reversed } = countFor(scale);
              const isTrait = (PSYCHOMETRIC_TRAITS as string[]).includes(scale);
              const applied =
                config && config.questionCounts.likertPerTrait > 0 && isTrait
                  ? Math.min(config.questionCounts.likertPerTrait, total)
                  : total;
              const thin = isTrait && applied < 6;
              return (
                <button
                  key={scale}
                  onClick={() => {
                    setSearch('');
                    setOpenSections((prev) => new Set(prev).add(scale));
                    requestAnimationFrame(() =>
                      document.getElementById(`sec-${scale}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    );
                  }}
                  className="text-xs text-left hover:bg-gray-50 rounded p-1 -m-1"
                >
                  <p className="text-gray-500">{PSYCHOMETRIC_SCALE_LABELS[scale]}</p>
                  <p className={thin ? 'text-amber-600 font-medium' : 'text-gray-900 font-medium'}>
                    {total} activos · {reversed} invertidos
                  </p>
                </button>
              );
            })}
            <div className="text-xs">
              <p className="text-gray-500">Escenarios SJT</p>
              <p className="text-gray-900 font-medium">{sjtQuestions.filter((q) => q.enabled).length} activos</p>
            </div>
            <div className="text-xs">
              <p className="text-gray-500">Controles de atención</p>
              <p className="text-gray-900 font-medium">{attentionQuestions.filter((q) => q.enabled).length} activos</p>
            </div>
          </div>
          {questions.length > 0 && (
            <button
              onClick={() => handleSeed('append')}
              disabled={seeding}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <Download size={12} />{' '}
              {seeding ? 'Cargando...' : 'Completar con el banco base (no sobrescribe lo existente)'}
            </button>
          )}
        </div>

        {/* Bank-wide issues (scale coverage, cutoffs, weights). Each one links
            to where it is fixed, and offers the remedy when it is unambiguous. */}
        <div id="bank-issues">
          <IssuePanel
            issues={issues.filter((issue) => !issue.questionId)}
            onGo={goToIssue}
            onFix={(fixId) => {
              if (!config) return;
              markDirty();
              setConfig(applyBankFix(fixId, config));
            }}
          />
        </div>

        {/* Configuration first: it decides how the whole instrument behaves. */}
        {config && (
          <Section
            id="sec-config"
            title="Configuración de la prueba"
            subtitle="Ponderación, bandas, tiempo y cuántas preguntas se aplican por sesión."
            open={showConfig}
            onToggle={() => setShowConfig((v) => !v)}
          >
            <ConfigPanel
              config={config}
              highlightedField={highlightedField}
              setConfig={(next) => {
                markDirty();
                setConfig(next);
              }}
              counts={{
                traits: PSYCHOMETRIC_TRAITS.map((t) => countFor(t).total),
                sjt: sjtQuestions.filter((q) => q.enabled).length,
                atencion: attentionQuestions.filter((q) => q.enabled).length,
                deseabilidad: countFor('deseabilidad_social').total,
                infrecuencia: countFor('infrecuencia').total,
              }}
            />
          </Section>
        )}

        {/* Search across every item, including SJT option text. */}
        {questions.length > 0 && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en las preguntas..."
              className="input-field text-sm w-full pl-9 pr-9"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
            {term && (
              <p className="text-xs text-gray-500 mt-1.5">
                {visible.length} {visible.length === 1 ? 'coincidencia' : 'coincidencias'}
              </p>
            )}
          </div>
        )}

        {/* One collapsible section per scale. */}
        {PSYCHOMETRIC_LIKERT_SCALES.map((scale) => {
          const all = likertQuestions.filter((q) => q.scale === scale);
          const shown = all.filter(matches);
          if (term && shown.length === 0) return null;
          const isValidityScale = (PSYCHOMETRIC_VALIDITY_SCALES as string[]).includes(scale);
          const { total, reversed } = countFor(scale);

          return (
            <Section
              key={scale}
              id={`sec-${scale}`}
              title={PSYCHOMETRIC_SCALE_LABELS[scale]}
              subtitle={SCALE_HELP[scale] ?? LIKERT_HELP}
              summary={`${total} activos · ${reversed} invertidos`}
              badges={sectionIssueCount(scale)}
              open={isOpen(scale)}
              onToggle={() => toggle(scale)}
              action={
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addLikert(scale);
                  }}
                  className="btn-primary text-xs flex items-center gap-1 px-2.5 py-1.5 shrink-0"
                >
                  <Plus size={13} /> Agregar
                </button>
              }
            >
              {shown.length === 0 ? (
                <p className="text-xs text-gray-400 px-1">
                  {isValidityScale
                    ? 'Sin ítems. Esta escala solo alimenta el veredicto de confiabilidad.'
                    : 'Sin ítems: este rasgo no se podrá calificar.'}
                </p>
              ) : (
                shown.map(renderLikertItem)
              )}
            </Section>
          );
        })}

        {/* Attention checks */}
        {(!term || attentionQuestions.some(matches)) && (
          <Section
            id="sec-atencion"
            title="Controles de atención"
            subtitle={SCALE_HELP.atencion!}
            summary={`${attentionQuestions.filter((q) => q.enabled).length} activos`}
            badges={sectionIssueCount('atencion')}
            open={isOpen('atencion')}
            onToggle={() => toggle('atencion')}
            action={
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  addAttention();
                }}
                className="btn-primary text-xs flex items-center gap-1 px-2.5 py-1.5 shrink-0"
              >
                <Plus size={13} /> Agregar
              </button>
            }
          >
            {attentionQuestions.filter(matches).map((q) => (
              <ItemCard key={q.id} id={q.id} highlighted={highlighted === q.id} issues={issuesByQuestion.get(q.id)}>
                <textarea
                  value={q.text}
                  onChange={(e) => update(q.id, { text: e.target.value })}
                  placeholder="Instrucción (debe decir explícitamente qué opción elegir)"
                  rows={2}
                  className="input-field text-sm w-full"
                />
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="text-xs text-gray-600 flex items-center gap-1.5">
                    Respuesta esperada
                    <select
                      value={q.expectedValue}
                      onChange={(e) => update(q.id, { expectedValue: Number(e.target.value) })}
                      className="input-field text-xs py-1.5 w-auto"
                    >
                      {LIKERT_VALUE_LABELS.map((label, i) => (
                        <option key={i} value={i + 1}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <Toggle label="Activo" checked={q.enabled} onChange={(enabled) => update(q.id, { enabled })} />
                  <DeleteButton
                    confirming={confirmDelete === q.id}
                    onAsk={() => setConfirmDelete(q.id)}
                    onCancel={() => setConfirmDelete(null)}
                    onConfirm={() => remove(q.id)}
                  />
                </div>
              </ItemCard>
            ))}
          </Section>
        )}

        {/* SJT scenarios */}
        {(!term || sjtQuestions.some(matches)) && (
          <Section
            id="sec-sjt"
            title="Escenarios de juicio situacional (SJT)"
            subtitle={SCALE_HELP.sjt!}
            summary={`${sjtQuestions.filter((q) => q.enabled).length} activos`}
            badges={sectionIssueCount('sjt')}
            open={isOpen('sjt')}
            onToggle={() => toggle('sjt')}
            action={
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  addSjt();
                }}
                className="btn-primary text-xs flex items-center gap-1 px-2.5 py-1.5 shrink-0"
              >
                <Plus size={13} /> Agregar
              </button>
            }
          >
            {sjtQuestions.filter(matches).map((q) => (
              <ItemCard key={q.id} id={q.id} highlighted={highlighted === q.id} issues={issuesByQuestion.get(q.id)}>
                <textarea
                  value={q.text}
                  onChange={(e) => update(q.id, { text: e.target.value })}
                  placeholder="Escenario"
                  rows={2}
                  className="input-field text-sm w-full"
                />
                <input
                  type="text"
                  value={q.competency ?? ''}
                  onChange={(e) => update(q.id, { competency: e.target.value })}
                  placeholder="Competencia evaluada (opcional, solo informativa)"
                  className="input-field text-xs py-1.5 w-full"
                />
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex gap-1.5 items-center">
                    <input
                      type="text"
                      value={opt.text}
                      onChange={(e) => updateSjtOption(q.id, oi, { text: e.target.value })}
                      placeholder={`Opción ${oi + 1}`}
                      className="input-field text-xs py-1.5 flex-1"
                    />
                    <select
                      value={opt.score}
                      onChange={(e) => updateSjtOption(q.id, oi, { score: Number(e.target.value) })}
                      className="input-field text-xs py-1.5 w-20"
                    >
                      {SJT_SCORE_OPTIONS.map((score) => (
                        <option key={score} value={score}>{score} pts</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeSjtOption(q.id, oi)}
                      disabled={q.options.length <= 2}
                      className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
                      title="Quitar opción"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => addSjtOption(q.id)} className="text-xs text-primary-600 hover:text-primary-700">
                    + Agregar opción
                  </button>
                  <Toggle label="Activo" checked={q.enabled} onChange={(enabled) => update(q.id, { enabled })} />
                  <DeleteButton
                    confirming={confirmDelete === q.id}
                    onAsk={() => setConfirmDelete(q.id)}
                    onCancel={() => setConfirmDelete(null)}
                    onConfirm={() => remove(q.id)}
                  />
                </div>
              </ItemCard>
            ))}
          </Section>
        )}

        {term && visible.length === 0 && (
          <p className="card p-6 text-center text-sm text-gray-400">
            Ninguna pregunta coincide con "{search}".
          </p>
        )}

        <p className="text-xs text-gray-400 pt-2">
          El orden de las preguntas dentro del banco no determina el orden de la prueba: cada sesión
          selecciona e intercala sus reactivos al azar.
        </p>
      </div>
    </div>
  );
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Section({
  id,
  title,
  subtitle,
  summary,
  badges,
  open,
  onToggle,
  action,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  summary?: string;
  badges?: { errors: number; warnings: number };
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card overflow-hidden">
      <div
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-gray-50 cursor-pointer"
      >
        <ChevronRight
          size={16}
          className={`text-gray-400 shrink-0 mt-0.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            {summary && <span className="text-xs text-gray-400">{summary}</span>}
            {badges && badges.errors > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
                <AlertTriangle size={10} /> {badges.errors}
              </span>
            )}
            {badges && badges.errors === 0 && badges.warnings > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                <AlertTriangle size={10} /> {badges.warnings}
              </span>
            )}
          </div>
          {open && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {action}
      </div>
      {open && <div className="px-4 pb-4 space-y-2 border-t border-gray-100 pt-3">{children}</div>}
    </section>
  );
}

function ItemCard({
  id,
  highlighted,
  issues,
  children,
}: {
  id: string;
  highlighted: boolean;
  issues?: BankValidationIssue[];
  children: React.ReactNode;
}) {
  return (
    <div
      id={`q-${id}`}
      className={`rounded-lg border p-3 space-y-2 transition-colors ${
        highlighted ? 'border-primary-400 bg-primary-50/50' : 'border-gray-200'
      }`}
    >
      {children}
      <IssueList issues={issues ?? []} compact />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  );
}

/** Two-step delete: the old single click removed an item with no way back. */
function DeleteButton({
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: {
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (confirming) {
    return (
      <span className="flex items-center gap-1.5 text-xs ml-auto">
        <span className="text-gray-500">¿Eliminar?</span>
        <button onClick={onConfirm} className="text-red-600 font-medium hover:underline">Sí</button>
        <button onClick={onCancel} className="text-gray-500 hover:underline">No</button>
      </span>
    );
  }
  return (
    <button onClick={onAsk} className="ml-auto p-1 text-gray-400 hover:text-red-500" title="Eliminar pregunta">
      <Trash2 size={14} />
    </button>
  );
}

/**
 * Bank-wide issues, split by severity and made actionable. The previous version
 * dropped everything into one amber box, so an error that blocked saving looked
 * exactly like a suggestion and nothing said where to go and fix it.
 */
function IssuePanel({
  issues,
  onGo,
  onFix,
}: {
  issues: BankValidationIssue[];
  onGo: (issue: BankValidationIssue) => void;
  onFix: (fixId: NonNullable<BankValidationIssue['fix']>['id']) => void;
}) {
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  if (issues.length === 0) return null;

  const row = (issue: BankValidationIssue, index: number, tone: 'error' | 'warning') => (
    <li key={index} className="flex items-start gap-2">
      <AlertTriangle
        size={13}
        className={`shrink-0 mt-0.5 ${tone === 'error' ? 'text-red-500' : 'text-amber-500'}`}
      />
      <span className={`flex-1 ${tone === 'error' ? 'text-red-800' : 'text-amber-800'}`}>
        {issue.message}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {issue.fix && (
          <button
            onClick={() => onFix(issue.fix!.id)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-700 hover:border-gray-300 font-medium"
          >
            <Wrench size={11} /> {issue.fix.label}
          </button>
        )}
        {issue.anchor && (
          <button
            onClick={() => onGo(issue)}
            className={`inline-flex items-center gap-0.5 hover:underline font-medium ${
              tone === 'error' ? 'text-red-700' : 'text-amber-700'
            }`}
          >
            Ir <ArrowRight size={11} />
          </button>
        )}
      </span>
    </li>
  );

  return (
    <div className="space-y-3">
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
          <p className="text-xs font-semibold text-red-800">
            {errors.length === 1 ? 'Hay 1 error que impide guardar' : `Hay ${errors.length} errores que impiden guardar`}
          </p>
          <ul className="space-y-1.5 text-xs">{errors.map((issue, i) => row(issue, i, 'error'))}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <div>
            <p className="text-xs font-semibold text-amber-800">
              {errors.length === 0
                ? 'No hay errores: el banco se puede guardar y aplicar tal como está'
                : 'Además, hay sugerencias para mejorar la prueba'}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {warnings.length === 1
                ? 'Esta sugerencia mejora la calidad de la prueba, pero no es obligatoria.'
                : `Estas ${warnings.length} sugerencias mejoran la calidad de la prueba, pero no son obligatorias.`}
            </p>
          </div>
          <ul className="space-y-1.5 text-xs">{warnings.map((issue, i) => row(issue, i, 'warning'))}</ul>
        </div>
      )}
    </div>
  );
}

function IssueList({ issues, compact }: { issues: BankValidationIssue[]; compact?: boolean }) {
  if (issues.length === 0) return null;
  return (
    <ul className={compact ? 'space-y-0.5' : 'card p-3 space-y-1 bg-amber-50 border-amber-200'}>
      {issues.map((issue, index) => (
        <li
          key={index}
          className={`text-xs flex items-start gap-1.5 ${
            issue.level === 'error' ? 'text-red-600' : 'text-amber-700'
          }`}
        >
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

function ConfigPanel({
  config,
  setConfig,
  counts,
  highlightedField,
}: {
  config: PsychometricTestConfig;
  setConfig: (config: PsychometricTestConfig) => void;
  counts: { traits: number[]; sjt: number; atencion: number; deseabilidad: number; infrecuencia: number };
  /** Field an issue pointed at — ringed so the message and the input connect. */
  highlightedField?: BankConfigField | null;
}) {
  /** Wraps a field so it can be scrolled to and flashed from an error message. */
  const field = (name: BankConfigField, children: React.ReactNode, className = '') => (
    <div
      id={`cfg-${name}`}
      className={`rounded-lg transition-all ${className} ${
        highlightedField === name ? 'ring-2 ring-red-400 ring-offset-2 bg-red-50/40' : ''
      }`}
    >
      {children}
    </div>
  );

  // Broken into parts (not just a grand total) so the summary box below can
  // show where the length actually comes from.
  const traitTotal =
    config.questionCounts.likertPerTrait > 0
      ? counts.traits.reduce((sum, available) => sum + Math.min(config.questionCounts.likertPerTrait, available), 0)
      : counts.traits.reduce((sum, available) => sum + available, 0);
  const sjtApplied = Math.min(config.questionCounts.sjt || counts.sjt, counts.sjt);
  const qualityApplied =
    Math.min(config.questionCounts.deseabilidadSocial || counts.deseabilidad, counts.deseabilidad) +
    Math.min(config.questionCounts.infrecuencia || counts.infrecuencia, counts.infrecuencia) +
    Math.min(config.questionCounts.atencion || counts.atencion, counts.atencion);
  const totalItems = traitTotal + sjtApplied + qualityApplied;

  // Zipped by index with PSYCHOMETRIC_TRAITS, which is how `counts.traits` was
  // built by the caller — turns "20 / 20 / 20 / 20 / 14" into a labeled list.
  const traitAvailability = PSYCHOMETRIC_TRAITS.map((trait, index) => ({
    key: trait,
    label: PSYCHOMETRIC_SCALE_LABELS[trait],
    count: counts.traits[index] ?? 0,
  }));

  const setCounts = (patch: Partial<PsychometricTestConfig['questionCounts']>) =>
    setConfig({ ...config, questionCounts: { ...config.questionCounts, ...patch } });

  return (
    <div className="space-y-5">
      {/* What the candidate actually gets — the most consequential setting. */}
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">Preguntas aplicadas por sesión</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            En 0 se aplican todas las activas. Con un número, cada sesión toma esa cantidad al azar.
          </p>
        </div>

        {/* Content: builds the candidate's profile and feeds the score. */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-700">Preguntas que arman el perfil del candidato</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {field(
              'likertPerTrait',
              <TraitCountField
                value={config.questionCounts.likertPerTrait}
                onChange={(likertPerTrait) => setCounts({ likertPerTrait })}
                traits={traitAvailability}
                total={traitTotal}
              />,
              'sm:col-span-2'
            )}
            {field(
              'sjt',
              <CountField
                label="Escenarios SJT"
                hint={`Disponibles: ${counts.sjt}`}
                value={config.questionCounts.sjt}
                onChange={(sjt) => setCounts({ sjt })}
                recommended={RECOMMENDED_SJT_SCENARIOS}
              />
            )}
          </div>
        </div>

        {/* Quality control: never scored, only used to judge whether the rest
            of the answers can be trusted. Grouped apart from the content
            fields so it stops reading as "five equivalent knobs". */}
        <div className="space-y-2 pt-3 border-t border-gray-100">
          <div>
            <p className="text-xs font-medium text-gray-700">Controles de calidad de respuesta</p>
            <p className="text-xs text-gray-400 mt-0.5">
              No forman parte del perfil ni del puntaje: solo sirven para detectar respuestas
              descuidadas o poco honestas.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {field(
              'deseabilidadSocial',
              <CountField
                label="Deseabilidad social"
                hint={`Disponibles: ${counts.deseabilidad}`}
                value={config.questionCounts.deseabilidadSocial}
                onChange={(deseabilidadSocial) => setCounts({ deseabilidadSocial })}
              />
            )}
            {field(
              'infrecuencia',
              <CountField
                label="Infrecuencia"
                hint={`Disponibles: ${counts.infrecuencia}`}
                value={config.questionCounts.infrecuencia}
                onChange={(infrecuencia) => setCounts({ infrecuencia })}
              />
            )}
            {field(
              'atencion',
              <CountField
                label="Controles de atención"
                hint={`Disponibles: ${counts.atencion}`}
                value={config.questionCounts.atencion}
                onChange={(atencion) => setCounts({ atencion })}
                recommended={2}
              />
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-gray-100">
          <label className="text-xs text-gray-600 space-y-1 block max-w-[10rem]">
            Tiempo límite (minutos)
            <input
              type="number"
              min={1}
              value={config.timeLimitMinutes}
              onChange={(e) => setConfig({ ...config, timeLimitMinutes: Number(e.target.value) })}
              className="input-field text-xs py-1.5 w-full"
            />
          </label>
        </div>

        <div className="text-xs text-primary-700 bg-primary-50 rounded-lg px-3 py-2 space-y-1">
          <p>
            Cada candidato responderá <strong>{totalItems} preguntas</strong> en un máximo de{' '}
            <strong>{config.timeLimitMinutes} minutos</strong>.
          </p>
          <p className="text-primary-600">
            {traitTotal} de personalidad · {sjtApplied} de escenarios · {qualityApplied} de control de
            calidad.
          </p>
        </div>
      </div>

      {/* Weights */}
      <div className="space-y-3 pt-4 border-t border-gray-100">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">Ponderación del score compuesto</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Los pesos se normalizan entre sí, no tienen que sumar 1. Una escala sin datos suficientes se
            excluye y su peso se reparte entre las demás.
          </p>
        </div>
        {field(
          'weights',
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {PSYCHOMETRIC_SCORED_SCALES.map((scale) => (
            <label key={scale} className="text-xs text-gray-600 space-y-1">
              {PSYCHOMETRIC_SCALE_LABELS[scale]}
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={config.weights[scale]}
                onChange={(e) =>
                  setConfig({ ...config, weights: { ...config.weights, [scale]: Number(e.target.value) } })
                }
                className="input-field text-xs py-1.5 w-full"
              />
            </label>
          ))}
          </div>
        )}
      </div>

      {/* Bands */}
      <div className="space-y-3 pt-4 border-t border-gray-100">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">Bandas de calificación</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Con suficientes pruebas aplicadas la banda se calcula por percentil frente a los demás
            candidatos; mientras tanto se usan los cortes absolutos y el resultado se etiqueta como tal.
          </p>
        </div>
        {field(
          'percentileCutoffs',
          <div className="flex flex-wrap gap-4">
          <label className="text-xs text-gray-600 space-y-1">
            "Bajo" hasta percentil &lt;
            <input
              type="number"
              min={1}
              max={99}
              value={config.percentileCutoffs.lowMaxPercentile}
              onChange={(e) =>
                setConfig({
                  ...config,
                  percentileCutoffs: { ...config.percentileCutoffs, lowMaxPercentile: Number(e.target.value) },
                })
              }
              className="input-field text-xs py-1.5 w-24"
            />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            "Alto" desde percentil &gt;=
            <input
              type="number"
              min={1}
              max={99}
              value={config.percentileCutoffs.highMinPercentile}
              onChange={(e) =>
                setConfig({
                  ...config,
                  percentileCutoffs: { ...config.percentileCutoffs, highMinPercentile: Number(e.target.value) },
                })
              }
              className="input-field text-xs py-1.5 w-24"
            />
          </label>
          <label className="flex items-end gap-1.5 text-xs text-gray-600 cursor-pointer pb-1.5">
            <input
              type="checkbox"
              checked={config.useLocalNorms}
              onChange={(e) => setConfig({ ...config, useLocalNorms: e.target.checked })}
              className="rounded"
            />
            Usar normas locales cuando alcancen
          </label>
          </div>
        )}
        {field(
          'bandCutoffs',
          <div className="flex flex-wrap gap-4 pt-1">
          <label className="text-xs text-gray-600 space-y-1">
            Corte absoluto "bajo" (&lt;)
            <input
              type="number"
              value={config.bandCutoffs.lowMax}
              onChange={(e) =>
                setConfig({ ...config, bandCutoffs: { ...config.bandCutoffs, lowMax: Number(e.target.value) } })
              }
              className="input-field text-xs py-1.5 w-24"
            />
          </label>
          <label className="text-xs text-gray-600 space-y-1">
            Corte absoluto "alto" (&gt;=)
            <input
              type="number"
              value={config.bandCutoffs.highMin}
              onChange={(e) =>
                setConfig({ ...config, bandCutoffs: { ...config.bandCutoffs, highMin: Number(e.target.value) } })
              }
              className="input-field text-xs py-1.5 w-24"
            />
          </label>
          {field(
            'minItemsPerScale',
            <label className="text-xs text-gray-600 space-y-1 block">
              Mínimo de ítems por escala
              <input
                type="number"
                min={1}
                value={config.minItemsPerScale}
                onChange={(e) => setConfig({ ...config, minItemsPerScale: Number(e.target.value) })}
                className="input-field text-xs py-1.5 w-24"
              />
            </label>
          )}
          </div>
        )}
        <p className="text-xs text-gray-400">
          Con estos cortes absolutos:{' '}
          <span className="text-red-600 font-medium">Bajo 0–{config.bandCutoffs.lowMax - 1}</span>,{' '}
          <span className="text-amber-600 font-medium">
            Medio {config.bandCutoffs.lowMax}–{config.bandCutoffs.highMin - 1}
          </span>
          , <span className="text-green-600 font-medium">Alto {config.bandCutoffs.highMin}–100</span>.
        </p>
      </div>
    </div>
  );
}

/**
 * The one field that is a per-trait multiplier rather than a flat count — "8"
 * here means 8 questions for *each* of the 5 traits, not 8 total. That was
 * easy to misread, and the "Disponibles: 20 / 20 / 20 / 20 / 14" hint it used
 * to show gave five bare numbers with nothing tying them to a trait name.
 * This spells out the total and labels each number.
 */
function TraitCountField({
  value,
  onChange,
  traits,
  total,
}: {
  value: number;
  onChange: (value: number) => void;
  traits: { key: string; label: string; count: number }[];
  total: number;
}) {
  const belowRecommended = value > 0 && value < RECOMMENDED_PER_TRAIT;
  return (
    <div className="text-xs text-gray-600 space-y-1.5">
      <label className="block space-y-1">
        Ítems Likert por rasgo (0 = todos)
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`input-field text-xs py-1.5 w-full max-w-[10rem] ${
            belowRecommended ? 'border-amber-300' : ''
          }`}
        />
      </label>
      <p className="text-gray-400">
        Se aplica a cada uno de los 5 rasgos → <strong className="text-gray-700">{total} preguntas de personalidad</strong> en
        total.
        {belowRecommended && (
          <span className="text-amber-600"> Se recomiendan {RECOMMENDED_PER_TRAIT} o más por rasgo.</span>
        )}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 pt-0.5">
        {traits.map((trait) => (
          <div
            key={trait.key}
            className={`flex items-center justify-between gap-2 ${
              trait.count < RECOMMENDED_PER_TRAIT ? 'text-amber-600' : 'text-gray-400'
            }`}
          >
            <span className="truncate">{trait.label}</span>
            <span className="shrink-0 font-medium">{trait.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CountField({
  label,
  hint,
  value,
  onChange,
  recommended,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  /** Below this the count is valid but the score gets noticeably noisier. */
  recommended?: number;
}) {
  const belowRecommended = recommended !== undefined && value > 0 && value < recommended;
  return (
    <label className="text-xs text-gray-600 space-y-1">
      {label} (0 = todos)
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`input-field text-xs py-1.5 w-full ${belowRecommended ? 'border-amber-300' : ''}`}
      />
      <span className="block text-gray-400">{hint}</span>
      {belowRecommended && (
        <span className="block text-amber-600">Se recomiendan {recommended} o más.</span>
      )}
    </label>
  );
}
