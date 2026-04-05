import { 
  collection, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { runBulkMatching } from './bulkMatchingService';
import { buildReviewRecordsForBulk, RawItemInput } from '../utils/reviewRecordBuilder';
import { saveMatchReviewRecords } from './matchReviewWriteService';
import { updateUploadProgress, markUploadCompleted, markUploadProcessing, markUploadFailed } from './uploadSessionService';
import { ExchangeRate } from '../types';

export interface RunUploadMatchingPipelineParams {
  uploadId: string;
  ownerUserId: string;
  supplierId: string;
}

/**
 * Orchestrates the full matching pipeline after raw upload items have been stored.
 * 1. Loads raw items from Firestore.
 * 2. Runs the bulk matching engine.
 * 3. Generates draft match review records.
 * 4. Saves review records to Firestore.
 * 5. Updates the upload session status and progress.
 * 
 * @param params Parameters including uploadId, ownerUserId, and supplierId.
 */
export async function runUploadMatchingPipeline(params: RunUploadMatchingPipelineParams): Promise<void> {
  const { uploadId, ownerUserId, supplierId } = params;
  console.log(`[Pipeline] Starting pipeline for uploadId: ${uploadId}, ownerUserId: ${ownerUserId}`);

  try {
    // Check if already finalized before starting
    const initialSnap = await getDocs(query(collection(db, COLLECTIONS.SUPPLIER_UPLOADS), where('__name__', '==', uploadId)));
    if (!initialSnap.empty && initialSnap.docs[0].data().status === 'finalized') {
      console.log(`[Pipeline] Upload ${uploadId} is already finalized. Aborting pipeline.`);
      return;
    }

    console.log(`[Pipeline] Marking upload as processing...`);
    await markUploadProcessing(uploadId);

    // 1. Load upload_items_raw where uploadId = uploadId
    console.log(`[Pipeline] Loading raw items for uploadId: ${uploadId}...`);
  const q = query(
    collection(db, COLLECTIONS.UPLOAD_ITEMS_RAW),
    where('ownerUserId', '==', ownerUserId),
    where('uploadId', '==', uploadId)
  );
  const snapshot = await getDocs(q);
  console.log(`[Pipeline] Loaded ${snapshot.docs.length} raw items`);
  
  // 2. Convert rows to BulkRawItem format (specifically RawItemInput for review builder)
  const rawItems: RawItemInput[] = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      rawName: data.rawName,
      rawCode: data.rawCode ?? null,
      rawPrice: data.rawPrice ?? null,
      rawCurrency: data.rawCurrency ?? null,
    };
  });

  if (rawItems.length === 0) {
    console.warn(`[Pipeline] No raw items found for uploadId: ${uploadId}. Marking as completed.`);
    await markUploadCompleted(uploadId);
    return;
  }

    // 3. Run bulk matching
    console.log(`[Pipeline] Running bulk matching engine...`);
    const results = await runBulkMatching(ownerUserId, rawItems, supplierId);
    console.log(`[Pipeline] Bulk matching completed with ${results.length} results`);

    // 3.5 Load exchange rates for auto-approval pricing
    console.log(`[Pipeline] Loading exchange rates...`);
    const ratesQuery = query(
      collection(db, COLLECTIONS.EXCHANGE_RATES),
      where('ownerUserId', '==', ownerUserId)
    );
    const ratesSnap = await getDocs(ratesQuery);
    const rates = ratesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExchangeRate));
    console.log(`[Pipeline] Loaded ${rates.length} exchange rates`);

    // 4. Build review records
    console.log(`[Pipeline] Building review records...`);
    const reviewRecords = buildReviewRecordsForBulk({
      ownerUserId,
      uploadId,
      supplierId,
      results
    });
    console.log(`[Pipeline] Built ${reviewRecords.length} review records`);

    // 5. Save review records
    console.log(`[Pipeline] Saving review records to Firestore...`);
    await saveMatchReviewRecords(reviewRecords, rates);
    console.log(`[Pipeline] Review records saved successfully`);

  // 6. Update upload progress
  console.log(`[Pipeline] Updating upload progress...`);
  await updateUploadProgress(uploadId, rawItems.length);

  // 7. Mark upload completed
  console.log(`[Pipeline] Marking upload as completed`);
  
  // Final check before marking as completed
  const finalSnap = await getDocs(query(collection(db, COLLECTIONS.SUPPLIER_UPLOADS), where('__name__', '==', uploadId)));
  if (!finalSnap.empty && finalSnap.docs[0].data().status === 'finalized') {
    console.log(`[Pipeline] Upload ${uploadId} is already finalized. Skipping markUploadCompleted.`);
  } else {
    await markUploadCompleted(uploadId);
  }
  } catch (error) {
    console.error('[Pipeline] CRITICAL ERROR:', error);
    await markUploadFailed(uploadId, error instanceof Error ? error.message : String(error));
  }
}
