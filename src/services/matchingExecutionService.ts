import { loadMatchingData } from './matchingDataService';
import { prepareCandidates } from '../utils/candidatePreparation';
import { runMatchPipeline, PipelineResult } from '../utils/finalMatchPipeline';
import { RawSupplierItem } from '../utils/candidateScoring';
import { AliasMemoryEntry, RejectedMatchEntry } from '../utils/matchMemory';

/**
 * Runs the full matching pipeline for a single raw supplier item.
 * This service orchestrates data loading from Firestore, preparation of candidates,
 * and execution of the scoring/matching logic.
 * 
 * @param companyId The ID of the company owning the data.
 * @param rawItem The raw name and optional code of the item to match.
 * @param supplierId Optional supplier ID to scope alias and rejection memory.
 * @returns The full result of the matching pipeline.
 */
export async function runMatchingForRawItem(
  companyId: string,
  rawItem: RawSupplierItem,
  supplierId?: string | null
): Promise<PipelineResult> {
  // 1. Load all required matching data from Firestore
  const { canonicalProducts, aliases, rejectedMatches } = await loadMatchingData(companyId);

  // 2. Prepare canonical products for the matching engine
  const candidates = prepareCandidates(canonicalProducts);

  // 3. Map Firestore models to matching engine memory interfaces
  const aliasEntries: AliasMemoryEntry[] = aliases.map(a => ({
    canonicalProductId: a.productId,
    aliasText: a.aliasText,
    normalizedAlias: a.normalizedAlias,
    supplierId: a.supplierId
  }));

  const rejectionEntries: RejectedMatchEntry[] = rejectedMatches.map(r => ({
    normalizedRawName: r.normalizedRawName,
    candidateProductId: r.candidateProductId,
    supplierId: r.supplierId
  }));

  // 4. Run the final matching pipeline
  return runMatchPipeline(
    rawItem,
    candidates,
    aliasEntries,
    rejectionEntries,
    supplierId
  );
}
