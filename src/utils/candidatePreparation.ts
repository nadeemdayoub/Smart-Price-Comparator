import { CanonicalProduct } from '../types';
import { CanonicalProductCandidate } from './candidateScoring';
import { normalizeProductName, generateSearchTokens } from './productNormalization';

/**
 * Converts a Firestore CanonicalProduct record into a CanonicalProductCandidate 
 * object used by the matching engine.
 * 
 * Ensures that normalizedName and searchTokens are populated even if missing 
 * in the source record.
 * 
 * @param product The canonical product record from Firestore.
 * @returns A prepared candidate object for the matching engine.
 */
export function prepareCandidate(product: CanonicalProduct): CanonicalProductCandidate {
  const normalizedName = product.normalizedName || normalizeProductName(product.canonicalName);
  
  // Use existing search tokens if available and non-empty, otherwise generate them
  const searchTokens = (product.searchTokens && product.searchTokens.length > 0)
    ? product.searchTokens
    : generateSearchTokens(normalizedName);

  return {
    id: product.id,
    canonicalName: product.canonicalName,
    normalizedName,
    internalReference: product.internalReference,
    brand: product.brand,
    modelFamily: product.modelFamily,
    searchTokens,
    // Structured danger fields
    capacity: product.capacity,
    packageType: product.packageType,
    typeClass: product.typeClass,
    color: product.color,
    version: product.version,
  };
}

/**
 * Converts an array of Firestore CanonicalProduct records into an array of 
 * CanonicalProductCandidate objects.
 * 
 * @param products List of canonical product records.
 * @returns List of prepared candidate objects.
 */
export function prepareCandidates(products: CanonicalProduct[]): CanonicalProductCandidate[] {
  return products.map(prepareCandidate);
}
