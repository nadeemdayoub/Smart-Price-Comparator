import { collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';

export interface PriceEntry {
  id: string;
  ownerUserId: string;
  canonicalProductId: string;
  supplierId: string;
  price: number;
  currency: string;
  effectiveDate: Timestamp | Date;
  createdAt: Timestamp | Date;
}

export interface SupplierPriceRank {
  supplierId: string;
  avgPrice: number;
  sampleCount: number;
}

export interface PriceChange {
  diff: number;
  percent: number;
  newPrice: number;
  oldPrice: number;
  effectiveDate: Date;
}

export interface PriceAnalytics {
  bestPrice: PriceEntry | null;
  averagePrice: number;
  supplierRanking: SupplierPriceRank[];
  lastPriceChange: PriceChange | null;
  totalSamples: number;
}

/**
 * Analyzes supplier price history for a specific canonical product.
 * Provides insights into best pricing, averages, and trends.
 */
export async function analyzeProductPrices(params: {
  ownerUserId: string;
  productId: string;
}): Promise<PriceAnalytics> {
  const { ownerUserId, productId } = params;

  const q = query(
    collection(db, COLLECTIONS.PRICE_ENTRIES),
    where('ownerUserId', '==', ownerUserId),
    where('canonicalProductId', '==', productId)
  );

  let snapshot;
  try {
    snapshot = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.PRICE_ENTRIES);
    return {
      bestPrice: null,
      averagePrice: 0,
      supplierRanking: [],
      lastPriceChange: null,
      totalSamples: 0
    };
  }
  const entries: PriceEntry[] = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as PriceEntry)).sort((a, b) => {
    const dateA = a.effectiveDate instanceof Timestamp ? a.effectiveDate.toMillis() : new Date(a.effectiveDate as any).getTime();
    const dateB = b.effectiveDate instanceof Timestamp ? b.effectiveDate.toMillis() : new Date(b.effectiveDate as any).getTime();
    return dateB - dateA; // Descending
  });

  if (entries.length === 0) {
    return {
      bestPrice: null,
      averagePrice: 0,
      supplierRanking: [],
      lastPriceChange: null,
      totalSamples: 0
    };
  }

  let totalPrice = 0;
  let minPriceEntry = entries[0];
  const supplierData = new Map<string, { sum: number; count: number }>();

  entries.forEach(entry => {
    totalPrice += entry.price;
    
    // Track the absolute best price found in history
    if (entry.price < minPriceEntry.price) {
      minPriceEntry = entry;
    }

    // Group data for supplier ranking
    const current = supplierData.get(entry.supplierId) || { sum: 0, count: 0 };
    supplierData.set(entry.supplierId, {
      sum: current.sum + entry.price,
      count: current.count + 1
    });
  });

  const averagePrice = totalPrice / entries.length;

  // Calculate average price per supplier and sort ascending (best first)
  const supplierRanking: SupplierPriceRank[] = Array.from(supplierData.entries())
    .map(([supplierId, data]) => ({
      supplierId,
      avgPrice: data.sum / data.count,
      sampleCount: data.count
    }))
    .sort((a, b) => a.avgPrice - b.avgPrice);

  // Calculate the most recent price change
  let lastPriceChange: PriceChange | null = null;
  if (entries.length >= 2) {
    const newest = entries[0];
    const previous = entries[1];
    const diff = newest.price - previous.price;
    const percent = previous.price !== 0 ? (diff / previous.price) * 100 : 0;
    
    lastPriceChange = {
      diff,
      percent,
      newPrice: newest.price,
      oldPrice: previous.price,
      effectiveDate: newest.effectiveDate instanceof Timestamp 
        ? newest.effectiveDate.toDate() 
        : new Date(newest.effectiveDate as any)
    };
  }

  return {
    bestPrice: minPriceEntry,
    averagePrice,
    supplierRanking,
    lastPriceChange,
    totalSamples: entries.length
  };
}
