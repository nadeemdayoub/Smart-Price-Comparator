import { 
  collection, 
  doc, 
  writeBatch, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { NormalizedUploadItem } from '../utils/uploadColumnMapping';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

export interface SaveUploadItemsParams {
  uploadId: string;
  ownerUserId: string;
  supplierId: string;
  items: NormalizedUploadItem[];
}

/**
 * Stores normalized upload rows in Firestore before matching starts.
 * Uses batched writes to handle large datasets efficiently.
 * 
 * @param params Parameters including upload session ID, user context, and normalized items.
 * @returns A promise resolving to an array of the created document IDs.
 */
export async function saveUploadItems(params: SaveUploadItemsParams): Promise<string[]> {
  const { uploadId, ownerUserId, supplierId, items } = params;
  
  if (items.length === 0) {
    return [];
  }

  const colRef = collection(db, COLLECTIONS.UPLOAD_ITEMS_RAW);
  const allIds: string[] = [];
  
  // Firestore batches have a limit of 500 operations
  const BATCH_LIMIT = 500;

  try {
    for (let i = 0; i < items.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      const chunk = items.slice(i, i + BATCH_LIMIT);
      
      chunk.forEach(item => {
        // Pre-generate document reference to get the ID before commit
        const newDocRef = doc(colRef);
        allIds.push(newDocRef.id);
        
        batch.set(newDocRef, {
          uploadId,
          ownerUserId,
          supplierId,
          rawName: item.rawName,
          rawCode: item.rawCode || null,
          rawPrice: item.rawPrice ?? null,
          rawCurrency: item.rawCurrency || null,
          rawQty: item.rawQty || null,
          rawRowData: item.rawRowData,
          status: "pending",
          createdAt: serverTimestamp(),
        });
      });
      
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, COLLECTIONS.UPLOAD_ITEMS_RAW);
  }

  return allIds;
}
