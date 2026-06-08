import Anthropic from '@anthropic-ai/sdk';
import { defineString } from 'firebase-functions/params';

const ANTHROPIC_API_KEY = defineString('ANTHROPIC_API_KEY');

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 0 });
  }
  return client;
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  const msg = (err as Error)?.message ?? '';
  return msg.includes('rate_limit') || msg.includes('429') || msg.includes('tokens per minute') || msg.includes('overloaded');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callClaudeWithRetry(
  anthropic: Anthropic,
  params: Parameters<Anthropic['messages']['create']>[0],
  maxAttempts = 3,
): Promise<Anthropic.Message> {
  const delays = [15_000, 30_000]; // ms between retries
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await anthropic.messages.create(params) as Anthropic.Message;
    } catch (err) {
      if (isRateLimitError(err) && attempt < maxAttempts - 1) {
        const wait = delays[attempt] ?? 30_000;
        console.warn(`[ocr] rate limit hit, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  // Should never reach here
  throw new Error('OCR_RATE_LIMIT: No se pudo procesar el documento por sobrecarga temporal. Por favor vuelve a subirlo.');
}

export interface ValidationResult {
  valid: boolean;
  documentTypeDetected: string;
  errors: string[];
  extractedData: Record<string, string>;
  confidence: number;
}

const DOCUMENT_PROMPTS: Record<string, string> = {
  ine: `Analiza esta imagen y determina si es una credencial INE/IFE (Instituto Nacional Electoral) de México.

Validaciones requeridas:
1. ¿Es una credencial INE o IFE oficial? Busca el logo, escudo nacional, o texto "Instituto Nacional Electoral" / "Instituto Federal Electoral".
2. ¿Se puede leer un CURP (18 caracteres, formato: 4 letras + 6 dígitos + H/M + 5 letras + 2 alfanuméricos)?
3. ¿Se puede leer el nombre del titular? Es obligatorio — si no se puede leer el nombre, el documento no es válido.
4. ¿La imagen es suficientemente clara para considerarse válida?

Datos a extraer: curp, nombre_completo, clave_elector (si es visible), domicilio (dirección completa que aparece en el ANVERSO de la credencial en el campo "DOMICILIO", incluyendo calle, número, colonia, municipio y estado — por ejemplo "C 29 B POR 86 715, FRACC VIVA CAUCEL II, MÉRIDA, YUC."; IGNORA completamente el reverso y los códigos MRZ/OCR-B como "IDMEX", "MEX<", "<<" — esos son códigos de máquina que NO representan el estado de residencia), sexo (la letra que aparece: H para hombre, M para mujer), nacionalidad (texto que aparece, normalmente "MEXICANA").`,

  curp: `Analiza esta imagen y determina si es una constancia de CURP oficial de México.

Validaciones requeridas:
1. ¿Es una constancia de CURP oficial? Busca el logo de RENAPO, texto "Clave Única de Registro de Población", o "CURP".
2. ¿Se puede leer la CURP completa (18 caracteres)?
3. ¿Se puede leer el nombre del titular?

Datos a extraer: curp, nombre_completo.`,

  nss: `Analiza esta imagen y determina si es un documento que contiene el Número de Seguridad Social (NSS) del IMSS de México.

Documentos válidos: constancia de NSS del IMSS, hoja rosa del IMSS, tarjeta de afiliación, documento IMSS con NSS visible, captura del portal IMSS digital.

Validaciones requeridas:
1. ¿Es un documento oficial del IMSS o contiene un NSS claramente visible?
2. ¿Se puede leer el NSS completo (11 dígitos)?
3. ¿Se puede leer el nombre del titular?

Datos a extraer: nss, nombre_completo.`,

  acta_nacimiento: `Analiza esta imagen y determina si es un Acta de Nacimiento oficial de México.

Validaciones requeridas:
1. ¿Es un acta de nacimiento oficial? Busca sellos del Registro Civil, escudo nacional, texto "Acta de Nacimiento", CURP impreso, o firma del oficial del Registro Civil.
2. ¿Se puede leer el nombre completo del titular?
3. ¿El documento parece ser una copia certificada o digital oficial (no una copia simple)?

Datos a extraer: nombre_completo, curp (si visible), fecha_nacimiento, lugar_nacimiento, sexo (Masculino o Femenino), nacionalidad (normalmente "Mexicana").`,

  caratula_bancaria: `Analiza esta imagen y determina si es una carátula bancaria o estado de cuenta bancario de México.

Documentos válidos: carátula de cuenta bancaria, estado de cuenta bancario, constancia de cuenta CLABE, captura de app bancaria que muestre datos de la cuenta.

Validaciones requeridas:
1. ¿Es un documento bancario que muestra datos de una cuenta? Busca logo de banco (BBVA, Banorte, Santander, HSBC, Scotiabank, Banamex/Citi, Banco Azteca, BanCoppel, etc.), número de cuenta o CLABE.
2. ¿Se puede leer la CLABE interbancaria (18 dígitos) o número de cuenta?
3. ¿Se puede leer el nombre del titular de la cuenta?

Datos a extraer: nombre_completo, clabe, numero_cuenta, banco.`,

  certificado_estudios: `Analiza esta imagen y determina si es un comprobante de estudios válido de México.

Documentos válidos: títulos profesionales, certificados de estudios, constancias de estudios, cédulas profesionales, diplomas, certificados de bachillerato/preparatoria, constancias CENEVAL, documentos de la SEP, CONALEP, universidades, tecnológicos, etc.

Validaciones requeridas:
1. ¿Es un documento académico oficial? Busca logos de instituciones educativas, SEP, CENEVAL, o sellos oficiales.
2. ¿Se puede leer el nombre del titular?
3. ¿Se puede identificar el nivel de estudios o carrera?

Datos a extraer: nombre_completo, institucion, nivel_estudios, carrera (si aplica).`,

  constancia_fiscal: `Analiza esta imagen y determina si es una Constancia de Situación Fiscal emitida por el SAT de México.

Validaciones requeridas:
1. ¿Es un documento oficial del SAT? Busca el logo del SAT, texto "Servicio de Administración Tributaria", "Constancia de Situación Fiscal", o "Cédula de Identificación Fiscal".
2. ¿Se puede leer el RFC con homoclave (12 o 13 caracteres alfanuméricos)?
3. ¿Se puede leer el nombre o razón social?
4. ¿Incluye el domicilio fiscal?

Datos a extraer: rfc, nombre_completo, domicilio_fiscal, regimen_fiscal.`,

  carta_recomendacion: `Analiza esta imagen y determina si es una carta de recomendación laboral o constancia laboral.

Documentos válidos: carta de recomendación, constancia laboral, carta de experiencia, referencia laboral.

Validaciones requeridas:
1. ¿Es una carta o constancia laboral? Busca membrete de empresa, firma, nombre de quien emite, o texto que indique referencia/recomendación.
2. ¿Se puede leer el nombre de la persona recomendada?
3. ¿Se puede identificar la empresa o persona que emite la carta?

Sé TOLERANTE: cartas personales con firma manuscrita, en papel simple, o sin membrete oficial son aceptables si contienen la información mínima.

Datos a extraer: nombre_recomendado, empresa_emisora, puesto (si visible).`,

  comprobante_domicilio: `Analiza esta imagen y determina si es un comprobante de domicilio válido de México con vigencia mínima de 3 meses.

Documentos válidos: recibos de luz (CFE), agua, gas (Naturgy), teléfono/internet (Telmex, Telcel, Izzi, Totalplay, Megacable, AT&T, Movistar, Axtel), estados de cuenta bancarios, recibos de predial.

La fecha de hoy es: {{TODAY_DATE}}.
Fecha mínima aceptable del documento: {{THREE_MONTHS_AGO}} (documentos con fecha anterior a esta están vencidos).

{{#INE_ADDRESS}}
Dirección registrada en INE del candidato: "{{INE_ADDRESS}}"
{{/INE_ADDRESS}}

Validaciones requeridas:
1. ¿Es un recibo de servicios, estado de cuenta bancario, o documento que muestre un domicilio?
2. ¿Se puede identificar una ubicación del CLIENTE (al menos ciudad/municipio y estado)? IMPORTANTE: extrae la información de ubicación del titular/cliente, NO la dirección corporativa de la empresa emisora. Los recibos de CFE usan un formato comprimido (ej: "29B 715 88 86 VIVA II C CP.9 FRACC VIVA CAUCEL II CAUCEL YUC") que puede parecer ilegible pero es válido — acéptalo aunque no tenga formato tradicional de calle/número/colonia. Solo rechaza por este punto si NO aparece ninguna información de ubicación del cliente en el documento.
3. Vigencia: Lee la fecha del documento. IMPORTANTE: si el documento muestra un PERIODO DE FACTURACIÓN (ej: "30 ENE 26 - 31 MAR 26"), usa la fecha FINAL del periodo, no la inicial. Compara esa fecha directamente contra la fecha mínima aceptable ({{THREE_MONTHS_AGO}}): si la fecha del documento es MAYOR O IGUAL a {{THREE_MONTHS_AGO}}, el documento está vigente; si es ANTERIOR a {{THREE_MONTHS_AGO}}, está vencido. Si no se puede leer ninguna fecha, rechaza el documento.
{{#INE_ADDRESS}}
4. Comparación de estado con INE: Extrae el estado de la república que aparece en el comprobante y compáralo con el estado que aparece en el INE ("{{INE_ADDRESS}}"). Solo verifica que sea el mismo estado (entidad federativa) — no importa si el municipio, colonia o código postal son diferentes. Si el estado es diferente, rechaza indicando los dos estados encontrados.
{{/INE_ADDRESS}}

Datos a extraer: direccion (dirección completa del CLIENTE, lo más completa posible), cp (código postal de 5 dígitos del cliente, solo los números), empresa_emisora, fecha_documento (fecha FINAL del periodo de facturación o fecha de emisión, en formato YYYY-MM-DD).`,

  foto_profesional: `Analiza esta imagen y determina si es una foto profesional o tipo credencial de una persona.

Validaciones requeridas:
1. ¿La imagen muestra el rostro de una persona de forma clara?
2. ¿La persona aparece presentable (no es una foto casual como selfie en espejo, foto de fiesta, etc.)?
3. ¿La imagen tiene calidad suficiente para uso profesional?

Sé TOLERANTE: no requiere fondo blanco ni estudio profesional. Fotos de celular con buena iluminación, fondo neutro, y persona presentable son aceptables.

Datos a extraer: descripcion (breve descripción de la foto).`,

  aviso_retencion: `Analiza esta imagen y determina si es un Aviso de Retención del INFONAVIT de México.

Documentos válidos: aviso de retención, aviso de suspensión de retención, constancia de crédito INFONAVIT, estado de cuenta INFONAVIT.

Validaciones requeridas:
1. ¿Es un documento del INFONAVIT? Busca el logo del INFONAVIT, texto "Instituto del Fondo Nacional de la Vivienda para los Trabajadores", "Aviso de Retención", o "INFONAVIT".
2. ¿Se puede leer el NSS o número de crédito?
3. ¿Se puede identificar el nombre del trabajador?

Datos a extraer: nombre_completo, nss, numero_credito (si visible).`,

  estado_cuenta_fonacot: `Analiza esta imagen y determina si es un estado de cuenta o documento de crédito FONACOT de México.

Documentos válidos: estado de cuenta FONACOT, constancia de crédito FONACOT, contrato FONACOT, certificado de crédito.

Validaciones requeridas:
1. ¿Es un documento de FONACOT? Busca el logo de FONACOT, texto "Instituto del Fondo Nacional para el Consumo de los Trabajadores", "FONACOT", o datos del crédito.
2. ¿Se puede leer el número de crédito o de contrato?
3. ¿Se puede identificar el nombre del trabajador?

Datos a extraer: nombre_completo, numero_credito, saldo (si visible).`,
};

const SYSTEM_PROMPT = `Eres un validador de documentos mexicanos. Tu trabajo es analizar imágenes de documentos y determinar si son válidos.

PROCESO OBLIGATORIO — sigue estos dos pasos en orden:

PASO 1 — TRANSCRIPCIÓN LITERAL:
Lee y transcribe TODO el texto visible en el documento, exactamente como aparece impreso, sin corregir, inferir ni completar. Si un texto es ilegible, escribe "[ilegible]". No inventes ni supongas ningún valor.

PASO 2 — EXTRACCIÓN Y VALIDACIÓN:
Usando ÚNICAMENTE el texto que transcribiste en el Paso 1 (no la imagen directamente), extrae los campos requeridos y realiza las validaciones. Si un dato no aparece en la transcripción, déjalo vacío — nunca inventes valores.

REGLAS IMPORTANTES:
- Sé ESTRICTO: si el documento no es lo que se pide, rechaza.
- Sé TOLERANTE con calidad de imagen: fotos de celular, ligeramente borrosas o mal encuadradas son aceptables si puedes identificar el tipo de documento y leer los datos clave.
- Si la imagen es demasiado borrosa o cortada para leer datos esenciales, rechaza.
- Si el documento es de otro país o no corresponde al tipo solicitado, rechaza.
- Extrae datos SOLO si aparecen literalmente en tu transcripción del Paso 1.

Responde SIEMPRE en JSON con esta estructura exacta:
{
  "transcription": "todo el texto visible transcrito literalmente en el Paso 1",
  "valid": true/false,
  "document_type_detected": "qué tipo de documento detectas (ej: INE, CURP, RFC, recibo CFE, título universitario, etc.)",
  "errors": ["lista de errores si hay, en español, máximo 2-3 errores concisos"],
  "extracted_data": {"clave": "valor"},
  "confidence": 0.0 a 1.0
}

No incluyas texto fuera del JSON. Solo responde con el JSON.`;

// Regex patterns for critical fields — values that don't match are cleared rather than stored
const FIELD_PATTERNS: Record<string, RegExp> = {
  curp:  /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9]{2}$/,
  rfc:   /^[A-Z]{3,4}[0-9]{6}[A-Z0-9]{3}$/,
  nss:   /^[0-9]{11}$/,
  clabe: /^[0-9]{18}$/,
  cp:    /^[0-9]{5}$/,
};

/** Which critical fields each document type is expected to produce. */
export const CRITICAL_FIELDS_BY_DOC: Record<string, string[]> = {
  ine:                  ['curp'],
  curp:                 ['curp'],
  nss:                  ['nss'],
  caratula_bancaria:    ['clabe'],
  constancia_fiscal:    ['rfc'],
  comprobante_domicilio:['cp'],
};

// Focused single-field extraction prompts — used when the first pass misses a field
const FIELD_RETRY_PROMPTS: Record<string, string> = {
  curp:  `Busca la CURP en este documento mexicano. La CURP tiene exactamente 18 caracteres: 4 letras + 6 dígitos de fecha (AAMMDD) + H o M (sexo) + 5 letras + 2 caracteres alfanuméricos. Ejemplo: VERM850304HDFRRR04. Responde SOLO con los 18 caracteres de la CURP, sin espacios ni guiones ni texto adicional. Si no puedes leerla claramente, responde exactamente: NO_ENCONTRADO`,
  rfc:   `Busca el RFC en este documento del SAT de México. El RFC tiene 12 o 13 caracteres alfanuméricos (3-4 letras + 6 dígitos de fecha + 3 caracteres de homoclave). Responde SOLO con el RFC en mayúsculas, sin espacios ni texto adicional. Si no puedes leerlo, responde exactamente: NO_ENCONTRADO`,
  nss:   `Busca el Número de Seguridad Social (NSS) del IMSS en este documento. El NSS tiene exactamente 11 dígitos, sin letras. Responde SOLO con los 11 dígitos, sin espacios ni guiones. Si no puedes leerlo, responde exactamente: NO_ENCONTRADO`,
  clabe: `Busca la CLABE interbancaria en este documento bancario mexicano. La CLABE tiene exactamente 18 dígitos, sin letras. Responde SOLO con los 18 dígitos, sin espacios ni guiones. Si no puedes leerla, responde exactamente: NO_ENCONTRADO`,
  cp:    `Busca el código postal en este documento. El código postal tiene exactamente 5 dígitos. Responde SOLO con los 5 dígitos, sin texto adicional. Si no puedes leerlo, responde exactamente: NO_ENCONTRADO`,
};

/**
 * Strip or normalise extracted fields so only values that match their expected
 * format are persisted.  Unknown fields are passed through unchanged.
 */
function sanitizeExtractedData(
  documentType: string,
  data: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(data)) {
    if (!rawValue) { result[key] = ''; continue; }

    const value = String(rawValue).trim();

    // Only validate fields that have a known pattern
    const pattern = FIELD_PATTERNS[key];
    if (pattern) {
      // Normalise to uppercase, strip spaces/dashes before testing
      const normalised = value.toUpperCase().replace(/[\s\-]/g, '');
      if (pattern.test(normalised)) {
        result[key] = normalised;
      } else {
        // Log so we can see what Claude returned for debugging
        console.warn(`[ocr][${documentType}] field "${key}" failed format check — value discarded: "${value}"`);
        result[key] = '';
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Second-pass focused extraction for a single critical field that was missing
 * or format-invalid after the first OCR pass.
 *
 * Uses a hyper-focused prompt that asks only for the one value, which
 * significantly improves recall for structurally-correct but noisy documents.
 *
 * Returns the validated value if found, or '' if still unreadable.
 */
export async function retryExtractField(
  fieldKey: string,
  fileBuffer: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf',
): Promise<string> {
  const prompt = FIELD_RETRY_PROMPTS[fieldKey];
  if (!prompt) return '';

  const anthropic = getClient();
  const base64Data = fileBuffer.toString('base64');

  const fileContent: Anthropic.MessageParam['content'][number] =
    mediaType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64Data } }
      : { type: 'image' as const,    source: { type: 'base64' as const, media_type: mediaType, data: base64Data } };

  try {
    const response = await callClaudeWithRetry(anthropic, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{ role: 'user', content: [fileContent, { type: 'text', text: prompt }] }],
    });

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .toUpperCase()
      .replace(/[\s\-]/g, '');

    if (!raw || raw === 'NO_ENCONTRADO') return '';

    const pattern = FIELD_PATTERNS[fieldKey];
    return (pattern && pattern.test(raw)) ? raw : '';
  } catch (err) {
    console.warn(`[ocr] retryExtractField "${fieldKey}" failed:`, (err as Error).message);
    return '';
  }
}

/**
 * Validate a document image using Claude Haiku 4.5 vision.
 *
 * @param fileBuffer - The raw file bytes (JPEG, PNG, WebP, GIF, or PDF)
 * @param mediaType - MIME type of the file (images or application/pdf)
 * @param documentType - Expected document type (ine, curp, nss, acta_nacimiento, etc.)
 */
export async function validateDocument(
  fileBuffer: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf',
  documentType: string,
  extraContext?: Record<string, string>,
): Promise<ValidationResult> {
  const anthropic = getClient();
  let prompt = DOCUMENT_PROMPTS[documentType];

  // Inject today's date and precomputed 3-month cutoff (avoids asking the model to do date arithmetic)
  if (prompt) {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 3);
    const threeMonthsAgo = cutoff.toISOString().split('T')[0]; // YYYY-MM-DD
    prompt = prompt.replace(/\{\{TODAY_DATE\}\}/g, today);
    prompt = prompt.replace(/\{\{THREE_MONTHS_AGO\}\}/g, threeMonthsAgo);
  }

  // Inject extra context variables and handle {{#KEY}}...{{/KEY}} conditional blocks
  if (prompt && extraContext) {
    for (const [key, value] of Object.entries(extraContext)) {
      // Render conditional blocks: {{#KEY}}content{{/KEY}} → content if value present, '' if not
      prompt = prompt.replace(
        new RegExp(`\\{\\{#${key}\\}\\}([\\s\\S]*?)\\{\\{\\/${key}\\}\\}`, 'g'),
        value ? '$1' : '',
      );
      // Replace simple variables
      prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }

  // Remove any unresolved conditional blocks (when key was not provided)
  if (prompt) {
    prompt = prompt.replace(/\{\{#\w+\}\}[\s\S]*?\{\{\/\w+\}\}/g, '');
  }
  if (!prompt) {
    return {
      valid: false,
      documentTypeDetected: 'unknown',
      errors: [`Tipo de documento no soportado: ${documentType}`],
      extractedData: {},
      confidence: 0,
    };
  }

  const base64Data = fileBuffer.toString('base64');

  // Build the content source — PDFs use 'document' type, images use 'image' type
  const fileContent: Anthropic.MessageParam['content'][number] =
    mediaType === 'application/pdf'
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: base64Data,
          },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaType,
            data: base64Data,
          },
        };

  const response = await callClaudeWithRetry(anthropic, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          fileContent,
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  try {
    // Extract JSON from response (handle potential markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as {
      valid: boolean;
      document_type_detected: string;
      errors: string[];
      extracted_data: Record<string, string>;
      confidence: number;
    };

    return {
      valid: parsed.valid,
      documentTypeDetected: parsed.document_type_detected,
      errors: parsed.errors ?? [],
      extractedData: sanitizeExtractedData(documentType, parsed.extracted_data ?? {}),
      confidence: parsed.confidence ?? 0,
    };
  } catch {
    return {
      valid: false,
      documentTypeDetected: 'parse_error',
      errors: ['Error interno al procesar la validación. Por favor intenta de nuevo.'],
      extractedData: {},
      confidence: 0,
    };
  }
}
