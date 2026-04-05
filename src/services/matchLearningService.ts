import { collection, addDoc, serverTimestamp, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { normalizeProductName } from '../utils/productNormalization';
import { sanitizeFirestoreData } from '../lib/firestore-utils';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

export interface ApprovedMatchParams {
  ownerUserId: string;
  productId: string;
  rawName: string;
  supplierId: string;
  confidence: number;
  reviewId: string;
}

export interface RejectedMatchParams {
  ownerUserId: string;
  rawName: string;
  supplierId: string;
  productId: string;
  reason: string;
}

/**
 * Records an approved match as a learning signal.
 * This helps the matching engine improve future predictions.
 */
export async function recordApprovedMatch(params: ApprovedMatchParams): Promise<void> {
  const { ownerUserId, productId, rawName, supplierId, confidence, reviewId } = params;
  
  const learningRecord = {
    ownerUserId,
    productId,
    rawName,
    normalizedRawName: normalizeProductName(rawName),
    supplierId,
    action: 'approved',
    confidence,
    source: 'review',
    reviewId,
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, COLLECTIONS.MATCH_LEARNING), sanitizeFirestoreData(learningRecord));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, COLLECTIONS.MATCH_LEARNING);
  }
}

/**
 * Records a rejected match as a learning signal.
 * This helps the matching engine avoid repeating the same incorrect matches.
 */
export async function recordRejectedMatch(params: RejectedMatchParams): Promise<void> {
  const { ownerUserId, rawName, supplierId, productId, reason } = params;

  const learningRecord = {
    ownerUserId,
    rawName,
    normalizedRawName: normalizeProductName(rawName),
    supplierId,
    productId,
    action: 'rejected',
    reason,
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, COLLECTIONS.MATCH_LEARNING), sanitizeFirestoreData(learningRecord));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, COLLECTIONS.MATCH_LEARNING);
  }
}

/**
 * Corrects a wrong alias by deactivating the old one and creating a new one.
 */
export async function correctWrongAlias(
  ownerUserId: string,
  supplierId: string,
  rawName: string,
  wrongProductId: string,
  correctProductId: string,
  userId: string
): Promise<void> {
  const batch = writeBatch(db);
  const normalizedRaw = normalizeProductName(rawName);

  // 1. Find and deactivate old alias
  const aliasesRef = collection(db, COLLECTIONS.PRODUCT_ALIASES);
  const q = query(
    aliasesRef,
    where('ownerUserId', '==', ownerUserId),
    where('normalizedAlias', '==', normalizedRaw),
    where('productId', '==', wrongProductId),
    where('isActive', '==', true)
  );

  try {
    const snap = await getDocs(q);
    snap.forEach((aliasDoc) => {
      batch.update(aliasDoc.ref, sanitizeFirestoreData({
        isActive: false,
        status: 'corrected',
        correctedAt: serverTimestamp(),
        correctedBy: userId
      }));
    });

    // 2. Record negative learning signal
    const negativeSignalRef = doc(collection(db, COLLECTIONS.MATCH_LEARNING));
    batch.set(negativeSignalRef, sanitizeFirestoreData({
      ownerUserId,
      rawName,
      normalizedRawName: normalizedRaw,
      supplierId,
      productId: wrongProductId,
      action: 'rejected',
      reason: 'manual_correction',
      createdAt: serverTimestamp(),
    }));

    // 3. Record positive learning signal for new match
    const positiveSignalRef = doc(collection(db, COLLECTIONS.MATCH_LEARNING));
    batch.set(positiveSignalRef, sanitizeFirestoreData({
      ownerUserId,
      rawName,
      normalizedRawName: normalizedRaw,
      supplierId,
      productId: correctProductId,
      action: 'approved',
      confidence: 1.0,
      source: 'correction',
      createdAt: serverTimestamp(),
    }));

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, "alias_correction_batch");
  }
}
