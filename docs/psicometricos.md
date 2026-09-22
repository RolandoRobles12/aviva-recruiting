# Prueba psicométrica — diseño y criterios

Este documento explica **por qué** el módulo psicométrico funciona como funciona.
El código vive en `functions/src/psychometricTest/` (calificación, siempre del
lado del servidor) y en `src/components/psychometric/` (administración y
resultados).

---

## 1. Qué mide

| Escala | Tipo | Para qué sirve en los puestos de Aviva |
|---|---|---|
| Responsabilidad | rasgo | Cumplimiento de plazos, orden documental, seguimiento de cartera |
| Estabilidad emocional | rasgo | Tolerancia al rechazo y a la presión de meta, trato con cliente molesto |
| Extraversión / asertividad | rasgo | Prospección activa, cierre, iniciativa social |
| Amabilidad / servicio | rasgo | Calidad de atención, cooperación con el equipo |
| **Integridad / apego a normas** | rasgo | Manejo de efectivo y datos de crédito, apego a procedimiento cuando la meta aprieta |
| Juicio situacional (SJT) | escenarios | Qué haría en situaciones reales de venta, crédito y cobranza |
| **Riesgo de violencia / agresividad** | **riesgo** | Trato con clientes molestos y morosos, visitas de cobranza, convivencia en sucursal |
| **Riesgo de consumo de sustancias** | **riesgo** | Asistencia, puntualidad, seguridad en ruta y trato con clientes |
| Deseabilidad social | **validez** | Detectar a quien contesta "lo que queremos oír" |
| Infrecuencia | **validez** | Detectar respuestas al azar o sin leer |
| Controles de atención | **validez** | Detectar a quien no está leyendo los reactivos |

Las tres últimas **nunca entran al perfil ni al score compuesto**. Solo alimentan
el veredicto de confiabilidad.

Las dos escalas de **riesgo** tampoco entran al compuesto: se reportan como una
alerta aparte (ver §5 bis). Un candidato no puede "compensar" un riesgo de
violencia con una extraversión alta.

Integridad se agregó porque es el rasgo de autorreporte con la relación más clara
con conductas contraproducentes, y es el más pertinente cuando el puesto maneja
dinero y datos de crédito de terceros.

---

## 2. Tamaño del banco y de la prueba

El banco base trae **14 ítems por rasgo** (mitad invertidos), **14 por escala de
riesgo** (mitad protectores, 3 críticos), 6 de deseabilidad social, 5 de
infrecuencia, 3 controles de atención y 14 escenarios SJT.

Cada sesión aplica por configuración 8 ítems por rasgo, 10 por escala de riesgo,
8 escenarios, 4 + 3 ítems de validez y 2 controles: **77 reactivos**, que la
mayoría termina en unos 25 minutos (el límite está en 35).

Por qué esas cifras:

- **8 ítems por escala** es el rango donde una escala Likert corta alcanza una
  consistencia interna del orden de .75–.85. Con 4 ítems por escala se puede
  bajar de .70, y por debajo de eso el puntaje individual deja de ser
  interpretable.
- **Banco más grande que la prueba** (14 vs 8) permite dos cosas: que la prueba
  varíe entre candidatos y que se puedan **retirar ítems que no funcionan** sin
  quedarse corto. Construir "de más" y depurar después es la práctica estándar,
  y es justamente lo que habilita la pestaña *Análisis del instrumento*.
- **Mitad de ítems invertidos** por escala: una escala donde todo se redacta en
  la misma dirección mide tanto la tendencia a estar de acuerdo como el rasgo, y
  además hace imposible calcular la consistencia entre direcciones.
- **8 escenarios SJT**: por debajo de 5 el puntaje es muy inestable.

---

## 3. Cómo se arma cada sesión

`sampling.ts` no toma una muestra al azar del banco: la estratifica.

1. Por rasgo y por escala de riesgo, muestrea balanceando ítems normales e
   invertidos. En las escalas de riesgo, **los ítems críticos se aplican
   siempre** (si el número configurado no alcanza para todos, se amplía): son los
   que se reportan uno por uno cuando el candidato los admite, y que eso
   dependiera del sorteo sería arbitrario.
2. Muestrea por separado las escalas de validez y los controles de atención, de
   modo que **acortar la prueba nunca quita la capacidad de detectar respuestas
   descuidadas**.
3. Intercala los ítems para que dos preguntas consecutivas rara vez sean del
   mismo rasgo. Los de riesgo se mezclan con los de personalidad: agrupados, una
   serie de preguntas sobre pleitos y alcohol se lee como "aquí me están
   filtrando" y provoca las respuestas más cuidadas de toda la prueba.
4. Distribuye los controles de atención a lo largo de la prueba, nunca al inicio
   ni pegados entre sí.
5. Aleatoriza el orden de las opciones de cada escenario y **congela** ese orden.

Al iniciarse, la sesión guarda una **copia completa de las preguntas aplicadas**
(`appliedQuestions`), no solo sus ids. Así, editar el banco mientras alguien está
resolviendo no cambia cómo se califica esa prueba.

---

## 4. Cómo se califica

- **Reactivos invertidos**: se puntean `6 - valor`, de modo que en todas las
  escalas "más alto = más del rasgo".
- **Escala 0–100**: el mínimo Likert es 1, no 0, así que la normalización resta
  el piso. Una hilera de 1 vale 0, no 20.
- **SJT**: cada escenario se normaliza contra **su propia opción de puntaje más
  alto**, así que se pueden mezclar escenarios con claves 0–2 y 0–3.
- **Datos faltantes son faltantes, no ceros.** Una escala con menos respuestas
  que `minItemsPerScale` se reporta como *sin datos*. Antes se reportaba 0, que
  se leía como "bajo" y castigaba a quien se quedó sin tiempo.
- **Compuesto**: promedio ponderado sobre las escalas que sí tienen datos, con
  los pesos renormalizados entre ellas. Una escala ausente reparte su peso, no
  arrastra el compuesto a cero.
- **Validación de respuestas**: solo se califica lo que pertenece a la sesión y
  cae en el rango del reactivo. Un valor fuera de rango se descarta, nunca se
  ajusta.

### Pesos por omisión

Responsabilidad .25, integridad .20, estabilidad emocional .20, SJT .15,
extraversión .10, amabilidad .10. No tienen que sumar 1; se normalizan.

---

## 5. Bandas: por qué son normativas

Un autorreporte Likert leído como "porcentaje del máximo" produce una
distribución comprimida y sesgada a la derecha: los candidatos honestos se
agrupan arriba. Con cortes absolutos de 40/70 —los originales— casi nadie caía
en "bajo" y casi todos en "alto". La banda no informaba nada.

Por eso el sistema acumula una **muestra normativa local** (`n`, suma y suma de
cuadrados por escala, en `settings/psychometric_norms`) y, cuando alcanza,
reporta el **percentil del candidato frente a los demás**:

| Muestra | Qué se usa | Etiqueta en el resultado |
|---|---|---|
| < 30 | cortes absolutos | "Cortes absolutos (aún sin muestra local suficiente)" |
| 30 – 99 | percentiles | "normas locales provisionales" |
| ≥ 100 | percentiles | "normas locales" |

El umbral de 100 es la referencia habitual para que un rango percentil local sea
razonablemente estable. Los percentiles se recortan a 1–99: con unos cientos de
casos no se puede distinguir honestamente el percentil 99 del 99.9.

Las sesiones marcadas **no confiables no entran a la muestra normativa**:
ensanchan la distribución y empujan a todos los candidatos honestos hacia el
centro.

> Después de un piloto conviene reiniciar las normas desde *Análisis del
> instrumento*: los puntajes recogidos mientras el banco todavía cambiaba
> describen otro instrumento.

---

## 5 bis. Escalas de riesgo: violencia y consumo de sustancias

Se agregaron porque en entrevistas y referencias aparecían con frecuencia
riesgos importantes en estos dos temas que la prueba no detectaba: integridad
mide apego a normas, no agresividad ni consumo.

### Qué miden

Están construidas como las escalas de las pruebas de integridad "abiertas", que
son las que tienen la mejor evidencia en selección para conductas
contraproducentes. Cada escala combina cuatro tipos de reactivo (en consumo se
suma además la normalización: "casi todas las personas que conozco toman o
consumen algo para aguantar la semana", porque quien consume tiende a creer que
todos lo hacen):

| Tipo | Ejemplo (violencia) | Ejemplo (consumo) |
|---|---|---|
| Justificación | "A veces un golpe es la única forma de que alguien entienda." | "Consumir alguna droga de vez en cuando no tiene nada de malo si no afecta a nadie." |
| Control / afrontamiento | "Cuando me enojo, me cuesta controlar lo que digo o hago." | "Después de un día pesado, necesito tomar algo para relajarme." |
| Protector (invertido) | "Cuando alguien me provoca, prefiero retirarme antes que discutir." | "Cuido no tomar de más cuando al día siguiente tengo que trabajar." |
| **Crítico** (conducta admitida) | "En los últimos dos años me he peleado a golpes con alguien." | "He llegado a trabajar bajo los efectos del alcohol o de alguna droga." |

La mitad de los reactivos son protectores por la misma razón que en los rasgos:
sin ellos la escala mide la tendencia a decir que sí, y no se puede verificar la
consistencia.

Los reactivos de consumo se quedan **dentro del contexto laboral** a propósito:
preguntan por conductas que afectan el trabajo (llegar bajo los efectos, faltar
por haber consumido) y por actitudes, **nunca por diagnósticos, tratamientos ni
historial médico**.

### Cómo se califican

- Puntaje 0–100, **más alto = más riesgo** (los protectores se invierten).
- **Nivel por cortes absolutos**: moderado desde 30, alto desde 50. En esta
  escala 25 equivale a "En desacuerdo" en promedio y 50 a "Neutral"; quedar en
  neutral frente a afirmaciones como estas ya es una señal clara. Los cortes son
  absolutos, no percentiles: estar de acuerdo con "un golpe es la única forma"
  significa lo mismo sin importar cómo contestaron los demás, y un percentil
  llamaría "bajo" a alguien solo porque ese mes los candidatos fueron peores. El
  percentil se muestra como contexto cuando hay muestra, pero no define el nivel.
- **El nivel depende solo del puntaje.** Los reactivos críticos cuentan en el
  puntaje como cualquier otro, pero no suben el nivel por sí solos: el nivel se
  tiene que poder verificar leyendo el puntaje y los cortes configurados.
- **Conductas admitidas**: si el candidato responde 4 o 5 a un reactivo crítico,
  el reporte lo lista textualmente en un recuadro aparte ("no cambian el nivel
  de riesgo: confírmalas en la entrevista") y muestra la guía de entrevista
  aunque el nivel sea bajo. Si la escala quedó sin datos suficientes, se
  reporta "Sin datos" y las conductas admitidas se siguen mostrando.
- La barra muestra el puntaje con las marcas de los dos cortes.
- **El nivel se resuelve con los cortes vigentes**, no con los del día en que
  se envió la prueba. El resultado guarda el puntaje y las conductas admitidas;
  el nivel es su interpretación. (Esto también corrige la lectura de los
  resultados enviados mientras las conductas admitidas todavía subían el
  nivel.) Así, cambiar "Riesgo moderado/alto desde" en
  la configuración se refleja de inmediato en el panel, en el distintivo de la
  lista y en el filtro "Con riesgo" (`src/lib/psychometricRisk.ts`, con la misma
  regla que `riskLevelFor` en el servidor; un test verifica que coincidan).

### Cómo se leen

- Van en el resultado **antes que el perfil**, justo después del veredicto de
  confiabilidad, y en la lista de sesiones aparece un distintivo "Riesgo alto /
  moderado" con filtro "Con riesgo".
- Si el resultado es **no confiable**, el nivel no se interpreta; las conductas
  admitidas sí se exploran en entrevista.
- Si hay **deseabilidad social alta** y el riesgo sale bajo, el reporte lo
  advierte: es la escala más fácil de "maquillar". No se corrige el puntaje (ver
  §6), se verifica con referencias.
- Con riesgo moderado o alto, el reporte sugiere **preguntas de entrevista
  conductual** y qué preguntar a las referencias.

### Lo que no es y cómo se debe usar

- **No es un diagnóstico clínico ni sustituye un examen toxicológico.** Mide
  actitudes y conductas que el propio candidato reporta. Nadie debe ser
  etiquetado como "adicto" o "violento" a partir de este resultado.
- **Apoyo a la decisión, no filtro automático.** Un riesgo alto obliga a
  verificar (entrevista, referencias y, cuando el puesto lo justifique y se
  cuente con consentimiento, examen toxicológico), no a rechazar sin más. Esto
  además es lo que mantiene la decisión defendible frente a la normativa de no
  discriminación.
- **Datos personales sensibles.** Lo relativo al consumo de sustancias puede
  considerarse dato de salud bajo la LFPDPPP, que exige aviso de privacidad y
  consentimiento expreso. La pantalla inicial avisa al candidato que hay
  preguntas sobre manejo del enojo y consumo, y el consentimiento las menciona
  explícitamente. **Conviene que Legal revise ese texto y el aviso de
  privacidad antes de usar la prueba en producción.**
- **Acceso.** Hoy el resultado lo ve cualquiera con el permiso de sesiones
  psicométricas. Si se quiere restringir el detalle de riesgo a un grupo más
  pequeño, hay que moverlo a un documento aparte con sus propias reglas de
  Firestore: ocultarlo solo en la interfaz no es un control de acceso.

### Cómo activarlo en un banco existente

El banco vive en Firestore. En *Banco de preguntas*, **"Completar con el banco
base"** agrega los 28 reactivos de riesgo sin tocar los existentes. La
configuración guardada recibe sola los valores por omisión nuevos (10 por escala,
cortes 30/50). Mientras el banco no tenga reactivos de riesgo, la prueba sigue
funcionando y el resultado dice "No evaluado".

Los resultados anteriores (versión 2) no tienen escalas de riesgo y se muestran
como "aplicada antes de incluir las escalas de riesgo"; no se recalifican.

---

## 6. Confiabilidad de la respuesta

`validity.ts` calcula varios indicadores independientes y los combina en un
veredicto explícito por puntos:

| Indicador | Qué detecta | Puntos |
|---|---|---|
| Control de atención fallido | No está leyendo | 3 por control |
| Patrón repetitivo (racha larga) | Clic en la misma opción | 3 |
| Baja variación (DE de sus respuestas) | Idem, medido de otra forma | 3 |
| Respuestas muy rápidas | Contestó más rápido de lo que se lee | 3 |
| Inconsistencia normal/invertida | Ignora la dirección del enunciado (rasgos y escalas de riesgo) | 3 |
| Escala de infrecuencia alta | Responde al azar | 3 |
| Inconsistencia par-impar | Las dos mitades no coinciden | 2 |
| Deseabilidad social alta | Intento de dar buena impresión | 2 |
| Respuestas incompletas | < 90 % contestado | 2 (6 si < 60 %) |

**≥ 6 puntos → no confiable · ≥ 2 → revisar · resto → confiable.**

El esquema de puntos hace la regla auditable y permite que dos señales leves
sumen algo que vale la pena revisar, sin que un indicador ruidoso por sí solo
invalide una sesión.

Dos decisiones de fondo:

- **El tiempo mínimo por reactivo se calcula con el propio texto** (base + tiempo
  por palabra, incluyendo las opciones en los escenarios). Un umbral fijo
  castigaría los reactivos cortos y perdonaría los largos.
- **La deseabilidad social nunca "corrige" los puntajes.** La evidencia es
  consistente en que esas correcciones no recuperan el puntaje honesto y pueden
  empeorar la validez. Se reporta como alerta para verificar en entrevista y
  referencias, y nada más.

### Advertencia al candidato

La pantalla de instrucciones dice explícitamente que hay reactivos de control y
que se mide la consistencia. Advertir reduce de forma medible la inflación de
respuestas en procesos de selección, y es más justo que verificar en silencio.

---

## 7. Robustez de la aplicación

- **El avance se guarda solo** (`savePsychometricProgress`). El cronómetro corre
  del lado del servidor y no se puede pausar; antes, una conexión caída o un
  celular bloqueado costaba toda la prueba. Al volver a entrar con el mismo
  enlace se retoma en la primera pregunta sin responder, con el tiempo que reste.
- **El reloj del dispositivo se corrige** contra la hora del servidor. Un celular
  adelantado veía el tiempo agotado y enviaba una prueba vacía.
- **El envío es transaccional e idempotente**: el cambio de estado, la
  calificación y la actualización de normas se confirman juntos. Un doble envío o
  un reintento no puede calificar dos veces ni descuadrar los contadores.
- **El cliente nunca recibe la clave**: escala, dirección del reactivo y puntaje
  de cada opción no salen del servidor.
- **El límite de tiempo vencido tiene un margen de 60 s** para no fallar a quien
  envió a tiempo con red lenta.

---

## 8. Análisis del instrumento

La pestaña *Análisis del instrumento* (solo para quien administra el banco)
reporta:

- **Alfa de Cronbach por escala.** Como cada sesión aplica una muestra distinta
  de ítems, la matriz es incompleta y el alfa se estima por pares de ítems
  (varianzas por ítem, covarianzas por par). Se reporta junto con el **n mínimo
  por par**, para no leer como estable un número sostenido por 12 casos. En el
  SJT el alfa se muestra solo como referencia: en una prueba multidimensional
  subestima la calidad.
- **Correlación ítem-total corregida** por reactivo (el ítem se excluye del total
  con el que se compara). Un ítem con correlación baja ocupa tiempo de prueba sin
  aportar información: hay que reformularlo o desactivarlo.
- **Efecto techo/piso** y **poca variabilidad** por reactivo.
- **Distribución de opciones por escenario**: si casi todos eligen la mejor
  opción, el escenario no discrimina; si casi nadie la elige, hay que revisar la
  clave o la redacción.
- **Tasa de acierto de los controles de atención**: si falla más del 30 %, el
  problema suele ser la redacción de la instrucción.
- **Conductas de riesgo admitidas**: qué porcentaje de candidatos respondió "De
  acuerdo" o más a cada reactivo crítico. Dimensiona el problema en la población
  de candidatos. En las escalas de riesgo no se reportan efecto piso ni poca
  variabilidad: que casi todos estén en desacuerdo es lo esperado; lo que
  importa es que los ítems discriminen.
- **Estado de la muestra normativa** por escala.
- **Revisión de configuración**: escalas sin ítems suficientes, escalas sin
  reactivos invertidos, cortes invertidos, pesos en cero.

Las sesiones no confiables se excluyen de todos los cálculos: incluirlas atenúa
las correlaciones y hace parecer malos a ítems que funcionan bien.

---

## 9. Límites que conviene tener presentes

- Es un instrumento **de desarrollo interno sin validación de criterio**: nadie
  ha correlacionado todavía los puntajes con el desempeño real de los promotores
  contratados. Sirve como **apoyo estructurado** a la decisión, junto con
  entrevista y referencias; no como filtro determinante.
- El paso natural siguiente es un **estudio de validez de criterio**: guardar los
  puntajes y compararlos, a los 3–6 meses, contra colocación, mora de cartera y
  rotación. Con eso se pueden ajustar los pesos con datos propios en lugar de por
  criterio, y justificar cualquier uso del puntaje como filtro.
- Los reactivos evitan deliberadamente cualquier característica protegida (salud,
  religión, situación familiar, opiniones políticas). La única excepción cercana
  son los de consumo de sustancias, acotados a conductas que afectan el trabajo
  (ver §5 bis). Al agregar reactivos nuevos hay que mantener ese criterio: nada
  de diagnósticos, tratamientos ni historial médico.
- Los cortes de riesgo (30/50) son **iniciales**. El estudio de validez de
  criterio debería incluir incidentes de violencia, ausentismo y bajas por
  consumo entre los contratados, para recalibrarlos con datos propios.
- Las bandas son relativas a **la muestra de candidatos de Aviva**, no a una
  norma nacional. Eso es lo correcto para comparar candidatos entre sí, y hay que
  leerlas así.

---

## 10. Dónde está cada cosa

| Archivo | Responsabilidad |
|---|---|
| `types.ts` | Modelo de datos canónico (`src/types/index.ts` lo refleja) |
| `defaultBank.ts` | Banco base curado (incluye las escalas de riesgo) y configuración por omisión |
| `sampling.ts` | Armado de la sesión y auditoría estática del banco |
| `scoring.ts` | Validación de respuestas, puntajes, compuesto, nivel de riesgo |
| `norms.ts` | Percentiles, bandas y muestra normativa |
| `validity.ts` | Indicadores de confiabilidad y veredicto |
| `itemAnalysis.ts` | Alfa, discriminación de ítems, distribución SJT |
| `normalize.ts` | Compatibilidad con documentos de versiones anteriores |
| `sessionData.ts` | Vencimientos, preguntas congeladas, validación de payload |
| `getTest.ts` / `saveProgress.ts` / `submitTest.ts` | Endpoints públicos |
| `adminTools.ts` | Callables de administración (seed, análisis, reinicio de normas) |
| `src/components/psychometric/RiskPanel.tsx` | Panel de riesgos del resultado y guía de entrevista |
| `tests/` | Suite de vitest sobre toda la lógica anterior (`npm test`); `riskScales.test.ts` cubre las escalas de riesgo |
