import { 
  collection, 
  query, 
  where, 
  getDocs, 
  getDoc, 
  doc, 
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { MatchReview } from '../types';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

/**
 * Loads all match review records for a specific upload.
 * 
 * Approach for stable ordering:
 * We use 'createdAt' ascending. This ensures that items appear in the order 
 * they were processed by the matching pipeline, providing a consistent 
 * sequence for the reviewer.
 * 
 * @param ownerUserId The ID of the user.
 * @param uploadId The ID of the supplier upload.
 * @returns A promise resolving to an array of MatchReview records.
 */
export async function loadMatchReviewsByUpload(
  ownerUserId: string, 
  uploadId: string
): Promise<MatchReview[]> {
  const reviewsRef = collection(db, COLLECTIONS.MATCH_REVIEWS);
  const q = query(
    reviewsRef,
    where('ownerUserId', '==', ownerUserId),
    where('uploadId', '==', uploadId)
  );

  try {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as MatchReview)).sort((a, b) => {
      const dateA = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : new Date(a.createdAt as any).getTime();
      const dateB = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : new Date(b.createdAt as any).getTime();
      return dateA - dateB; // Ascending
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.MATCH_REVIEWS);
    return [];
  }
}

/**
 * Loads only pending match review records for a specific upload.
 * 
 * @param ownerUserId The ID of the user.
 * @param uploadId The ID of the supplier upload.
 * @returns A promise resolving to an array of pending MatchReview records.
 */
export async function loadPendingMatchReviewsByUpload(
  ownerUserId: string, 
  uploadId: string
): Promise<MatchReview[]> {
  const reviewsRef = collection(db, COLLECTIONS.MATCH_REVIEWS);
  const q = query(
    reviewsRef,
    where('ownerUserId', '==', ownerUserId),
    where('uploadId', '==', uploadId),
    where('reviewStatus', '==', 'pending')
  );

  try {
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as MatchReview)).sort((a, b) => {
      const dateA = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : new Date(a.createdAt as any).getTime();
      const dateB = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : new Date(b.createdAt as any).getTime();
      return dateA - dateB; // Ascending
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.MATCH_REVIEWS);
    return [];
  }
}

/**
 * Loads a single match review record by its ID.
 * 
 * @param reviewId The ID of the match review record.
 * @returns A promise resolving to the MatchReview record or null if not found.
 */
export async function loadMatchReviewById(
  reviewId: string
): Promise<MatchReview | null> {
  const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, reviewId);
  try {
    const docSnap = await getDoc(reviewRef);

    if (!docSnap.exists()) {
      return null;
    }

    return {
      id: docSnap.id,
      ...docSnap.data()
    } as MatchReview;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.MATCH_REVIEWS);
    return null;
  }
}
