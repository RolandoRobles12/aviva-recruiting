// Curated starter bank, written for Aviva's field roles (asesor de crédito,
// venta en piso y cobranza). It is *seed* content, not hardcoded content: it is
// written to settings/psychometric_questions only when an admin asks for it, and
// from that moment on Firestore is the single source of truth.
//
// How it is built:
//  - Five scored traits. The four Big-Five-style ones from the original design
//    plus integridad, which is the strongest predictor of counterproductive
//    behaviour available in a self-report and the most job-relevant one when the
//    role handles other people's money and credit data.
//  - 14 items per trait, half of them reverse worded. Sessions apply 8 per trait
//    by default, which is the range where a short Likert scale reaches an
//    internal consistency around .75-.85; the surplus lets sessions vary between
//    candidates and lets the analysis tab retire items that do not work.
//  - Two response-style scales: deseabilidad_social (desirable but improbable
//    claims) and infrecuencia (claims nobody can honestly endorse). They never
//    touch the profile — they only feed the reliability verdict.
//  - Three instructed-response attention checks.
//  - 14 situational scenarios with four options each, keyed 0-3 by effectiveness
//    (a rational key, which the literature finds as reliable as an empirical one
//    and far more practical to maintain).
//
// Wording rules used throughout: first person, present tense, one idea per item,
// no double negatives, no assumption of previous experience in the role, and
// nothing that touches protected characteristics (health, religion, family
// situation, political views).

import type {
  PsychometricAttentionQuestion,
  PsychometricLikertQuestion,
  PsychometricLikertScale,
  PsychometricQuestion,
  PsychometricSjtQuestion,
  PsychometricTestConfig,
} from './types';

/** [texto, invertido] — invertido = estar de acuerdo indica MENOS del rasgo. */
type LikertSeed = [string, boolean];

function likertItems(
  prefix: string,
  scale: PsychometricLikertScale,
  seeds: LikertSeed[]
): PsychometricLikertQuestion[] {
  return seeds.map(([text, reverseScored], index) => ({
    id: `${prefix}_${String(index + 1).padStart(2, '0')}`,
    type: 'likert',
    scale,
    text,
    reverseScored,
    enabled: true,
    order: 0, // reassigned below
  }));
}

const RESPONSABILIDAD: LikertSeed[] = [
  ['Termino lo que empiezo, aunque deje de ser interesante.', false],
  ['Llego puntual a mis compromisos.', false],
  ['Planeo mi día antes de empezar a trabajar.', false],
  ['Reviso mi trabajo antes de entregarlo para detectar errores.', false],
  ['Cumplo lo que prometo, incluso cuando nadie me está supervisando.', false],
  ['Mantengo en orden mis documentos y herramientas de trabajo.', false],
  ['Cuando me asignan una meta, le doy seguimiento hasta cerrarla.', false],
  ['Dejo las tareas difíciles para el último momento.', true],
  ['Se me olvida dar seguimiento a los pendientes que me piden.', true],
  ['Me cuesta organizar mi tiempo cuando tengo varias cosas por hacer.', true],
  ['Empiezo muchas cosas y termino pocas.', true],
  ['Suelo entregar mis reportes fuera de tiempo.', true],
  ['Trabajo mejor improvisando sobre la marcha que siguiendo un plan.', true],
  ['Con frecuencia pierdo papeles o cosas que necesito para trabajar.', true],
];

const ESTABILIDAD_EMOCIONAL: LikertSeed[] = [
  ['Mantengo la calma cuando un cliente me habla de mala manera.', false],
  ['Me recupero rápido después de un día malo.', false],
  ['Puedo trabajar bajo presión sin perder el control.', false],
  ['Cuando algo sale mal, me concentro en resolverlo más que en preocuparme.', false],
  ['Un "no" de un cliente no me desanima para seguir con el siguiente.', false],
  ['Acepto una crítica sobre mi trabajo sin sentirme atacado.', false],
  ['Tomo decisiones con claridad incluso cuando el día está muy cargado.', false],
  ['Me pongo nervioso cuando tengo que cumplir una meta ajustada.', true],
  ['Me molesto con facilidad por cosas pequeñas.', true],
  ['Después de una discusión me quedo pensando en ella durante horas.', true],
  ['Me desanimo cuando varios clientes me rechazan seguido.', true],
  ['Siento con frecuencia que la presión del trabajo me supera.', true],
  ['Me preocupo por cosas que probablemente no van a pasar.', true],
  ['Cuando me corrigen frente a otras personas, me cuesta reponerme.', true],
];

const EXTRAVERSION: LikertSeed[] = [
  ['Me acerco sin problema a personas que no conozco para ofrecerles un producto.', false],
  ['Me siento cómodo hablando frente a un grupo.', false],
  ['Tomo la iniciativa en una conversación con un cliente nuevo.', false],
  ['Tratar con gente todo el día me da energía.', false],
  ['Insisto de forma amable cuando creo que puedo cerrar una venta.', false],
  ['Me resulta fácil empezar una plática con cualquier persona.', false],
  ['Prefiero un trabajo con contacto constante con clientes que uno de escritorio.', false],
  ['Prefiero enviar un mensaje antes que hacer una llamada.', true],
  ['Me incomoda abordar a alguien para ofrecerle un producto.', true],
  ['Me cuesta insistir cuando la otra persona se opone.', true],
  ['Al final del día, tratar con mucha gente me deja agotado.', true],
  ['En una reunión prefiero escuchar y no participar.', true],
  ['Evito las situaciones en las que tengo que convencer a alguien.', true],
  ['Me quedo callado cuando no estoy de acuerdo con algo.', true],
];

const AMABILIDAD: LikertSeed[] = [
  ['Me tomo el tiempo de explicar las cosas hasta que el cliente entiende.', false],
  ['Ayudo a un compañero aunque no sea mi responsabilidad.', false],
  ['Me interesa de verdad que al cliente le sirva lo que le ofrezco.', false],
  ['Escucho a la persona antes de proponerle una solución.', false],
  ['Trato con respeto a quien me trata mal.', false],
  ['Comparto lo que sé con quienes van empezando.', false],
  ['Busco acuerdos cuando hay un desacuerdo en el equipo.', false],
  ['Me impacienta un cliente que pregunta lo mismo varias veces.', true],
  ['Si un compañero se equivoca, prefiero que lo resuelva solo.', true],
  ['Me cuesta ponerme en el lugar de la otra persona.', true],
  ['Cuando tengo prisa, atiendo rápido aunque el cliente se quede con dudas.', true],
  ['En el trabajo cada quien debe ver por sí mismo.', true],
  ['Me molesta que me interrumpan para pedirme ayuda.', true],
  ['Ser demasiado amable con el cliente es perder el tiempo.', true],
];

const INTEGRIDAD: LikertSeed[] = [
  ['Prefiero perder una venta antes que prometer algo que no se va a cumplir.', false],
  ['Reporto un error mío aunque nadie se haya dado cuenta.', false],
  ['Explico al cliente el costo real, incluso si eso lo hace dudar.', false],
  ['Sigo el procedimiento aunque exista un atajo más rápido.', false],
  ['Si veo a un compañero haciendo algo indebido, lo reporto.', false],
  ['Registro mis actividades tal como ocurrieron, aunque no me favorezca.', false],
  ['Entrego completo el dinero de una operación sin que nadie lo revise.', false],
  ['Si el cliente no pregunta un detalle, no tengo por qué mencionarlo.', true],
  ['Exagerar un poco los beneficios es parte normal de vender.', true],
  ['Cuando la meta está en riesgo, se justifica saltarse algún requisito.', true],
  ['Llevarse material de la oficina para uso personal no tiene nada de malo.', true],
  ['Si nadie se va a enterar, romper una regla menor no es problema.', true],
  ['Está bien registrar una visita que no se hizo si el resultado se cumple.', true],
  ['He ajustado el dato de un cliente para que un trámite pudiera avanzar.', true],
];

// Desirable but improbable: agreeing with several of these signals impression
// management. It is reported as a caution flag only — scores are never corrected
// for it, because those corrections do not recover the honest score.
const DESEABILIDAD_SOCIAL: LikertSeed[] = [
  ['Nunca me he molestado con un compañero de trabajo.', false],
  ['Siempre digo la verdad, sin ninguna excepción.', false],
  ['Nunca he hablado mal de alguien a sus espaldas.', false],
  ['Jamás he llegado tarde a un compromiso.', false],
  ['Nunca he sentido envidia de nadie.', false],
  ['Estoy de buen humor todo el tiempo, sin importar lo que pase.', false],
];

// Nobody can honestly agree with these. Agreement means the items are not being
// read, which is the cleanest evidence of random responding.
const INFRECUENCIA: LikertSeed[] = [
  ['Puedo leer un documento de cien páginas en menos de un minuto.', false],
  ['No necesito dormir para sentirme descansado.', false],
  ['Todas las personas que conozco están de acuerdo conmigo en todo.', false],
  ['He trabajado varios días seguidos sin descansar y sin sentir cansancio.', false],
  ['Nunca en mi vida he olvidado nada.', false],
];

const ATENCION: Omit<PsychometricAttentionQuestion, 'order'>[] = [
  {
    id: 'aten_01',
    type: 'attention',
    text: 'Para verificar que estás leyendo con calma, selecciona la opción "En desacuerdo" en esta afirmación.',
    expectedValue: 2,
    enabled: true,
  },
  {
    id: 'aten_02',
    type: 'attention',
    text: 'Esta afirmación es un control de lectura: selecciona "Totalmente de acuerdo".',
    expectedValue: 5,
    enabled: true,
  },
  {
    id: 'aten_03',
    type: 'attention',
    text: 'Si estás leyendo cada afirmación, elige "Neutral" en esta.',
    expectedValue: 3,
    enabled: true,
  },
];

// Options are keyed 0-3 by effectiveness and shuffled per session, so their
// order here carries no information for the candidate.
const SJT: Omit<PsychometricSjtQuestion, 'order'>[] = [
  {
    id: 'sjt_01',
    type: 'sjt',
    enabled: true,
    competency: 'Cobranza y manejo de acuerdos',
    text: 'Un cliente lleva 15 días de atraso en su pago. Te dice que perdió su empleo y que no sabe cuándo podrá pagar. ¿Qué haces?',
    options: [
      { text: 'Escucho su situación, le presento las opciones de reestructura que permite la política y dejo el acuerdo por escrito.', score: 3 },
      { text: 'Le recuerdo la fecha límite y las consecuencias del atraso, y agendo una llamada de seguimiento para la próxima semana.', score: 2 },
      { text: 'Acepto de palabra que pague cuando pueda y no registro nada por el momento.', score: 1 },
      { text: 'Le digo que se le va a reportar de inmediato al buró y termino la llamada.', score: 0 },
    ],
  },
  {
    id: 'sjt_02',
    type: 'sjt',
    enabled: true,
    competency: 'Apego a procedimiento bajo presión de meta',
    text: 'Falta un documento del expediente de un cliente. Él insiste en que ya lo entregó y hoy cierra la meta del mes. ¿Qué haces?',
    options: [
      { text: 'Verifico en el sistema, le explico exactamente qué falta y lo apoyo para conseguirlo hoy, aunque el trámite se cierre mañana.', score: 3 },
      { text: 'Subo el expediente marcando el documento como pendiente y aviso a mi supervisor de lo que falta.', score: 2 },
      { text: 'Le pido cualquier documento parecido que sirva para completar el expediente.', score: 1 },
      { text: 'Registro el documento como recibido y lo consigo en los próximos días.', score: 0 },
    ],
  },
  {
    id: 'sjt_03',
    type: 'sjt',
    enabled: true,
    competency: 'Integridad frente al equipo',
    text: 'Te das cuenta de que un compañero reporta visitas a clientes que no realizó. ¿Qué haces?',
    options: [
      { text: 'Hablo con él directamente y, si no lo corrige, lo informo a mi supervisor.', score: 3 },
      { text: 'Lo comento con mi supervisor sin hablar antes con el compañero.', score: 2 },
      { text: 'No digo nada, es su responsabilidad y no quiero problemas.', score: 1 },
      { text: 'Hago lo mismo para no quedar por debajo en el ranking del equipo.', score: 0 },
    ],
  },
  {
    id: 'sjt_04',
    type: 'sjt',
    enabled: true,
    competency: 'Manejo de clientes difíciles',
    text: 'Un cliente llega molesto al módulo y grita que le cobraron algo que no reconoce. Hay otras personas esperando. ¿Qué haces?',
    options: [
      { text: 'Lo invito a un lugar más tranquilo, escucho el detalle, reviso el movimiento y le explico con evidencia qué pasó.', score: 3 },
      { text: 'Le pido que baje la voz y lo canalizo al área de aclaraciones.', score: 2 },
      { text: 'Le explico que así es la política y que no puedo hacer nada al respecto.', score: 1 },
      { text: 'Le respondo en el mismo tono para que entienda que no es mi culpa.', score: 0 },
    ],
  },
  {
    id: 'sjt_05',
    type: 'sjt',
    enabled: true,
    competency: 'Venta responsable',
    text: 'Un cliente califica para un crédito mucho mayor al que necesita. Tu meta se mide por monto colocado. ¿Qué haces?',
    options: [
      { text: 'Le ofrezco el monto que corresponde a su necesidad y capacidad de pago, y le explico por qué.', score: 3 },
      { text: 'Le presento las dos opciones con el costo total de cada una y lo dejo decidir.', score: 2 },
      { text: 'Le ofrezco el monto mayor y le menciono de paso que puede pagar antes si quiere.', score: 1 },
      { text: 'Lo convenzo del monto mayor, porque de todos modos se lo van a autorizar.', score: 0 },
    ],
  },
  {
    id: 'sjt_06',
    type: 'sjt',
    enabled: true,
    competency: 'Orientación a resultados',
    text: 'Vas por debajo de tu meta y quedan tres días del mes. ¿Qué haces?',
    options: [
      { text: 'Reviso mi cartera de prospectos, priorizo a los que ya mostraron interés y aumento el número de contactos por día.', score: 3 },
      { text: 'Pido apoyo a mi supervisor para revisar qué está fallando en mi proceso.', score: 2 },
      { text: 'Espero a que se cierre algo en los últimos días, suele pasar.', score: 1 },
      { text: 'Registro una operación de un familiar para cubrir el número.', score: 0 },
    ],
  },
  {
    id: 'sjt_07',
    type: 'sjt',
    enabled: true,
    competency: 'Negociación',
    text: 'Un cliente pide un descuento que no existe y dice que la competencia le ofrece algo mejor. ¿Qué haces?',
    options: [
      { text: 'Le explico con números el valor de nuestro producto y le ofrezco lo que sí está en mis manos.', score: 3 },
      { text: 'Consulto con mi supervisor si hay alguna promoción vigente que le aplique.', score: 2 },
      { text: 'Le digo que lo piense y no vuelvo a contactarlo.', score: 1 },
      { text: 'Le prometo el descuento y después veo cómo lo resuelvo.', score: 0 },
    ],
  },
  {
    id: 'sjt_08',
    type: 'sjt',
    enabled: true,
    competency: 'Manejo de errores propios',
    text: 'Descubres que capturaste mal el ingreso de un cliente y el crédito ya fue autorizado. ¿Qué haces?',
    options: [
      { text: 'Lo informo de inmediato a mi supervisor para corregir el expediente por el canal que corresponde.', score: 3 },
      { text: 'Corrijo el dato en el sistema y dejo una nota explicando lo ocurrido.', score: 2 },
      { text: 'Espero a ver si alguien lo detecta antes de moverlo.', score: 1 },
      { text: 'Lo dejo así, el crédito ya está autorizado y el cliente puede pagar.', score: 0 },
    ],
  },
  {
    id: 'sjt_09',
    type: 'sjt',
    enabled: true,
    competency: 'Integridad frente al cliente',
    text: 'Un cliente te ofrece una propina para que "agilices" su trámite. ¿Qué haces?',
    options: [
      { text: 'La rechazo, le explico el proceso real y reporto el intento a mi supervisor.', score: 3 },
      { text: 'La rechazo amablemente y continúo con su trámite en el orden que le toca.', score: 2 },
      { text: 'No la acepto, pero le doy prioridad a su trámite.', score: 1 },
      { text: 'La acepto, porque el trámite se iba a hacer de todas formas.', score: 0 },
    ],
  },
  {
    id: 'sjt_10',
    type: 'sjt',
    enabled: true,
    competency: 'Prospección',
    text: 'Te asignan una zona nueva donde no tienes cartera y nadie te conoce. ¿Qué haces primero?',
    options: [
      { text: 'Recorro la zona, identifico negocios y puntos con afluencia, y armo un plan de visitas por día.', score: 3 },
      { text: 'Pido a mi supervisor la información de la zona y me apoyo en referidos de clientes actuales.', score: 2 },
      { text: 'Espero a que me asignen prospectos para empezar.', score: 1 },
      { text: 'Me concentro en mi zona anterior, donde ya me conocen.', score: 0 },
    ],
  },
  {
    id: 'sjt_11',
    type: 'sjt',
    enabled: true,
    competency: 'Claridad y trato justo',
    text: 'Un cliente adulto mayor ya firmó, pero al despedirse te queda claro que no entendió el esquema de pagos. ¿Qué haces?',
    options: [
      { text: 'Le explico otra vez con ejemplos concretos, confirmo que entendió y le ofrezco que lo acompañe un familiar de confianza.', score: 3 },
      { text: 'Le entrego el calendario con fechas y montos y le pido que lo revise con calma en casa.', score: 2 },
      { text: 'Le digo que en la sucursal le pueden explicar cuando guste.', score: 1 },
      { text: 'Sigo adelante: ya firmó y es su responsabilidad entender el contrato.', score: 0 },
    ],
  },
  {
    id: 'sjt_12',
    type: 'sjt',
    enabled: true,
    competency: 'Prioridades y comunicación',
    text: 'Tu supervisor te pide un reporte para hoy y, al mismo tiempo, un cliente te llama con una urgencia. ¿Qué haces?',
    options: [
      { text: 'Atiendo la llamada, acuerdo con el cliente un tiempo concreto de respuesta y aviso a mi supervisor si el reporte se va a retrasar.', score: 3 },
      { text: 'Termino el reporte primero y devuelvo la llamada en cuanto lo entrego.', score: 2 },
      { text: 'Atiendo al cliente y entrego el reporte tarde sin avisar.', score: 1 },
      { text: 'Ignoro la llamada: el reporte es lo que me evalúan.', score: 0 },
    ],
  },
  {
    id: 'sjt_13',
    type: 'sjt',
    enabled: true,
    competency: 'Cuidado de la información',
    text: 'Un compañero te comparte su contraseña del sistema para que avances más rápido mientras te dan tu acceso. ¿Qué haces?',
    options: [
      { text: 'No la uso, le explico el riesgo que corre y doy seguimiento a mi solicitud de acceso.', score: 3 },
      { text: 'No la uso y escalo con mi supervisor que sigo sin acceso para trabajar.', score: 2 },
      { text: 'La uso solo esta vez, porque hay algo urgente que entregar.', score: 1 },
      { text: 'La uso cuando me convenga, mientras siga funcionando.', score: 0 },
    ],
  },
  {
    id: 'sjt_14',
    type: 'sjt',
    enabled: true,
    competency: 'Manejo de efectivo',
    text: 'Un cliente te entrega un pago en efectivo fuera de horario, cuando ya no puedes emitir el comprobante. ¿Qué haces?',
    options: [
      { text: 'No recibo el efectivo sin comprobante y acuerdo con él el canal formal para que su pago quede registrado hoy o mañana temprano.', score: 3 },
      { text: 'Lo recibo, emito el comprobante en cuanto abre el sistema y aviso a mi supervisor del movimiento.', score: 2 },
      { text: 'Lo recibo y lo deposito al día siguiente, sin comprobante de por medio.', score: 1 },
      { text: 'Lo recibo y lo deposito cuando pueda pasar a la sucursal.', score: 0 },
    ],
  },
];

/** The curated bank, with `order` assigned in the sequence declared above. */
export const DEFAULT_QUESTION_BANK: PsychometricQuestion[] = [
  ...likertItems('resp', 'responsabilidad', RESPONSABILIDAD),
  ...likertItems('esta', 'estabilidad_emocional', ESTABILIDAD_EMOCIONAL),
  ...likertItems('extr', 'extraversion', EXTRAVERSION),
  ...likertItems('amab', 'amabilidad', AMABILIDAD),
  ...likertItems('integ', 'integridad', INTEGRIDAD),
  ...likertItems('desea', 'deseabilidad_social', DESEABILIDAD_SOCIAL),
  ...likertItems('infre', 'infrecuencia', INFRECUENCIA),
  ...ATENCION.map((question) => ({ ...question, order: 0 })),
  ...SJT.map((question) => ({ ...question, order: 0 })),
].map((question, index) => ({ ...question, order: index }));

/**
 * Defaults tuned for the curated bank above: 8 items per trait (40), 8
 * scenarios, 4 social-desirability, 3 infrequency and 2 attention checks = 57
 * items, which candidates finish well inside 35 minutes.
 *
 * Weights lean on responsabilidad and integridad, the two traits with the
 * clearest link to performance and to counterproductive behaviour in roles that
 * handle credit and cash.
 */
export const DEFAULT_TEST_CONFIG: PsychometricTestConfig = {
  weights: {
    responsabilidad: 0.25,
    integridad: 0.2,
    estabilidad_emocional: 0.2,
    sjt: 0.15,
    extraversion: 0.1,
    amabilidad: 0.1,
  },
  // Absolute fallback, used only until the local norm sample exists. The cutoffs
  // sit high on purpose: on a "percent of maximum" Likert score, honest
  // applicants concentrate between 60 and 90.
  bandCutoffs: { lowMax: 55, highMin: 75 },
  percentileCutoffs: { lowMaxPercentile: 25, highMinPercentile: 75 },
  timeLimitMinutes: 35,
  questionCounts: {
    likertPerTrait: 8,
    sjt: 8,
    deseabilidadSocial: 4,
    infrecuencia: 3,
    atencion: 2,
  },
  minItemsPerScale: 4,
  useLocalNorms: true,
};
