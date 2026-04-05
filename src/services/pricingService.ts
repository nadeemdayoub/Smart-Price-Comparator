import { 
  doc, 
  collection, 
  writeBatch, 
  serverTimestamp, 
  Timestamp,
  deleteDoc,
  updateDoc,
  setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { ExchangeRate, PriceEntry, MatchReview } from '../types';
import { sanitizeFirestoreData } from '../lib/firestore-utils';

/**
 * Unified currency conversion function.
 * Model: 1 USD = X units of foreign currency.
 * Formula: USD = price / rate.
 */
export function convertPrice(
  price: number | null | undefined, 
  currency: string | null | undefined, 
  rates: ExchangeRate[]
): number | null {
  if (price === null || price === undefined || isNaN(price)) return null;
  
  const upperCurrency = (currency || 'USD').trim().toUpperCase();
  if (upperCurrency === 'USD') return price;

  const rateObj = rates.find(r => 
    r.fromCurrency?.trim().toUpperCase() === 'USD' && 
    r.toCurrency?.trim().toUpperCase() === upperCurrency
  );

  if (!rateObj || !rateObj.rate || rateObj.rate === 0) {
    return null;
  }

  return price / rateObj.rate;
}

export interface SyncPriceEntryParams {
  ownerUserId: string;
  uploadId: string;
  supplierId: string;
  reviewId: string;
  productId: string | null;
  price: number | null;
  currency: string | null;
  status: string; // 'approved' | 'rejected' | 'pending' | etc.
  rates: ExchangeRate[];
  manualPriceInDefaultCurrency?: number | null;
}

/**
 * Synchronizes a PriceEntry record based on the MatchReview status.
 * This should be called atomically within a batch alongside MatchReview updates.
 * Uses reviewId as the PriceEntry document ID to ensure 1:1 mapping and deterministic updates.
 */
export function syncPriceEntry(
  batch: ReturnType<typeof writeBatch>,
  params: SyncPriceEntryParams
) {
  const {
    ownerUserId,
    uploadId,
    supplierId,
    reviewId,
    productId,
    price,
    currency,
    status,
    rates,
    manualPriceInDefaultCurrency
  } = params;

  const priceRef = doc(db, COLLECTIONS.PRICE_ENTRIES, reviewId);

  // 1. If status is NOT approved, delete any existing PriceEntry
  // We use 'approved' as the trigger for pricing data.
  if (status !== 'approved' || !productId) {
    batch.delete(priceRef);
    return;
  }

  // 2. If status IS approved, create or update PriceEntry
  const finalPrice = price ?? 0;
  const finalCurrency = currency || 'USD';

  // Calculate price in default currency (USD)
  const priceInDefaultCurrency = manualPriceInDefaultCurrency ?? (convertPrice(finalPrice, finalCurrency, rates) ?? finalPrice);

  const priceEntryData: any = {
    ownerUserId,
    supplierId,
    uploadId,
    reviewItemId: reviewId,
    canonicalProductId: productId,
    price: finalPrice,
    currency: finalCurrency,
    priceInDefaultCurrency: priceInDefaultCurrency,
    status: 'draft', // Default to draft until upload is finalized
    date: serverTimestamp(),
    effectiveDate: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  // Use set with merge: true to avoid overwriting fields we might add later, 
  // but here we want to enforce the full state.
  batch.set(priceRef, sanitizeFirestoreData(priceEntryData));
}
