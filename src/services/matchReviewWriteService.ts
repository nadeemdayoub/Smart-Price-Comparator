import { 
  collection, 
  addDoc, 
  writeBatch, 
  doc, 
  serverTimestamp,
  WriteBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { MatchReviewRecord } from '../utils/reviewRecordBuilder';
import { sanitizeFirestoreData } from '../lib/firestore-utils';
import { syncPriceEntry } from './pricingService';
import { ExchangeRate } from '../types';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

/**
 * Saves a single draft match review record to Firestore.
 */
export async function saveMatchReviewRecord(record: MatchReviewRecord): Promise<string> {
  const colRef = collection(db, COLLECTIONS.MATCH_REVIEWS);
  
  try {
    const docRef = await addDoc(colRef, sanitizeFirestoreData({
      ...record,
      createdAt: serverTimestamp(),
    }));
    
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, COLLECTIONS.MATCH_REVIEWS);
  }
}

/**
 * Saves multiple draft match review records to Firestore using batched writes.
 * If a record is already 'approved' (auto-approved), it also creates a PriceEntry.
 */
export async function saveMatchReviewRecords(records: MatchReviewRecord[], rates: ExchangeRate[] = []): Promise<string[]> {
  if (records.length === 0) {
    return [];
  }

  const colRef = collection(db, COLLECTIONS.MATCH_REVIEWS);
  const allIds: string[] = [];
  
  const BATCH_LIMIT = 500;

  for (let i = 0; i < records.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const chunk = records.slice(i, i + BATCH_LIMIT);
    
    chunk.forEach(record => {
      const newDocRef = doc(colRef);
      const reviewId = newDocRef.id;
      allIds.push(reviewId);
      
      const reviewData = sanitizeFirestoreData({
        ...record,
        id: reviewId, // Ensure ID is in the record for consistency
        createdAt: serverTimestamp(),
        reviewedAt: record.reviewStatus === 'approved' ? serverTimestamp() : null,
      });

      batch.set(newDocRef, reviewData);

      // If auto-approved, sync PriceEntry
      if (record.reviewStatus === 'approved' && record.finalProductId) {
        syncPriceEntry(batch, {
          ownerUserId: record.ownerUserId,
          uploadId: record.uploadId,
          supplierId: record.supplierId || '',
          reviewId: reviewId,
          productId: record.finalProductId,
          price: record.rawPrice,
          currency: record.rawCurrency,
          status: 'approved',
          rates
        });
      }
    });
    
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
    }
  }

  return allIds;
}
