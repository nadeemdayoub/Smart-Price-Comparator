import { runBulkMatching } from './bulkMatchingService';
import { buildReviewRecordsForBulk, RawItemInput } from '../utils/reviewRecordBuilder';
import { saveMatchReviewRecords } from './matchReviewWriteService';
import { ExchangeRate } from '../types';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';

/**
 * Input type for raw upload items in the pipeline.
 */
export interface RawUploadItem extends RawItemInput {
  // Inherits rawName, rawCode, rawPrice, rawCurrency, id
}

/**
 * Summary result of the upload-to-review pipeline.
 */
export interface PipelineSummary {
  savedReviewIds: string[];
  count: number;
}

/**
 * Orchestrates the full flow from raw upload items to saved match review records.
 * 
 * 1. Runs bulk matching logic (aliases, fuzzy scoring, rejections).
 * 2. Transforms matching results into draft MatchReviewRecords.
 * 3. Persists the records to the Firestore 'match_reviews' collection.
 * 
 * @param params Object containing ownerUserId, uploadId, supplierId, and rawItems.
 * @returns A summary of the operation including created document IDs.
 */
export async function processUploadItemsToMatchReviews(params: {
  ownerUserId: string;
  uploadId: string;
  supplierId?: string | null;
  rawItems: RawUploadItem[];
}): Promise<PipelineSummary> {
  const { ownerUserId, uploadId, supplierId, rawItems } = params;

  if (rawItems.length === 0) {
    return { savedReviewIds: [], count: 0 };
  }

  // 1. Run bulk matching
  // runBulkMatching is now generic and will preserve the RawUploadItem type in results.
  const matchResults = await runBulkMatching<RawUploadItem>(ownerUserId, rawItems, supplierId);

  // 2. Build review records
  // The types now align perfectly without casting.
  const reviewRecords = buildReviewRecordsForBulk({
    ownerUserId,
    uploadId,
    supplierId,
    results: matchResults
  });

  // 2.5 Load exchange rates for auto-approval pricing
  const ratesQuery = query(
    collection(db, COLLECTIONS.EXCHANGE_RATES),
    where('ownerUserId', '==', ownerUserId)
  );
  const ratesSnap = await getDocs(ratesQuery);
  const rates = ratesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExchangeRate));

  // 3. Save to Firestore
  const savedReviewIds = await saveMatchReviewRecords(reviewRecords, rates);

  return {
    savedReviewIds,
    count: savedReviewIds.length
  };
}
