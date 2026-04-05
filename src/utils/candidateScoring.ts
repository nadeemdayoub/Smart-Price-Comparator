import { normalizeProductName, generateSearchTokens } from './productNormalization';
import { extractDangerTokens, hasDangerConflict, DangerTokens } from './dangerTokenExtraction';

export interface RawSupplierItem {
  rawName: string;
  rawCode?: string | null;
}

export interface CanonicalProductCandidate {
  id: string;
  canonicalName: string;
  normalizedName?: string;
  internalReference?: string;
  brand?: string;
  modelFamily?: string;
  searchTokens?: string[];
  // Structured danger tokens
  capacity?: string;
  packageType?: string;
  typeClass?: string;
  color?: string;
  version?: string;
}

export interface ScoringResult {
  candidateProductId: string;
  candidateName: string;
  score: number;            // 0 to 1
  reasons: string[];
  warnings: string[];
  dangerFlags: string[];
  blocked: boolean;
  matchType: 'reference' | 'exact_name' | 'learned' | 'token_overlap' | 'weak' | 'blocked';
}

/**
 * Scores a raw supplier item against a single candidate canonical product.
 * 
 * @param rawItem The raw item from the supplier.
 * @param candidate The candidate canonical product from the database.
 * @returns A structured scoring result.
 */
export function scoreCandidate(
  rawItem: RawSupplierItem,
  candidate: CanonicalProductCandidate
): ScoringResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const dangerFlags: string[] = [];
  
  const normalizedRawName = normalizeProductName(rawItem.rawName);
  const rawTokens = generateSearchTokens(normalizedRawName);
  const rawDanger = extractDangerTokens(normalizedRawName);
  
  // Use candidate's normalized name or normalize its canonical name if missing
  const candidateNormalizedName = candidate.normalizedName || normalizeProductName(candidate.canonicalName);
  
  // Build candidate danger tokens
  // Priority: use structured fields if provided, otherwise fallback to extraction from name
  const candidateDanger: DangerTokens = {
    capacity: candidate.capacity || extractDangerTokens(candidateNormalizedName).capacity,
    packageType: candidate.packageType || extractDangerTokens(candidateNormalizedName).packageType,
    typeClass: candidate.typeClass || extractDangerTokens(candidateNormalizedName).typeClass,
    color: candidate.color || extractDangerTokens(candidateNormalizedName).color,
    version: candidate.version || extractDangerTokens(candidateNormalizedName).version,
    editionKeywords: extractDangerTokens(candidateNormalizedName).editionKeywords // Edition keywords usually extracted from name
  };

  // Ensure candidate tokens are unique and have a safe fallback
  const candidateTokens = Array.from(new Set(
    candidate.searchTokens && candidate.searchTokens.length > 0 
      ? candidate.searchTokens 
      : generateSearchTokens(candidateNormalizedName)
  ));
  
  // 1. Check for Danger Conflicts (Hard Block)
  const conflictCheck = hasDangerConflict(rawDanger, candidateDanger);
  if (conflictCheck.conflict) {
    dangerFlags.push(...conflictCheck.reasons);
    return {
      candidateProductId: candidate.id,
      candidateName: candidate.canonicalName,
      score: 0,
      reasons: ['Danger token conflict detected'],
      warnings: conflictCheck.reasons,
      dangerFlags: conflictCheck.reasons,
      blocked: true,
      matchType: 'blocked'
    };
  }
  
  let score = 0;
  let matchType: ScoringResult['matchType'] = 'weak';
  
  // 2. Internal Reference Match (Strong Boost)
  if (rawItem.rawCode && candidate.internalReference && 
      rawItem.rawCode.trim().toLowerCase() === candidate.internalReference.trim().toLowerCase()) {
    score = 0.95;
    matchType = 'reference';
    reasons.push('Exact internal reference match');
  }
  
  // 3. Exact Normalized Name Match (Strongest Boost)
  if (normalizedRawName === candidateNormalizedName) {
    // If we already have a reference match, we keep the higher score (1.0)
    score = 1.0;
    matchType = 'exact_name';
    reasons.push('Exact normalized name match');
  }
  
  // 4. Token Overlap Calculation (Fuzzy Match)
  if (score < 1.0) {
    const rawTokenSet = new Set(rawTokens);
    
    const intersection = candidateTokens.filter(t => rawTokenSet.has(t));
    const union = Array.from(new Set([...rawTokens, ...candidateTokens]));
    
    // Jaccard similarity for tokens
    const overlapRatio = union.length > 0 ? intersection.length / union.length : 0;
    
    // If token overlap is better than current score (unlikely for exact matches but good for fuzzy)
    if (overlapRatio > score) {
      score = overlapRatio;
      
      // The 0.4 threshold is an initial heuristic that can be tuned later based on real-world performance
      if (score > 0.4) {
        matchType = 'token_overlap';
        reasons.push(`Token overlap ratio: ${(overlapRatio * 100).toFixed(1)}%`);
      } else {
        matchType = 'weak';
        reasons.push('Weak token overlap');
      }
    }
  }
  
  // Add warnings if danger tokens are missing on one side but present on the other
  // (This is not a conflict, but a potential risk)
  const checkMissingWarning = (field: keyof Omit<DangerTokens, 'editionKeywords'>, label: string) => {
    if (rawDanger[field] && !candidateDanger[field]) {
      warnings.push(`Raw item has ${label} (${rawDanger[field]}) but candidate does not`);
    }
    if (!rawDanger[field] && candidateDanger[field]) {
      warnings.push(`Candidate has ${label} (${candidateDanger[field]}) but raw item does not`);
    }
  };

  checkMissingWarning('capacity', 'capacity');
  checkMissingWarning('packageType', 'package type');
  checkMissingWarning('typeClass', 'type class');
  checkMissingWarning('version', 'version');

  return {
    candidateProductId: candidate.id,
    candidateName: candidate.canonicalName,
    score: parseFloat(score.toFixed(4)),
    reasons,
    warnings,
    dangerFlags,
    blocked: false,
    matchType
  };
}

/**
 * Scores a raw item against multiple candidates and returns them sorted by score.
 * 
 * @param rawItem The raw item from the supplier.
 * @param candidates List of candidate canonical products.
 * @returns Sorted list of scoring results.
 */
export function scoreCandidates(
  rawItem: RawSupplierItem,
  candidates: CanonicalProductCandidate[]
): ScoringResult[] {
  const results = candidates.map(c => scoreCandidate(rawItem, c));
  
  // Sort descending by score
  // Blocked items (score 0) naturally go to the bottom
  return results.sort((a, b) => {
    if (a.blocked && !b.blocked) return 1;
    if (!a.blocked && b.blocked) return -1;
    return b.score - a.score;
  });
}
