import { 
  collection, 
  query, 
  where, 
  getDocs, 
  FirestoreDataConverter,
  QueryDocumentSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { CanonicalProduct, ProductAlias, RejectedMatch } from '../types';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

/**
 * Generic converter for Firestore documents to ensure IDs are included
 * and data is correctly typed.
 */
const converter = <T>(): FirestoreDataConverter<T> => ({
  toFirestore: (data: any) => data,
  fromFirestore: (snapshot: QueryDocumentSnapshot) => ({
    id: snapshot.id,
    ...snapshot.data()
  } as T)
});

/**
 * Loads all active canonical products for a specific user.
 * 
 * @param ownerUserId The ID of the user to load products for.
 * @returns A promise resolving to an array of active CanonicalProduct objects.
 */
export async function loadCanonicalProducts(ownerUserId: string): Promise<CanonicalProduct[]> {
  const q = query(
    collection(db, COLLECTIONS.CANONICAL_PRODUCTS).withConverter(converter<CanonicalProduct>()),
    where('ownerUserId', '==', ownerUserId),
    where('status', '==', 'active')
  );
  
  try {
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.CANONICAL_PRODUCTS);
    return [];
  }
}

/**
 * Loads all product aliases for a specific user.
 * 
 * @param ownerUserId The ID of the user to load aliases for.
 * @returns A promise resolving to an array of ProductAlias objects.
 */
export async function loadProductAliases(ownerUserId: string): Promise<ProductAlias[]> {
  const q = query(
    collection(db, COLLECTIONS.PRODUCT_ALIASES).withConverter(converter<ProductAlias>()),
    where('ownerUserId', '==', ownerUserId)
  );
  
  try {
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.PRODUCT_ALIASES);
    return [];
  }
}

/**
 * Loads all rejected matches for a specific user.
 * 
 * @param ownerUserId The ID of the user to load rejected matches for.
 * @returns A promise resolving to an array of RejectedMatch objects.
 */
export async function loadRejectedMatches(ownerUserId: string): Promise<RejectedMatch[]> {
  const q = query(
    collection(db, COLLECTIONS.REJECTED_MATCHES).withConverter(converter<RejectedMatch>()),
    where('ownerUserId', '==', ownerUserId)
  );
  
  try {
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.REJECTED_MATCHES);
    return [];
  }
}

/**
 * Orchestrates loading all data required for the matching engine in a single call.
 * This is used to hydrate the matching context before processing supplier items.
 * 
 * @param ownerUserId The ID of the user to load data for.
 * @returns A structured object containing products, aliases, and rejected matches.
 */
export async function loadMatchingData(ownerUserId: string): Promise<{
  canonicalProducts: CanonicalProduct[];
  aliases: ProductAlias[];
  rejectedMatches: RejectedMatch[];
}> {
  const [canonicalProducts, aliases, rejectedMatches] = await Promise.all([
    loadCanonicalProducts(ownerUserId),
    loadProductAliases(ownerUserId),
    loadRejectedMatches(ownerUserId)
  ]);
  
  return {
    canonicalProducts,
    aliases,
    rejectedMatches
  };
}
