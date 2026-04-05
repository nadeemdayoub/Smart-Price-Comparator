import { normalizeProductName } from './productNormalization';
import { RawSupplierItem, ScoringResult } from './candidateScoring';

export interface AliasMemoryEntry {
  canonicalProductId: string;
  aliasText?: string;
  normalizedAlias?: string;
  supplierId?: string | null;
}

export interface RejectedMatchEntry {
  normalizedRawName: string;
  candidateProductId: string;
  supplierId?: string | null;
}

export interface AliasMatchResult {
  found: boolean;
  canonicalProductId?: string;
  reason?: string;
  supplierScoped?: boolean;
}

/**
 * Tries to find an exact alias match for a raw item.
 * Prefers supplier-specific aliases over global ones.
 * 
 * @param rawItem The raw item from the supplier.
 * @param aliases List of alias memory entries.
 * @param supplierId Optional supplier ID to scope the search.
 * @returns A structured result indicating if an alias was found.
 */
export function findAliasMatch(
  rawItem: RawSupplierItem,
  aliases: AliasMemoryEntry[],
  supplierId?: string | null
): AliasMatchResult {
  const normalizedRawName = normalizeProductName(rawItem.rawName);
  
  if (!normalizedRawName) {
    return { found: false };
  }

  // Filter aliases that match the normalized name exactly
  // If normalizedAlias is missing, we normalize aliasText on the fly for comparison
  const matchingAliases = aliases.filter(a => {
    const targetNormalized = a.normalizedAlias || (a.aliasText ? normalizeProductName(a.aliasText) : null);
    return targetNormalized === normalizedRawName;
  });

  if (matchingAliases.length === 0) {
    return { found: false };
  }

  // 1. Try to find a supplier-specific alias first
  if (supplierId) {
    const supplierSpecific = matchingAliases.find(a => a.supplierId === supplierId);
    if (supplierSpecific) {
      return {
        found: true,
        canonicalProductId: supplierSpecific.canonicalProductId,
        reason: `Exact alias match (supplier-specific: ${supplierId})`,
        supplierScoped: true
      };
    }
  }

  // 2. Fallback to a global alias (where supplierId is null or undefined)
  const globalAlias = matchingAliases.find(a => !a.supplierId);
  if (globalAlias) {
    return {
      found: true,
      canonicalProductId: globalAlias.canonicalProductId,
      reason: 'Exact alias match (global)',
      supplierScoped: false
    };
  }

  return { found: false };
}

/**
 * Checks if a candidate product has been explicitly rejected for a raw item.
 * 
 * @param rawItem The raw item from the supplier.
 * @param candidateProductId The ID of the candidate product to check.
 * @param rejectedMatches List of rejected match memory entries.
 * @param supplierId Optional supplier ID to scope the check.
 * @returns True if the match is rejected by memory.
 */
export function isRejectedMatch(
  rawItem: RawSupplierItem,
  candidateProductId: string,
  rejectedMatches: RejectedMatchEntry[],
  supplierId?: string | null
): boolean {
  const normalizedRawName = normalizeProductName(rawItem.rawName);
  
  if (!normalizedRawName) return false;

  // 1. First check supplier-specific rejected memory if supplierId is provided
  if (supplierId) {
    const hasSupplierSpecific = rejectedMatches.some(r => 
      r.supplierId === supplierId &&
      r.normalizedRawName === normalizedRawName &&
      r.candidateProductId === candidateProductId
    );
    if (hasSupplierSpecific) return true;
  }

  // 2. Then check global rejected memory (where supplierId is null or undefined)
  const hasGlobal = rejectedMatches.some(r => 
    !r.supplierId &&
    r.normalizedRawName === normalizedRawName &&
    r.candidateProductId === candidateProductId
  );

  return hasGlobal;
}

/**
 * Marks candidates as blocked if they exist in the rejected match memory.
 * This ensures that previously rejected matches are not suggested or auto-matched.
 * 
 * @param rawItem The raw item from the supplier.
 * @param scoredCandidates List of already scored candidates.
 * @param rejectedMatches List of rejected match memory entries.
 * @param supplierId Optional supplier ID to scope the filtering.
 * @returns A new list of scored candidates with rejections applied, re-sorted.
 */
export function filterRejectedCandidates(
  rawItem: RawSupplierItem,
  scoredCandidates: ScoringResult[],
  rejectedMatches: RejectedMatchEntry[],
  supplierId?: string | null
): ScoringResult[] {
  const results = scoredCandidates.map(candidate => {
    const rejected = isRejectedMatch(
      rawItem, 
      candidate.candidateProductId, 
      rejectedMatches, 
      supplierId
    );

    if (rejected) {
      return {
        ...candidate,
        blocked: true,
        score: 0,
        reasons: [...candidate.reasons, 'Previously rejected match (memory)'],
        warnings: [...candidate.warnings, 'This candidate was explicitly rejected in the past'],
        matchType: 'blocked' as const
      };
    }

    return candidate;
  });

  // Re-sort so blocked candidates always go to the bottom
  return results.sort((a, b) => {
    if (a.blocked && !b.blocked) return 1;
    if (!a.blocked && b.blocked) return -1;
    // If both are blocked or both are not, maintain relative order or sort by score
    return b.score - a.score;
  });
}
