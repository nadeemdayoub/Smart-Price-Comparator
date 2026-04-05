import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit, 
  doc, 
  updateDoc,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { SupplierUpload } from '../types';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

const LOCAL_DRAFT_KEY = 'quotation_upload_draft';

export interface UploadDraft {
  supplierId: string;
  fileName: string;
  parsedRows: any[];
  mapping: Record<string, any>;
  defaultCurrency: string;
  step: 'upload' | 'mapping' | 'processing';
  timestamp: number;
}

/**
 * Loads the most recent active upload session for a user.
 * Active means status is 'draft', 'processing', or 'failed'.
 * 'ready_for_review' and 'needs_review' are handled by the review queue.
 */
export async function loadActiveUploadSession(ownerUserId: string | null): Promise<SupplierUpload | null> {
  const uploadsRef = collection(db, COLLECTIONS.SUPPLIER_UPLOADS);
  const q = ownerUserId 
    ? query(
        uploadsRef,
        where('ownerUserId', '==', ownerUserId),
        where('status', 'in', ['draft', 'processing', 'failed'])
      )
    : query(
        uploadsRef,
        where('status', 'in', ['draft', 'processing', 'failed'])
      );

  try {
    const snap = await getDocs(q);
    if (snap.empty) return null;
    
    // Sort in memory to avoid composite index requirement
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierUpload));
    docs.sort((a, b) => {
      const dateA = a.updatedAt instanceof Timestamp ? a.updatedAt.toMillis() : (a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : new Date(a.updatedAt || a.createdAt as any).getTime());
      const dateB = b.updatedAt instanceof Timestamp ? b.updatedAt.toMillis() : (b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : new Date(b.updatedAt || b.createdAt as any).getTime());
      return dateB - dateA;
    });

    return docs[0];
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.SUPPLIER_UPLOADS);
    return null;
  }
}

/**
 * Saves a local draft of the upload state before the actual Firestore session starts.
 */
export function saveLocalUploadDraft(ownerUserId: string | null, draft: Partial<UploadDraft>) {
  const identifier = ownerUserId || 'super_admin';
  const existing = loadLocalUploadDraft(ownerUserId) || {};
  const data = {
    ...existing,
    ...draft,
    ownerUserId,
    timestamp: Date.now()
  };
  localStorage.setItem(`${LOCAL_DRAFT_KEY}_${identifier}`, JSON.stringify(data));
}

/**
 * Loads a local draft for the current user.
 */
export function loadLocalUploadDraft(ownerUserId: string | null): UploadDraft | null {
  const identifier = ownerUserId || 'super_admin';
  const raw = localStorage.getItem(`${LOCAL_DRAFT_KEY}_${identifier}`);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    // Expire drafts older than 24 hours
    if (Date.now() - draft.timestamp > 24 * 60 * 60 * 1000) {
      clearLocalUploadDraft(ownerUserId);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

/**
 * Clears the local draft.
 */
export function clearLocalUploadDraft(ownerUserId: string | null) {
  const identifier = ownerUserId || 'super_admin';
  localStorage.removeItem(`${LOCAL_DRAFT_KEY}_${identifier}`);
}

/**
 * Updates the current step of an active upload session in Firestore.
 */
export async function markUploadStep(uploadId: string, currentStep: number) {
  const docRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId);
  try {
    await updateDoc(docRef, {
      currentStep,
      updatedAt: Timestamp.now()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${COLLECTIONS.SUPPLIER_UPLOADS}/${uploadId}`);
  }
}
