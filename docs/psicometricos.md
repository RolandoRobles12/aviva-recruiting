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
| Deseabilidad social | **validez** | Detectar a quien contesta "lo que queremos oír" |
| Infrecuencia | **validez** | Detectar respuestas al azar o sin leer |
| Controles de atención | **validez** | Detectar a quien no está leyendo los reactivos |

Las tres últimas **nunca entran al perfil ni al score compuesto**. Solo alimentan
el veredicto de confiabilidad.

Integridad se agregó porque es el rasgo de autorreporte con la relación más clara
con conductas contraproducentes, y es el más pertinente cuando el puesto maneja
dinero y datos de crédito de terceros.

---

## 2. Tamaño del banco y de la prueba

El banco base trae **14 ítems por rasgo** (mitad invertidos), 6 de deseabilidad
social, 5 de infrecuencia, 3 controles de atención y 14 escenarios SJT.

Cada sesión aplica por configuración 8 ítems por rasgo, 8 escenarios, 4 + 3
ítems de validez y 2 controles: **57 reactivos**, que la mayoría termina en menos
de 20 minutos (el límite está en 35).

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

1. Por rasgo, muestrea balanceando ítems normales e invertidos.
2. Muestrea por separado las escalas de validez y los controles de atención, de
   modo que **acortar la prueba nunca quita la capacidad de detectar respuestas
   descuidadas**.
3. Intercala los ítems para que dos preguntas consecutivas rara vez sean del
   mismo rasgo.
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

## 6. Confiabilidad de la respuesta

`validity.ts` calcula varios indicadores independientes y los combina en un
veredicto explícito por puntos:

| Indicador | Qué detecta | Puntos |
|---|---|---|
| Control de atención fallido | No está leyendo | 3 por control |
| Patrón repetitivo (racha larga) | Clic en la misma opción | 3 |
| Baja variación (DE de sus respuestas) | Idem, medido de otra forma | 3 |
| Respuestas muy rápidas | Contestó más rápido de lo que se lee | 3 |
| Inconsistencia normal/invertida | Ignora la dirección del enunciado | 3 |
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
  religión, situación familiar, opiniones políticas). Al agregar reactivos nuevos
  hay que mantener ese criterio.
- Las bandas son relativas a **la muestra de candidatos de Aviva**, no a una
  norma nacional. Eso es lo correcto para comparar candidatos entre sí, y hay que
  leerlas así.

---

## 10. Dónde está cada cosa

| Archivo | Responsabilidad |
|---|---|
| `types.ts` | Modelo de datos canónico (`src/types/index.ts` lo refleja) |
| `defaultBank.ts` | Banco base curado y configuración por omisión |
| `sampling.ts` | Armado de la sesión y auditoría estática del banco |
| `scoring.ts` | Validación de respuestas, puntajes, compuesto |
| `norms.ts` | Percentiles, bandas y muestra normativa |
| `validity.ts` | Indicadores de confiabilidad y veredicto |
| `itemAnalysis.ts` | Alfa, discriminación de ítems, distribución SJT |
| `normalize.ts` | Compatibilidad con documentos de versiones anteriores |
| `sessionData.ts` | Vencimientos, preguntas congeladas, validación de payload |
| `getTest.ts` / `saveProgress.ts` / `submitTest.ts` | Endpoints públicos |
| `adminTools.ts` | Callables de administración (seed, análisis, reinicio de normas) |
| `tests/` | Suite de vitest sobre toda la lógica anterior (`npm test`) |
