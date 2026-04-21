const ONES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const TENS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'cien', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function threeDigits(n: number): string {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const t = Math.floor(rest / 10);
  const o = rest % 10;

  let result = '';

  if (h > 0) {
    if (h === 1 && rest > 0) result = 'ciento';
    else result = HUNDREDS[h];
  }

  if (rest > 0) {
    if (result) result += ' ';
    if (rest < 20) {
      result += ONES[rest];
    } else if (o === 0) {
      result += TENS[t];
    } else if (t === 2) {
      result += `veinti${ONES[o]}`;
    } else {
      result += `${TENS[t]} y ${ONES[o]}`;
    }
  }

  return result;
}

function integerToSpanish(n: number): string {
  if (n === 0) return 'cero';
  if (n === 1) return 'un';

  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const remainder = n % 1_000;

  const parts: string[] = [];

  if (millions > 0) {
    parts.push(millions === 1 ? 'un millón' : `${threeDigits(millions)} millones`);
  }
  if (thousands > 0) {
    parts.push(thousands === 1 ? 'mil' : `${threeDigits(thousands)} mil`);
  }
  if (remainder > 0) {
    parts.push(threeDigits(remainder));
  }

  return parts.join(' ');
}

/**
 * Converts a salary string (e.g. "$18,000", "18000", "18000.50") to the
 * legal Spanish money format used in Mexican contracts:
 * "dieciocho mil pesos 00/100 moneda nacional"
 */
export function salaryToSpanishWords(salary: string): string {
  // Strip currency symbols, spaces, commas
  const clean = salary.replace(/[$,\s]/g, '');
  const num = parseFloat(clean);
  if (isNaN(num) || num <= 0) return '';

  const pesos = Math.floor(num);
  const centavos = Math.round((num - pesos) * 100);

  const words = integerToSpanish(pesos);
  const centStr = String(centavos).padStart(2, '0');

  return `${words} pesos ${centStr}/100 moneda nacional`;
}
