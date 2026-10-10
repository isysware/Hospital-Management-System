/**
 * Automatically generates the next sequential unique code for a given entity type.
 * Extracts the highest sequence number from existing codes and increments by 1.
 * Guarantees a unique candidate code that doesn't collide with existing codes.
 */
export function generateNextCode(
  existingCodes: (string | undefined | null)[],
  prefix: string,
  padLength: number = 4
): string {
  const cleanPrefix = prefix.trim().toUpperCase();
  const prefixRegex = new RegExp(`^${cleanPrefix}[-_]?(\\d+)$`, 'i');
  const generalNumRegex = /(\d+)$/;

  const existingUpperSet = new Set(
    existingCodes
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((c) => c.trim().toUpperCase())
  );

  let maxNum = 0;

  for (const code of existingUpperSet) {
    // 1. Try strict prefix match (e.g. SRV-0004 or SRV0004)
    const matchPrefix = code.match(prefixRegex);
    if (matchPrefix) {
      const num = parseInt(matchPrefix[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
      continue;
    }

    // 2. Try prefix with subparts (e.g. SHF-MOR-01, DEP-CLIN-02)
    if (code.startsWith(cleanPrefix)) {
      const matchGeneral = code.match(generalNumRegex);
      if (matchGeneral) {
        const num = parseInt(matchGeneral[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  // If no numbered codes found with this prefix, base start sequence on existing count
  if (maxNum === 0) {
    maxNum = existingUpperSet.size;
  }

  let candidateNum = maxNum + 1;
  let candidateCode = `${cleanPrefix}-${String(candidateNum).padStart(padLength, '0')}`;

  while (existingUpperSet.has(candidateCode)) {
    candidateNum++;
    candidateCode = `${cleanPrefix}-${String(candidateNum).padStart(padLength, '0')}`;
  }

  return candidateCode;
}
