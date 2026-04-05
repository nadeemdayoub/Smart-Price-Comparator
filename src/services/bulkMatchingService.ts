import { loadMatchingData } from './matchingDataService';
import { prepareCandidates } from '../utils/candidatePreparation';
import { runMatchPipeline, PipelineResult } from '../utils/finalMatchPipeline';
import { AliasMemoryEntry, RejectedMatchEntry } from '../utils/matchMemory';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { normalizeProductName, generateSearchTokens } from '../utils/productNormalization';
import { CanonicalProductCandidate } from '../utils/candidateScoring';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

/**
 * Builds a token-based index for canonical products to optimize candidate retrieval.
 * Map<token, Set<productId>>
 */
function buildTokenIndex(candidates: CanonicalProductCandidate[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  candidates.forEach(candidate => {
    // Candidates from prepareCandidates already have searchTokens populated
    const tokens = candidate.searchTokens || [];

    tokens.forEach(token => {
      if (!index.has(token)) {
        index.set(token, new Set());
      }
      index.get(token)!.add(candidate.id);
    });
  });

  return index;
}

/**
 * Loads learning signals from the match_learning collection.
 * Consolidates approved signals deterministically by frequency.
 */
async function loadLearningSignals(ownerUserId: string) {
  console.log(`[BulkMatch] Loading learning signals for ownerUserId: ${ownerUserId}`);
  
  try {
    const q = query(
      collection(db, COLLECTIONS.MATCH_LEARNING),
      where('ownerUserId', '==', ownerUserId),
      limit(5000)
    );
    
    const snapshot = await getDocs(q);
    console.log(`[BulkMatch] Loaded ${snapshot.docs.length} learning signals`);
    
    // Frequency map: normalizedRawName -> Map<productId, count>
    const approvedFrequencies = new Map<string, Map<string, number>>();
    const rejectedSet = new Set<string>();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const key = data.normalizedRawName;
      if (data.action === 'approved') {
        if (!approvedFrequencies.has(key)) {
          approvedFrequencies.set(key, new Map());
        }
        const productCounts = approvedFrequencies.get(key)!;
        productCounts.set(data.productId, (productCounts.get(data.productId) || 0) + 1);
      } else if (data.action === 'rejected') {
        rejectedSet.add(`${key}_${data.productId}`);
      }
    });

    // Consolidate approvedMap: pick most frequent, then deterministic tie-break
    const approvedMap = new Map<string, string>();
    approvedFrequencies.forEach((productCounts, rawName) => {
      let bestProductId = '';
      let maxCount = -1;
      
      // Sort keys for deterministic tie-break
      const sortedProductIds = Array.from(productCounts.keys()).sort();
      
      for (const pid of sortedProductIds) {
        const count = productCounts.get(pid)!;
        if (count > maxCount) {
          maxCount = count;
          bestProductId = pid;
        }
      }
      
      if (bestProductId) {
        approvedMap.set(rawName, bestProductId);
      }
    });

    return { approvedMap, rejectedSet };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTIONS.MATCH_LEARNING);
    // The above throws, but for type safety:
    return { approvedMap: new Map<string, string>(), rejectedSet: new Set<string>() };
  }
}

/**
 * Simple input type for raw items in bulk operations.
 */
export interface BulkRawItem {
  id?: string;
  rawName: string;
  rawCode?: string | null;
  rawPrice?: number | null;
  rawCurrency?: string | null;
}

/**
 * Result structure for a single item in a bulk matching operation.
 */
export interface BulkMatchResult<T extends BulkRawItem = BulkRawItem> {
  rawItem: T;
  result: PipelineResult;
}

/**
 * Runs the matching pipeline for multiple raw supplier items in a single batch.
 * This service optimizes performance by loading and preparing the matching 
 * context (products, aliases, rejections) only once for the entire batch.
 * 
 * @param ownerUserId The ID of the user owning the data.
 * @param rawItems The list of raw items to process.
 * @param supplierId Optional supplier ID to scope alias and rejection memory.
 * @returns A promise resolving to an array of matching results in the same order as input.
 */
export async function runBulkMatching<T extends BulkRawItem>(
  ownerUserId: string,
  rawItems: T[],
  supplierId?: string | null
): Promise<BulkMatchResult<T>[]> {
  // 1. Load all required matching data from Firestore once for the whole batch
  const [
    { canonicalProducts, aliases, rejectedMatches },
    { approvedMap, rejectedSet }
  ] = await Promise.all([
    loadMatchingData(ownerUserId),
    loadLearningSignals(ownerUserId)
  ]);

  // 2. Prepare canonical products for the matching engine once
  const candidates = prepareCandidates(canonicalProducts);

  // 2.5 Build token index for optimized candidate retrieval
  const tokenIndex = buildTokenIndex(candidates);

  // 3. Map Firestore models to matching engine memory interfaces once
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

  // 4. Run the matching pipeline for each raw item
  return rawItems.map(item => {
    const normalizedRawName = normalizeProductName(item.rawName);
    const rawTokens = generateSearchTokens(normalizedRawName);
    
    // Optimize candidate pool using token index intersection
    let candidatePool = candidates;
    if (rawTokens.length > 0) {
      let intersectedIds: Set<string> | null = null;

      rawTokens.forEach(token => {
        const tokenIds = tokenIndex.get(token);
        if (tokenIds) {
          if (intersectedIds === null) {
            intersectedIds = new Set(tokenIds);
          } else {
            // Intersect current set with token set
            const nextIntersection = new Set<string>();
            tokenIds.forEach(id => {
              if (intersectedIds!.has(id)) {
                nextIntersection.add(id);
              }
            });
            intersectedIds = nextIntersection;
          }
        }
      });

      // If intersection found matches, use them. Otherwise fallback to full list.
      if (intersectedIds && intersectedIds.size > 0) {
        candidatePool = candidates.filter(c => intersectedIds!.has(c.id));
      }
    }
    
    // Apply rejected learning signals by filtering candidates from the pool
    const filteredCandidates = candidatePool.filter(c => !rejectedSet.has(`${normalizedRawName}_${c.id}`));

    const result = runMatchPipeline(
      item,
      filteredCandidates,
      aliasEntries,
      rejectionEntries,
      supplierId
    );

    // Enrich with product name if it's an alias hit
    if (result.aliasHit && !result.bestCandidate) {
      const product = canonicalProducts.find(p => p.id === result.aliasHit!.canonicalProductId);
      if (product) {
        result.bestCandidate = {
          candidateProductId: product.id,
          candidateName: product.canonicalName,
          score: 1.0,
          reasons: [result.aliasHit.reason],
          warnings: [],
          dangerFlags: [],
          blocked: false,
          matchType: 'exact_name' // Treat alias hit as exact for result purposes
        };
      }
    }

    // 4.5 Apply approved learning memory if no alias hit
    if (!result.aliasHit) {
      const learnedProductId = approvedMap.get(normalizedRawName);
      if (learnedProductId) {
        const candidate = canonicalProducts.find(p => p.id === learnedProductId);
        
        if (candidate) {
          // Check if the learned candidate is in the scored list and not blocked
          const scoredCandidate = result.candidates.find(c => c.candidateProductId === learnedProductId);
          
          // Only apply if not blocked by danger tokens
          if (!scoredCandidate || !scoredCandidate.blocked) {
            const learnedResult = {
              candidateProductId: learnedProductId,
              candidateName: candidate.canonicalName,
              score: 0.9,
              reasons: ["learned match from previous reviews"],
              warnings: scoredCandidate?.warnings || [],
              dangerFlags: [],
              blocked: false,
              matchType: 'learned' as const
            };

            // If learned match is better than current best, promote it
            if (!result.bestCandidate || learnedResult.score > result.bestCandidate.score) {
              return {
                rawItem: item,
                result: {
                  ...result,
                  bestCandidate: learnedResult
                }
              };
            }
          }
        }
      }
    }

    return {
      rawItem: item,
      result
    };
  });
}
