import Anthropic from '@anthropic-ai/sdk';
import { defineString } from 'firebase-functions/params';

const ANTHROPIC_API_KEY = defineString('ANTHROPIC_API_KEY');

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  }
  return client;
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
3. ¿Se puede leer el nombre del titular?
4. ¿La imagen es suficientemente clara para considerarse válida?

Datos a extraer: curp, nombre_completo, clave_elector (si es visible).`,

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

Datos a extraer: nombre_completo, curp (si visible), fecha_nacimiento, lugar_nacimiento.`,

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

  comprobante_domicilio: `Analiza esta imagen y determina si es un comprobante de domicilio válido de México.

Documentos válidos: recibos de luz (CFE), agua, gas (Naturgy), teléfono/internet (Telmex, Telcel, Izzi, Totalplay, Megacable, AT&T, Movistar, Axtel), estados de cuenta bancarios, recibos de predial.

Validaciones requeridas:
1. ¿Es un recibo de servicios, estado de cuenta bancario, o documento que muestre un domicilio?
2. ¿Se puede leer una dirección (calle, colonia, código postal, ciudad/estado)?
3. ¿El documento parece ser reciente (no importa la fecha exacta, solo que sea un formato actual)?

Datos a extraer: direccion (lo más completa posible), empresa_emisora.`,

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

REGLAS IMPORTANTES:
- Sé ESTRICTO: si el documento no es lo que se pide, rechaza.
- Sé TOLERANTE con calidad de imagen: fotos de celular, ligeramente borrosas o mal encuadradas son aceptables si puedes identificar el tipo de documento y leer los datos clave.
- Si la imagen es demasiado borrosa o cortada para leer datos esenciales, rechaza.
- Si el documento es de otro país o no corresponde al tipo solicitado, rechaza.
- Extrae datos SOLO si puedes leerlos con confianza.

Responde SIEMPRE en JSON con esta estructura exacta:
{
  "valid": true/false,
  "document_type_detected": "qué tipo de documento detectas (ej: INE, CURP, RFC, recibo CFE, título universitario, etc.)",
  "errors": ["lista de errores si hay, en español, máximo 2-3 errores concisos"],
  "extracted_data": {"clave": "valor"},
  "confidence": 0.0 a 1.0
}

No incluyas texto fuera del JSON. Solo responde con el JSON.`;

/**
 * Validate a document image using Claude Haiku 4.5 vision.
 *
 * @param imageBuffer - The raw file bytes (JPEG, PNG, or first page of PDF rendered as image)
 * @param mediaType - MIME type of the image
 * @param documentType - Expected document type (ine, curp, nss, acta_nacimiento, etc.)
 */
export async function validateDocument(
  imageBuffer: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  documentType: string,
): Promise<ValidationResult> {
  const anthropic = getClient();
  const prompt = DOCUMENT_PROMPTS[documentType];
  if (!prompt) {
    return {
      valid: false,
      documentTypeDetected: 'unknown',
      errors: [`Tipo de documento no soportado: ${documentType}`],
      extractedData: {},
      confidence: 0,
    };
  }

  const base64Image = imageBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image,
            },
          },
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
      extractedData: parsed.extracted_data ?? {},
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
