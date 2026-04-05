import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp,
  runTransaction,
  deleteDoc,
  query,
  where,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

export interface CreateUploadSessionParams {
  ownerUserId: string;
  supplierId: string;
  fileName: string;
  totalRows: number;
}

/**
 * Creates a new supplier upload session in Firestore.
 * 
 * @param params Session parameters including user, supplier, and file info.
 * @returns The ID of the created upload session.
 */
export async function createUploadSession(params: CreateUploadSessionParams): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, COLLECTIONS.SUPPLIER_UPLOADS), {
      ownerUserId: params.ownerUserId,
      supplierId: params.supplierId,
      fileName: params.fileName,
      totalRows: params.totalRows,
      processedRows: 0,
      status: "draft",
      createdAt: serverTimestamp(),
    });
    
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, COLLECTIONS.SUPPLIER_UPLOADS);
  }
}

/**
 * Updates the progress of an upload session by setting the number of processed rows.
 * 
 * @param uploadId The ID of the upload session to update.
 * @param processedRows The current count of processed rows.
 */
export async function updateUploadProgress(uploadId: string, processedRows: number): Promise<void> {
  const docRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId);
  try {
    await updateDoc(docRef, {
      processedRows
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTIONS.SUPPLIER_UPLOADS}/${uploadId}`);
  }
}

/**
 * Marks an upload session as processing.
 * Prevents overwriting a terminal status.
 * 
 * @param uploadId The ID of the upload session to update.
 */
export async function markUploadProcessing(uploadId: string): Promise<void> {
  const docRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return;
      
      const currentStatus = snap.data().status;
      // CRITICAL: Never overwrite a terminal status.
      if (['finalized', 'abandoned', 'failed', 'needs_review'].includes(currentStatus)) {
        console.log(`[markUploadProcessing] Skipping update: Session ${uploadId} is already ${currentStatus}.`);
        return;
      }
      
      transaction.update(docRef, {
        status: "processing",
        updatedAt: serverTimestamp()
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${COLLECTIONS.SUPPLIER_UPLOADS}/${uploadId}`);
  }
}

/**
 * Marks an upload session as failed.
 * Prevents overwriting a terminal status.
 * 
 * @param uploadId The ID of the upload session to update.
 * @param error The error message.
 */
export async function markUploadFailed(uploadId: string, error: string): Promise<void> {
  const docRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return;
      
      const currentStatus = snap.data().status;
      // CRITICAL: Never overwrite a finalized or abandoned status.
      if (['finalized', 'abandoned'].includes(currentStatus)) {
        console.log(`[markUploadFailed] Skipping update: Session ${uploadId} is already ${currentStatus}.`);
        return;
      }
      
      transaction.update(docRef, {
        status: "failed",
        error,
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${COLLECTIONS.SUPPLIER_UPLOADS}/${uploadId}`);
  }
}

/**
 * Marks an upload session as completed and sets the completion timestamp.
 * Prevents overwriting a finalized status to avoid regression.
 * 
 * @param uploadId The ID of the upload session to complete.
 */
export async function markUploadCompleted(uploadId: string): Promise<void> {
  const docRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return;
      
      const currentStatus = snap.data().status;
      // CRITICAL: Never overwrite a finalized or needs_review status.
      if (currentStatus === 'finalized' || currentStatus === 'needs_review') {
        console.log(`[markUploadCompleted] Skipping update: Session ${uploadId} is already ${currentStatus}.`);
        return;
      }
      
      transaction.update(docRef, {
        status: "ready_for_review",
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${COLLECTIONS.SUPPLIER_UPLOADS}/${uploadId}`);
  }
}

/**
 * Marks an upload session as needing review.
 * Prevents overwriting a finalized status.
 * 
 * @param uploadId The ID of the upload session to update.
 */
export async function markUploadNeedsReview(uploadId: string): Promise<void> {
  const docRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return;
      
      const currentStatus = snap.data().status;
      if (currentStatus === 'finalized') {
        console.log(`[markUploadNeedsReview] Skipping update: Session ${uploadId} is already finalized.`);
        return;
      }
      
      transaction.update(docRef, {
        status: "needs_review",
        updatedAt: serverTimestamp()
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${COLLECTIONS.SUPPLIER_UPLOADS}/${uploadId}`);
  }
}

/**
 * Marks an upload session as abandoned.
 * Prevents overwriting a finalized status.
 * 
 * @param uploadId The ID of the upload session to update.
 */
export async function markUploadAbandoned(uploadId: string): Promise<void> {
  const docRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return;
      
      const currentStatus = snap.data().status;
      if (currentStatus === 'finalized') {
        console.log(`[markUploadAbandoned] Skipping update: Session ${uploadId} is already finalized.`);
        return;
      }
      
      transaction.update(docRef, {
        status: "abandoned",
        abandonedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${COLLECTIONS.SUPPLIER_UPLOADS}/${uploadId}`);
  }
}

/**
 * Deletes an upload session and its associated data (raw items, match reviews, quotation items).
 * Handles Firestore batch limits by committing multiple batches if necessary.
 * 
 * @param uploadId The ID of the upload session to delete.
 */
export async function deleteUploadSession(uploadId: string): Promise<void> {
  try {
    const deleteBatch = async (refs: any[]) => {
      for (let i = 0; i < refs.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = refs.slice(i, i + 500);
        chunk.forEach(ref => batch.delete(ref));
        await batch.commit();
      }
    };

    const allRefs: any[] = [];
    
    // 1. Add the session document
    allRefs.push(doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId));
    
    // 2. Find related raw items
    const rawItemsQuery = query(collection(db, COLLECTIONS.UPLOAD_ITEMS_RAW), where('uploadId', '==', uploadId));
    const rawItemsSnap = await getDocs(rawItemsQuery);
    rawItemsSnap.forEach(d => allRefs.push(d.ref));
    
    // 3. Find related match reviews
    const reviewsQuery = query(collection(db, COLLECTIONS.MATCH_REVIEWS), where('uploadId', '==', uploadId));
    const reviewsSnap = await getDocs(reviewsQuery);
    reviewsSnap.forEach(d => allRefs.push(d.ref));

    // 4. Find related quotation items
    const qItemsQuery = query(collection(db, COLLECTIONS.QUOTATION_ITEMS), where('uploadId', '==', uploadId));
    const qItemsSnap = await getDocs(qItemsQuery);
    qItemsSnap.forEach(d => allRefs.push(d.ref));
    
    // Execute deletions in chunks
    await deleteBatch(allRefs);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${COLLECTIONS.SUPPLIER_UPLOADS}/${uploadId}`);
  }
}
