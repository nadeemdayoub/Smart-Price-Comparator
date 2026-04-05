import { 
  RawSupplierItem, 
  CanonicalProductCandidate, 
  ScoringResult, 
  scoreCandidates 
} from './candidateScoring';
import { 
  AliasMemoryEntry, 
  RejectedMatchEntry, 
  findAliasMatch, 
  filterRejectedCandidates 
} from './matchMemory';

export interface PipelineResult {
  aliasHit?: {
    canonicalProductId: string;
    reason: string;
    supplierScoped?: boolean;
  };
  bestCandidate?: ScoringResult;
  candidates: ScoringResult[];
  requiresReview: boolean;
  blockedCount: number;
}

/**
 * Orchestrates the final matching pipeline for a raw supplier item.
 * 
 * @param rawItem The raw item from the supplier.
 * @param candidates List of potential canonical product candidates.
 * @param aliases List of historical alias memory entries.
 * @param rejectedMatches List of historical rejected match memory entries.
 * @param supplierId Optional supplier ID for scoping memory.
 * @returns The final matching result.
 */
export function runMatchPipeline(
  rawItem: RawSupplierItem,
  candidates: CanonicalProductCandidate[],
  aliases: AliasMemoryEntry[],
  rejectedMatches: RejectedMatchEntry[],
  supplierId?: string | null
): PipelineResult {
  // 1. Try Alias Match first
  const aliasMatch = findAliasMatch(rawItem, aliases, supplierId);
  
  if (aliasMatch.found && aliasMatch.canonicalProductId) {
    return {
      aliasHit: {
        canonicalProductId: aliasMatch.canonicalProductId,
        reason: aliasMatch.reason || 'Alias match found',
        supplierScoped: aliasMatch.supplierScoped
      },
      candidates: [],
      requiresReview: true, // Always true in this system
      blockedCount: 0
    };
  }

  // 2. Score all candidates
  const scoredCandidates = scoreCandidates(rawItem, candidates);

  // 3. Apply rejected match memory
  const finalCandidates = filterRejectedCandidates(rawItem, scoredCandidates, rejectedMatches, supplierId);

  // 4. Calculate blocked count
  const blockedCount = finalCandidates.filter(c => c.blocked).length;

  // 5. Pick the best candidate
  // The list is already sorted by score (desc) and blocked status (bottom)
  const topCandidate = finalCandidates[0];
  const bestCandidate = (topCandidate && !topCandidate.blocked && topCandidate.score > 0) 
    ? topCandidate 
    : undefined;

  return {
    bestCandidate,
    candidates: finalCandidates,
    requiresReview: true, // Always true in this system
    blockedCount
  };
}
