import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { PsychometricQuestion, PsychometricTestConfig } from '../types';

const QUESTIONS_DOC = doc(db, 'settings', 'psychometric_questions');
const CONFIG_DOC = doc(db, 'settings', 'psychometric_config');

/**
 * Default question bank: 24 Likert items (6 per trait, IPIP-style, adapted to
 * Spanish) + 10 situational-judgment scenarios tailored to promotor de
 * crédito (venta / cobranza en piso). Seeded to Firestore on first load.
 */
export const DEFAULT_PSYCHOMETRIC_QUESTIONS: PsychometricQuestion[] = [
  // ── Responsabilidad ──
  { id: 'lik_resp_1', type: 'likert', text: 'Termino las tareas que empiezo, aunque sean tediosas.', trait: 'responsabilidad', reverseScored: false, enabled: true, order: 0 },
  { id: 'lik_resp_2', type: 'likert', text: 'Sigo un plan de trabajo aunque nadie lo esté revisando.', trait: 'responsabilidad', reverseScored: false, enabled: true, order: 1 },
  { id: 'lik_resp_3', type: 'likert', text: 'Cumplo mis compromisos de tiempo, incluso bajo presión.', trait: 'responsabilidad', reverseScored: false, enabled: true, order: 2 },
  { id: 'lik_resp_4', type: 'likert', text: 'Con frecuencia dejo pendientes para el último momento.', trait: 'responsabilidad', reverseScored: true, enabled: true, order: 3 },
  { id: 'lik_resp_5', type: 'likert', text: 'Reviso mi trabajo antes de darlo por terminado.', trait: 'responsabilidad', reverseScored: false, enabled: true, order: 4 },
  { id: 'lik_resp_6', type: 'likert', text: 'Me cuesta mantener el orden en mis tareas diarias.', trait: 'responsabilidad', reverseScored: true, enabled: true, order: 5 },

  // ── Estabilidad emocional ──
  { id: 'lik_est_1', type: 'likert', text: 'Mantengo la calma cuando un cliente se muestra molesto.', trait: 'estabilidad_emocional', reverseScored: false, enabled: true, order: 6 },
  { id: 'lik_est_2', type: 'likert', text: 'Un mal resultado en el día no afecta mi desempeño al día siguiente.', trait: 'estabilidad_emocional', reverseScored: false, enabled: true, order: 7 },
  { id: 'lik_est_3', type: 'likert', text: 'Me tomo los rechazos de manera personal.', trait: 'estabilidad_emocional', reverseScored: true, enabled: true, order: 8 },
  { id: 'lik_est_4', type: 'likert', text: 'Puedo seguir trabajando bien incluso en días de mucha presión.', trait: 'estabilidad_emocional', reverseScored: false, enabled: true, order: 9 },
  { id: 'lik_est_5', type: 'likert', text: 'Me altero fácilmente cuando las cosas no salen como esperaba.', trait: 'estabilidad_emocional', reverseScored: true, enabled: true, order: 10 },
  { id: 'lik_est_6', type: 'likert', text: 'Recupero mi buen ánimo rápido después de una situación difícil.', trait: 'estabilidad_emocional', reverseScored: false, enabled: true, order: 11 },

  // ── Extraversión / Asertividad ──
  { id: 'lik_ext_1', type: 'likert', text: 'Me resulta fácil iniciar una conversación con alguien que no conozco.', trait: 'extraversion', reverseScored: false, enabled: true, order: 12 },
  { id: 'lik_ext_2', type: 'likert', text: 'Disfruto buscar activamente nuevos clientes o prospectos.', trait: 'extraversion', reverseScored: false, enabled: true, order: 13 },
  { id: 'lik_ext_3', type: 'likert', text: 'Prefiero evitar el contacto directo con desconocidos.', trait: 'extraversion', reverseScored: true, enabled: true, order: 14 },
  { id: 'lik_ext_4', type: 'likert', text: 'Me siento cómodo hablando frente a un grupo de personas.', trait: 'extraversion', reverseScored: false, enabled: true, order: 15 },
  { id: 'lik_ext_5', type: 'likert', text: 'Soy de las personas que toman la iniciativa en un grupo.', trait: 'extraversion', reverseScored: false, enabled: true, order: 16 },
  { id: 'lik_ext_6', type: 'likert', text: 'Me cuesta trabajo expresar mis ideas frente a otros.', trait: 'extraversion', reverseScored: true, enabled: true, order: 17 },

  // ── Amabilidad / Orientación de servicio ──
  { id: 'lik_ama_1', type: 'likert', text: 'Escucho con atención las necesidades de la otra persona antes de responder.', trait: 'amabilidad', reverseScored: false, enabled: true, order: 18 },
  { id: 'lik_ama_2', type: 'likert', text: 'Trato a los demás con respeto incluso cuando no estoy de acuerdo.', trait: 'amabilidad', reverseScored: false, enabled: true, order: 19 },
  { id: 'lik_ama_3', type: 'likert', text: 'Puedo ser firme y decir que no cuando es necesario.', trait: 'amabilidad', reverseScored: false, enabled: true, order: 20 },
  { id: 'lik_ama_4', type: 'likert', text: 'Me cuesta ponerme en el lugar de otra persona.', trait: 'amabilidad', reverseScored: true, enabled: true, order: 21 },
  { id: 'lik_ama_5', type: 'likert', text: 'Disfruto ayudar a resolver los problemas de otras personas.', trait: 'amabilidad', reverseScored: false, enabled: true, order: 22 },
  { id: 'lik_ama_6', type: 'likert', text: 'Suelo anteponer mis intereses sobre los de los demás.', trait: 'amabilidad', reverseScored: true, enabled: true, order: 23 },

  // ── Juicio situacional (SJT) ──
  {
    id: 'sjt_1', type: 'sjt', enabled: true, order: 24,
    text: 'Un cliente te dice que esta semana no puede pagar su cuota. ¿Qué haces?',
    options: [
      { text: 'Le explicas las consecuencias y buscan juntos una alternativa de pago realista.', score: 2 },
      { text: 'Le das la extensión sin registrar nada y sigues con el siguiente cliente.', score: 0 },
      { text: 'Le insistes de forma repetida hasta que se comprometa a pagar aunque no pueda.', score: 1 },
    ],
  },
  {
    id: 'sjt_2', type: 'sjt', enabled: true, order: 25,
    text: 'Llevas todo el día sin cerrar ninguna venta y aún faltan dos horas de turno.',
    options: [
      { text: 'Sigues con tu rutina normal, sin cambiar de estrategia.', score: 1 },
      { text: 'Te desanimas y reduces tu esfuerzo el resto del turno.', score: 0 },
      { text: 'Revisas qué no está funcionando y ajustas tu forma de abordar al siguiente cliente.', score: 2 },
    ],
  },
  {
    id: 'sjt_3', type: 'sjt', enabled: true, order: 26,
    text: 'Tu gerente te da una retroalimentación negativa frente a otros compañeros.',
    options: [
      { text: 'Te enojas y respondes de forma defensiva en el momento.', score: 0 },
      { text: 'Escuchas, controlas tu reacción y buscas hablarlo en privado después.', score: 2 },
      { text: 'Te quedas callado pero decides ignorar el comentario.', score: 1 },
    ],
  },
  {
    id: 'sjt_4', type: 'sjt', enabled: true, order: 27,
    text: 'Un cliente insiste en un descuento que no estás autorizado a dar.',
    options: [
      { text: 'Le das el descuento de todas formas para no perder la venta.', score: 0 },
      { text: 'Le explicas con claridad lo que sí puedes ofrecer y consultas con tu líder si aplica.', score: 2 },
      { text: 'Le dices que no de forma tajante y cambias de tema.', score: 1 },
    ],
  },
  {
    id: 'sjt_5', type: 'sjt', enabled: true, order: 28,
    text: 'Notas que un compañero está sobrecargado de trabajo en tienda.',
    options: [
      { text: 'Te enfocas solo en tus propias metas del día.', score: 0 },
      { text: 'Le ofreces ayuda si ya cumpliste con lo tuyo.', score: 2 },
      { text: 'Le sugieres que hable con el gerente, pero tú no intervienes.', score: 1 },
    ],
  },
  {
    id: 'sjt_6', type: 'sjt', enabled: true, order: 29,
    text: 'Se acerca el cierre de mes y te faltan varias ventas para tu meta.',
    options: [
      { text: 'Presionas a los clientes para cerrar ventas que no necesitan.', score: 0 },
      { text: 'Intensificas tu actividad (más contactos, seguimiento) sin comprometer la calidad del servicio.', score: 2 },
      { text: 'Esperas a ver si las ventas llegan solas en los últimos días.', score: 1 },
    ],
  },
  {
    id: 'sjt_7', type: 'sjt', enabled: true, order: 30,
    text: 'Un cliente te reclama con enojo por un cargo que no reconoce.',
    options: [
      { text: 'Te pones a la defensiva y le explicas que no es tu culpa.', score: 0 },
      { text: 'Escuchas su queja, revisas la información y le das una respuesta clara con los siguientes pasos.', score: 2 },
      { text: 'Le dices que se comunique a otra área y das el tema por terminado.', score: 1 },
    ],
  },
  {
    id: 'sjt_8', type: 'sjt', enabled: true, order: 31,
    text: 'Tienes un procedimiento nuevo que te parece más lento que el anterior.',
    options: [
      { text: 'Sigues usando el procedimiento anterior porque es más rápido.', score: 0 },
      { text: 'Sigues el nuevo procedimiento y comentas tu observación a tu líder.', score: 2 },
      { text: 'Sigues el nuevo procedimiento solo cuando alguien te está supervisando.', score: 1 },
    ],
  },
  {
    id: 'sjt_9', type: 'sjt', enabled: true, order: 32,
    text: 'Es temporada alta (Buen Fin) y hay mucho más tráfico de clientes del habitual.',
    options: [
      { text: 'Atiendes a todos por igual, aunque eso signifique tardar más con cada uno.', score: 1 },
      { text: 'Ajustas tu ritmo y priorizas para atender a más clientes sin bajar la calidad del servicio.', score: 2 },
      { text: 'Te sientes abrumado y reduces tu disposición a atender.', score: 0 },
    ],
  },
  {
    id: 'sjt_10', type: 'sjt', enabled: true, order: 33,
    text: 'Un cliente potencial te dice que "lo va a pensar" y se quiere ir.',
    options: [
      { text: 'Lo dejas ir sin más información.', score: 0 },
      { text: 'Le preguntas qué duda tiene y le das información que le ayude a decidir, sin presionarlo.', score: 2 },
      { text: 'Insistes de manera repetida para que decida ahora mismo.', score: 1 },
    ],
  },
];

export const DEFAULT_PSYCHOMETRIC_CONFIG: PsychometricTestConfig = {
  weights: {
    responsabilidad: 0.2,
    estabilidad_emocional: 0.2,
    extraversion: 0.2,
    amabilidad: 0.2,
    sjt: 0.2,
  },
  bandCutoffs: { lowMax: 40, highMin: 70 },
  timeLimitMinutes: 30,
};

export async function getPsychometricQuestions(): Promise<PsychometricQuestion[]> {
  const snap = await getDoc(QUESTIONS_DOC);
  if (!snap.exists() || !(snap.data().questions as PsychometricQuestion[])?.length) {
    await setDoc(QUESTIONS_DOC, { questions: DEFAULT_PSYCHOMETRIC_QUESTIONS });
    return DEFAULT_PSYCHOMETRIC_QUESTIONS;
  }
  return (snap.data().questions as PsychometricQuestion[]) ?? [];
}

export async function savePsychometricQuestions(questions: PsychometricQuestion[]): Promise<void> {
  await setDoc(QUESTIONS_DOC, { questions });
}

export async function getPsychometricConfig(): Promise<PsychometricTestConfig> {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    await setDoc(CONFIG_DOC, DEFAULT_PSYCHOMETRIC_CONFIG);
    return DEFAULT_PSYCHOMETRIC_CONFIG;
  }
  return snap.data() as PsychometricTestConfig;
}

export async function savePsychometricConfig(config: PsychometricTestConfig): Promise<void> {
  await setDoc(CONFIG_DOC, config);
}
