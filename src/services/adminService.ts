import { 
  collection, 
  getDocs, 
  updateDoc, 
  doc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  where,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { UserProfile, SystemStats } from '../types';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

const USERS_COLLECTION = 'users';
const SYSTEM_STATS_DOC = 'system/stats';

export const adminService = {
  // Stats
  subscribeToStats: (callback: (stats: SystemStats | null) => void) => {
    return onSnapshot(doc(db, SYSTEM_STATS_DOC), (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data() as SystemStats);
      } else {
        callback(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, SYSTEM_STATS_DOC);
    });
  },

  // Users
  subscribeToUsers: (callback: (users: UserProfile[]) => void) => {
    const q = query(collection(db, USERS_COLLECTION), orderBy('email', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile));
      callback(users);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, USERS_COLLECTION);
    });
  },

  updateUserStatus: async (userId: string, status: 'active' | 'blocked' | 'pending') => {
    try {
      await updateDoc(doc(db, USERS_COLLECTION, userId), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${USERS_COLLECTION}/${userId}`);
    }
  },

  updateUserRole: async (userId: string, role: string) => {
    try {
      await updateDoc(doc(db, USERS_COLLECTION, userId), { role });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${USERS_COLLECTION}/${userId}`);
    }
  },

  deleteUser: async (userId: string) => {
    try {
      await deleteDoc(doc(db, USERS_COLLECTION, userId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${USERS_COLLECTION}/${userId}`);
    }
  },

  // Uploads (for stats)
  subscribeToUploads: (callback: (count: number) => void) => {
    return onSnapshot(collection(db, 'supplier_uploads'), (snapshot) => {
      callback(snapshot.size);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'supplier_uploads');
    });
  },

  // Price Entries (for stats/snapshots)
  subscribeToPriceEntries: (callback: (count: number) => void) => {
    return onSnapshot(collection(db, 'price_entries'), (snapshot) => {
      callback(snapshot.size);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'price_entries');
    });
  },

  // Match Reviews (for stats/comparisons)
  subscribeToMatchReviews: (callback: (count: number) => void) => {
    return onSnapshot(collection(db, 'match_reviews'), (snapshot) => {
      callback(snapshot.size);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'match_reviews');
    });
  },

  searchUsersByEmail: async (email: string): Promise<UserProfile[]> => {
    try {
      const q = query(
        collection(db, USERS_COLLECTION),
        where('email', '>=', email),
        where('email', '<=', email + '\uf8ff'),
        limit(5)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, USERS_COLLECTION);
      throw error;
    }
  },

  /**
   * Clears all quotation-related data for testing purposes.
   * WARNING: This is a destructive operation.
   */
  clearAllQuotationData: async (ownerUserId: string): Promise<void> => {
    const collectionsToClear = [
      COLLECTIONS.SUPPLIERS,
      COLLECTIONS.SUPPLIER_UPLOADS,
      COLLECTIONS.MATCH_REVIEWS,
      COLLECTIONS.PRICE_ENTRIES,
      COLLECTIONS.QUOTATION_ITEMS,
      COLLECTIONS.REJECTED_MATCHES,
      COLLECTIONS.MATCH_LEARNING,
      COLLECTIONS.PRODUCT_ALIASES
    ];

    for (const collectionName of collectionsToClear) {
      try {
        const q = query(collection(db, collectionName), where('ownerUserId', '==', ownerUserId));
        const snap = await getDocs(q);
        
        if (snap.empty) continue;

        const BATCH_SIZE = 400;
        let batch = writeBatch(db);
        let count = 0;

        for (const docSnap of snap.docs) {
          batch.delete(docSnap.ref);
          count++;
          if (count >= BATCH_SIZE) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) {
          await batch.commit();
        }
      } catch (error) {
        console.error(`Error clearing collection ${collectionName}:`, error);
        // Continue to next collection even if one fails
      }
    }
  }
};
