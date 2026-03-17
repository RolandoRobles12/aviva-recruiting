/**
 * Cross-validates extracted names across a candidate's validated documents.
 * Returns mismatched document labels if the name on a new document doesn't
 * match previously validated documents.
 */

/**
 * Normalize a Mexican name for fuzzy comparison:
 * - lowercase, trim, collapse whitespace
 * - strip accents (á→a, ñ→n, etc.)
 * - remove common filler words (de, del, la, los, las)
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z\s]/g, '')        // keep only letters + spaces
    .split(/\s+/)
    .filter((w) => !['de', 'del', 'la', 'las', 'los'].includes(w))
    .sort()
    .join(' ')
    .trim();
}

/**
 * Check if two names are "close enough" to be the same person.
 * Uses token-set similarity: all tokens from one name must appear in the other,
 * or vice-versa. This handles partial names (e.g. INE has middle name but CURP doesn't).
 */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return true; // can't compare if missing

  const tokensA = normalize(a).split(' ').filter(Boolean);
  const tokensB = normalize(b).split(' ').filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return true;

  // Check if shorter set is a subset of longer set
  const [shorter, longer] = tokensA.length <= tokensB.length
    ? [tokensA, tokensB]
    : [tokensB, tokensA];

  const matchCount = shorter.filter((t) => longer.includes(t)).length;

  // At least 2 tokens must match, or all tokens of the shorter name must match
  return shorter.length <= 2
    ? matchCount === shorter.length
    : matchCount >= Math.ceil(shorter.length * 0.75);
}

/**
 * Given all documents for a candidate, find the names extracted from
 * previously validated documents and compare against a new document's name.
 *
 * @returns Array of mismatch descriptions, empty if all match.
 */
export function crossValidateNames(
  newDocType: string,
  newDocLabel: string,
  newName: string,
  existingDocs: Record<string, {
    status: string;
    ocrResult?: { extractedData?: Record<string, string> };
  }>,
  docLabels: Record<string, string>,
): string[] {
  if (!newName) return [];

  const mismatches: string[] = [];

  for (const [docType, doc] of Object.entries(existingDocs)) {
    if (docType === newDocType) continue;
    if (doc.status !== 'valid') continue;

    const existingName = doc.ocrResult?.extractedData?.nombre_completo;
    if (!existingName) continue;

    if (!namesMatch(newName, existingName)) {
      const label = docLabels[docType] ?? docType;
      mismatches.push(
        `El nombre "${newName}" no coincide con el registrado en ${label} ("${existingName}")`
      );
    }
  }

  return mismatches;
}
