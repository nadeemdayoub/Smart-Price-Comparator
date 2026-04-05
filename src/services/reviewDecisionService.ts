import { 
  doc, 
  collection, 
  writeBatch, 
  serverTimestamp,
  updateDoc,
  query,
  where,
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { 
  normalizeProductName, 
  generateSearchTokens, 
  createSensitiveSignature 
} from '../utils/productNormalization';
import { sanitizeFirestoreData } from '../lib/firestore-utils';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';
import { recordApprovedMatch, recordRejectedMatch, correctWrongAlias } from './matchLearningService';
import { clearLocalUploadDraft } from './uploadResumeService';
import { syncPriceEntry } from './pricingService';
import { ExchangeRate } from '../types';

/**
 * Parameters for approving a match.
 */
export interface ApproveMatchParams {
  reviewId: string;
  ownerUserId: string;
  uploadId: string;
  productId: string;
  rawName: string;
  rawCode?: string | null;
  rawPrice?: number | null;
  rawCurrency?: string | null;
  supplierId?: string | null;
  confidence: number;
  createAlias?: boolean;
  reviewedBy: string;
  createdBy?: string;
  rates: ExchangeRate[];
}

/**
 * Parameters for rejecting a match.
 */
export interface RejectMatchParams {
  reviewId: string;
  ownerUserId: string;
  uploadId: string;
  rawName: string;
  candidateProductId?: string;
  supplierId?: string | null;
  reviewedBy: string;
  rejectedBy: string;
  reason: string;
  rates: ExchangeRate[];
}

/**
 * Parameters for manually matching a product.
 */
export interface ManualMatchParams {
  reviewId: string;
  ownerUserId: string;
  uploadId: string;
  chosenProductId: string;
  rawName: string;
  rawPrice?: number | null;
  rawCurrency?: string | null;
  supplierId?: string | null;
  reviewedBy: string;
  originalSuggestedProductId?: string | null;
  isAliasCorrection?: boolean;
  rates: ExchangeRate[];
}

/**
 * Parameters for creating a new product and matching it.
 */
export interface CreateNewProductParams {
  reviewId: string;
  ownerUserId: string;
  uploadId: string;
  supplierId: string;
  reviewedBy: string;
  productData: {
    canonicalName: string;
    brand: string;
    category?: string;
    costPrice: number;
    internalReference?: string;
    capacity?: string;
    color?: string;
    version?: string;
  };
  rawPrice: number;
  rawCurrency: string;
  rates: ExchangeRate[];
}

/**
 * Parameters for ignoring a match.
 */
export interface IgnoreMatchParams {
  reviewId: string;
  ownerUserId: string;
  uploadId: string;
  reviewedBy: string;
  supplierId?: string | null;
}

/**
 * Approves a suggested match.
 * Updates the review record and synchronizes the PriceEntry atomically.
 */
export async function approveMatch(params: ApproveMatchParams): Promise<void> {
  const { 
    reviewId, 
    ownerUserId,
    uploadId,
    productId, 
    reviewedBy,
    rawPrice,
    rawCurrency,
    supplierId,
    rates
  } = params;

  const batch = writeBatch(db);
  const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, reviewId);
  
  try {
    // 1. Update MatchReview
    batch.update(reviewRef, sanitizeFirestoreData({
      ownerUserId,
      reviewStatus: 'approved',
      finalProductId: productId || null,
      finalAction: 'manual',
      reviewedBy,
      reviewedAt: serverTimestamp(),
    }));

    // 2. Sync PriceEntry
    syncPriceEntry(batch, {
      ownerUserId,
      uploadId,
      supplierId: supplierId || '',
      reviewId,
      productId,
      price: rawPrice ?? null,
      currency: rawCurrency ?? null,
      status: 'approved',
      rates
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
  }
}

/**
 * Ignores a match review item.
 * Sets status to 'ignored', which means it stays in the quotation but is not mapped to a product.
 */
export async function ignoreMatch(params: IgnoreMatchParams): Promise<void> {
  const { 
    reviewId, 
    ownerUserId,
    uploadId,
    reviewedBy,
    supplierId
  } = params;

  const batch = writeBatch(db);
  const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, reviewId);
  
  try {
    // 1. Update MatchReview
    batch.update(reviewRef, sanitizeFirestoreData({
      ownerUserId,
      reviewStatus: 'ignored',
      finalProductId: null,
      finalAction: 'ignore',
      reviewedBy,
      reviewedAt: serverTimestamp(),
    }));

    // 2. Sync PriceEntry (removes it if it exists, as it's not mapped)
    syncPriceEntry(batch, {
      ownerUserId,
      uploadId,
      supplierId: supplierId || '',
      reviewId,
      productId: null,
      price: null,
      currency: null,
      status: 'ignored',
      rates: []
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
  }
}

/**
 * Rejects a suggested match.
 * Updates the review record and removes any associated PriceEntry.
 */
export async function rejectMatch(params: RejectMatchParams): Promise<void> {
  const { 
    reviewId, 
    ownerUserId,
    uploadId,
    reviewedBy,
    supplierId,
    rates
  } = params;

  const batch = writeBatch(db);
  const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, reviewId);
  
  try {
    // 1. Update MatchReview
    batch.update(reviewRef, sanitizeFirestoreData({
      ownerUserId,
      reviewStatus: 'rejected',
      finalProductId: null,
      finalAction: 'reject',
      reviewedBy,
      reviewedAt: serverTimestamp(),
    }));

    // 2. Sync PriceEntry (removes it if it exists)
    syncPriceEntry(batch, {
      ownerUserId,
      uploadId,
      supplierId: supplierId || '',
      reviewId,
      productId: null,
      price: null,
      currency: null,
      status: 'rejected',
      rates
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
  }
}

/**
 * Manually matches a review item to a specific product.
 * Updates the review record and synchronizes the PriceEntry atomically.
 */
export async function manualMatch(params: ManualMatchParams): Promise<void> {
  const { 
    reviewId, 
    ownerUserId,
    uploadId,
    chosenProductId, 
    reviewedBy,
    rawPrice,
    rawCurrency,
    supplierId,
    originalSuggestedProductId,
    isAliasCorrection,
    rates
  } = params;

  const batch = writeBatch(db);
  const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, reviewId);
  
  try {
    // 1. Update MatchReview
    batch.update(reviewRef, sanitizeFirestoreData({
      ownerUserId,
      reviewStatus: 'approved',
      finalProductId: chosenProductId || null,
      finalAction: 'manual',
      reviewedBy,
      reviewedAt: serverTimestamp(),
      originalSuggestedProductId: originalSuggestedProductId || null,
      isAliasCorrection: isAliasCorrection || false,
    }));

    // 2. Sync PriceEntry
    syncPriceEntry(batch, {
      ownerUserId,
      uploadId,
      supplierId: supplierId || '',
      reviewId,
      productId: chosenProductId,
      price: rawPrice ?? null,
      currency: rawCurrency ?? null,
      status: 'approved',
      rates
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
  }
}

/**
 * Undoes a review action, setting it back to pending and removing the PriceEntry.
 */
export async function undoMatch(reviewId: string, ownerUserId: string, uploadId: string, supplierId: string): Promise<void> {
  const batch = writeBatch(db);
  const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, reviewId);
  
  try {
    // 1. Update MatchReview
    batch.update(reviewRef, sanitizeFirestoreData({
      ownerUserId,
      reviewStatus: 'pending',
      finalProductId: null,
      finalAction: null,
      reviewedBy: null,
      reviewedAt: null,
    }));

    // 2. Sync PriceEntry (removes it)
    syncPriceEntry(batch, {
      ownerUserId,
      uploadId,
      supplierId,
      reviewId,
      productId: null,
      price: null,
      currency: null,
      status: 'pending',
      rates: [] // Rates don't matter for deletion
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
  }
}

/**
 * Finalizes the review for an entire upload.
 * Creates aliases for all approved items. Price entries are now created atomically during approval.
 */
export async function finalizeReview(
  ownerUserId: string, 
  uploadId: string, 
  reviewedBy: string,
  supplierId?: string,
  completedAt?: Timestamp,
  itemIds?: string[]
): Promise<void> {
  console.log(`[finalizeReview] Starting finalization for upload: ${uploadId}, owner: ${ownerUserId}, partial: ${!!itemIds}`);
  
  // 1. Get approved or ignored match reviews for this upload
  const reviewsRef = collection(db, COLLECTIONS.MATCH_REVIEWS);
  let q;
  
  if (itemIds && itemIds.length > 0) {
    // Firestore 'in' query limit is 10, but let's assume itemIds is small or handle chunks if needed.
    // For simplicity, if itemIds is provided, we filter by them.
    // Note: If itemIds > 30, this will fail. For now, we'll use a simpler approach if possible.
    q = query(
      reviewsRef, 
      where('ownerUserId', '==', ownerUserId),
      where('uploadId', '==', uploadId),
      where('reviewStatus', 'in', ['approved', 'ignored'])
    );
  } else {
    q = query(
      reviewsRef, 
      where('ownerUserId', '==', ownerUserId),
      where('uploadId', '==', uploadId),
      where('reviewStatus', 'in', ['approved', 'ignored'])
    );
  }
  
  let snap;
  try {
    snap = await getDocs(q);
  } catch (error) {
    console.error("[finalizeReview] Error fetching approved reviews:", error);
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.MATCH_REVIEWS);
    throw error;
  }

  // Filter in memory if itemIds is provided to avoid 'in' query limits and complex indexing
  const docsToProcess = itemIds && itemIds.length > 0 
    ? snap.docs.filter(d => itemIds.includes(d.id))
    : snap.docs;

  const uploadRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId);
  
  if (docsToProcess.length === 0) {
    console.log(`[finalizeReview] No items to process for upload ${uploadId}.`);
    if (!itemIds) {
      await updateDoc(uploadRef, sanitizeFirestoreData({ 
        status: 'finalized', 
        finalizedAt: serverTimestamp(),
        completedAt: completedAt || null,
        updatedAt: serverTimestamp() 
      }));
      clearLocalUploadDraft(ownerUserId);
    }
    return;
  }

  console.log(`[finalizeReview] Processing ${docsToProcess.length} items for upload ${uploadId}`);

  // 2. Process each approved item for learning (Aliases)
  const BATCH_SIZE = 400;
  let currentBatch = writeBatch(db);
  let operationCount = 0;

  for (const reviewDoc of docsToProcess) {
    const data = reviewDoc.data();
    const productId = data.finalProductId;
    const reviewStatus = data.reviewStatus;
    
    if (reviewStatus === 'approved' && productId) {
      // Create Alias (Learning)
      const aliasRef = doc(collection(db, COLLECTIONS.PRODUCT_ALIASES));
      const aliasData = sanitizeFirestoreData({
        ownerUserId,
        productId,
        aliasText: data.rawName,
        normalizedAlias: normalizeProductName(data.rawName),
        sourceType: data.finalAction === 'manual' ? 'manual' : 'auto',
        supplierId: data.supplierId || null,
        createdBy: reviewedBy,
        createdAt: serverTimestamp(),
        isActive: true,
        status: 'active'
      });
      console.log(`[finalizeReview] Adding product_alias for ${data.rawName} -> ${productId}`);
      currentBatch.set(aliasRef, aliasData);
      operationCount++;

      // 3. Update PriceEntry status to finalized
      const priceRef = doc(db, COLLECTIONS.PRICE_ENTRIES, reviewDoc.id);
      console.log(`[finalizeReview] Force-setting price_entry ${reviewDoc.id} to finalized (merge: true)`);
      currentBatch.set(priceRef, { 
        status: 'finalized', 
        updatedAt: serverTimestamp(),
        ownerUserId,
        canonicalProductId: productId,
        supplierId: data.supplierId || '',
        price: data.rawPrice || 0,
        currency: data.rawCurrency || 'USD',
        date: serverTimestamp()
      }, { merge: true });
      operationCount++;
    } else if (reviewStatus === 'ignored') {
      // For ignored items, we might want to ensure they are marked as finalized in some way if needed
      // but usually they don't have a PriceEntry. 
      // The user said they go to "Unmapped Items".
      console.log(`[finalizeReview] Skipping price_entry for ignored item ${reviewDoc.id}`);
    }

    if (operationCount >= BATCH_SIZE) {
      console.log(`[finalizeReview] Committing batch of ${operationCount} operations...`);
      try {
        await currentBatch.commit();
        currentBatch = writeBatch(db);
        operationCount = 0;
      } catch (error) {
        console.error("[finalizeReview] Error committing batch:", error);
        handleFirestoreError(error, OperationType.WRITE, "batch_operations");
        throw error;
      }
    }

    if (data.isAliasCorrection && data.originalSuggestedProductId && data.finalProductId) {
      try {
        await correctWrongAlias(
          ownerUserId,
          data.supplierId || '',
          data.rawName,
          data.originalSuggestedProductId,
          data.finalProductId,
          reviewedBy
        );
      } catch (e) {
        console.error("[finalizeReview] Error correcting alias:", e);
      }
    }
  }

  if (operationCount > 0) {
    console.log(`[finalizeReview] Committing final batch of ${operationCount} operations...`);
    try {
      await currentBatch.commit();
    } catch (error) {
      console.error("[finalizeReview] Error committing final batch:", error);
      handleFirestoreError(error, OperationType.WRITE, "final_batch_operations");
      throw error;
    }
  }

  // 3. Mark upload as finalized ONLY if all items are processed
  if (!itemIds || itemIds.length === 0) {
    console.log(`[finalizeReview] Updating upload status to finalized for ${uploadId}`);
    try {
      await updateDoc(uploadRef, sanitizeFirestoreData({ 
        status: 'finalized', 
        finalizedAt: serverTimestamp(),
        completedAt: completedAt || null,
        updatedAt: serverTimestamp() 
      }));
      
      clearLocalUploadDraft(ownerUserId);
      console.log(`[finalizeReview] Successfully finalized upload ${uploadId}`);
    } catch (error) {
      console.error("[finalizeReview] Error updating upload status:", error);
      handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.SUPPLIER_UPLOADS);
      throw error;
    }
  } else {
    console.log(`[finalizeReview] Partial finalization complete. Upload ${uploadId} remains in current status.`);
  }
}

/**
 * Creates a new canonical product and matches the review item to it.
 */
export async function createNewProduct(params: CreateNewProductParams): Promise<string> {
  const {
    reviewId,
    ownerUserId,
    uploadId,
    supplierId,
    reviewedBy,
    productData,
    rawPrice,
    rawCurrency,
    rates
  } = params;

  const batch = writeBatch(db);
  
  // 1. Create New Canonical Product
  const productRef = doc(collection(db, COLLECTIONS.CANONICAL_PRODUCTS));
  const productId = productRef.id;
  
  // Get supplier name for the label if possible
  let supplierName = '';
  try {
    const supplierSnap = await getDocs(query(collection(db, COLLECTIONS.SUPPLIERS), where('id', '==', supplierId)));
    if (!supplierSnap.empty) {
      supplierName = supplierSnap.docs[0].data().name;
    }
  } catch (e) {
    console.error("Error fetching supplier name for product label:", e);
  }

  const normalizedName = normalizeProductName(productData.canonicalName);
  
  const newProduct = sanitizeFirestoreData({
    ...productData,
    id: productId,
    ownerUserId,
    normalizedName,
    searchTokens: generateSearchTokens(normalizedName),
    sensitiveSignature: createSensitiveSignature({
      brand: productData.brand,
      capacity: productData.capacity,
      color: productData.color,
      version: productData.version
    }),
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    // Store origin metadata
    meta: {
      origin: 'supplier_upload',
      sourceSupplierId: supplierId,
      sourceSupplierName: supplierName,
      sourceUploadId: uploadId,
      createdBy: reviewedBy
    }
  });

  batch.set(productRef, newProduct);

  // 2. Update MatchReview
  const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, reviewId);
  batch.update(reviewRef, sanitizeFirestoreData({
    ownerUserId,
    reviewStatus: 'approved',
    finalProductId: productId || null,
    finalAction: 'create_new_product',
    reviewedBy,
    reviewedAt: serverTimestamp(),
  }));

  // 3. Sync PriceEntry
  syncPriceEntry(batch, {
    ownerUserId,
    uploadId,
    supplierId,
    reviewId,
    productId,
    price: rawPrice,
    currency: rawCurrency,
    status: 'approved',
    rates,
    manualPriceInDefaultCurrency: productData.costPrice
  });

  // 4. Audit Log
  const auditRef = doc(collection(db, COLLECTIONS.AUDIT_LOGS));
  batch.set(auditRef, sanitizeFirestoreData({
    ownerUserId,
    userId: reviewedBy,
    actionType: 'CREATE_PRODUCT_FROM_REVIEW',
    entityType: 'canonical_products',
    entityId: productId,
    description: `Created new product "${productData.canonicalName}" from supplier quotation review.`,
    meta: {
      reviewId,
      uploadId,
      supplierId
    },
    createdAt: serverTimestamp()
  }));

  try {
    await batch.commit();
    return productId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.CANONICAL_PRODUCTS);
    throw error;
  }
}
