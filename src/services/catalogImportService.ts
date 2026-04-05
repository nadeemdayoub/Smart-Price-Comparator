import { 
  collection, 
  query, 
  where, 
  getDocs, 
  writeBatch, 
  doc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from './firestoreCollections';
import { handleFirestoreError, OperationType } from './firestoreErrorHandler';
import { CanonicalProduct, ProductAlias } from '../types';
import { 
  normalizeProductName, 
  generateSearchTokens, 
  createSensitiveSignature 
} from '../utils/productNormalization';
import { sanitizeFirestoreData } from '../lib/firestore-utils';

export interface CatalogColumnMapping {
  productNameColumn: string | null;
  brandColumn?: string | null;
  costColumn?: string | null;
  quantityColumn?: string | null;
  skuColumn?: string | null;
  categoryColumn?: string | null;
}

export interface ImportSummary {
  createdProducts: number;
  updatedProducts: number;
  skippedDuplicates: number;
  createdAliases: number;
}

/**
 * Safely parses a numeric value.
 */
function parseNumber(value: any): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(String(value).replace(/[^\d.-]/g, ''));
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Imports a product catalog from raw rows.
 */
export async function importCatalog(
  ownerUserId: string,
  rows: any[],
  mapping: CatalogColumnMapping
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    createdProducts: 0,
    updatedProducts: 0,
    skippedDuplicates: 0,
    createdAliases: 0
  };

  if (!rows.length) return summary;

  // 0. Pre-analyze rows to see if SKU column is actually a brand
  let skuIsActuallyBrand = false;
  if (mapping.skuColumn) {
    const skuValues = rows.map(r => String(r[mapping.skuColumn!] || '').trim()).filter(Boolean);
    if (skuValues.length > 5) {
      const skuCounts = new Map<string, number>();
      skuValues.forEach(v => skuCounts.set(v, (skuCounts.get(v) || 0) + 1));
      
      const maxCount = Math.max(...Array.from(skuCounts.values()));
      const uniqueCount = skuCounts.size;
      
      // If any value repeats significantly (more than 3 times) 
      // AND unique values are less than 30% of total rows, it's likely a brand
      if (maxCount > 3 && uniqueCount < skuValues.length * 0.3) {
        skuIsActuallyBrand = true;
      }
    }
  }

  // 1. Fetch existing canonical products for duplicate detection
  const productsRef = collection(db, COLLECTIONS.CANONICAL_PRODUCTS);
  const q = query(productsRef, where('ownerUserId', '==', ownerUserId));
  
  let snapshot;
  try {
    snapshot = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, COLLECTIONS.CANONICAL_PRODUCTS);
    throw error; // Re-throw to inform the caller
  }
  
  const existingProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CanonicalProduct));
  
  // Maps for quick lookup
  const bySignature = new Map<string, CanonicalProduct>();
  const byRef = new Map<string, CanonicalProduct>();
  const byNameAndBrand = new Map<string, CanonicalProduct>();

  existingProducts.forEach(p => {
    if (p.sensitiveSignature) bySignature.set(p.sensitiveSignature, p);
    if (p.internalReference) {
      byRef.set(p.internalReference.toLowerCase().trim(), p);
    }
    
    const nameBrandKey = `${p.normalizedName}|${(p.brand || '').toLowerCase().trim()}`;
    byNameAndBrand.set(nameBrandKey, p);
  });

  // Helper for safe normalized-name matching scoped by brand
  const findExistingByNormalizedNameAndBrand = (name: string, brandName?: string) => {
    const key = `${name}|${(brandName || '').toLowerCase().trim()}`;
    return byNameAndBrand.get(key);
  };

  // 2. Process rows in batches
  const BATCH_SIZE = 400; // Firestore limit is 500, keeping it safe
  let currentBatch = writeBatch(db);
  let batchCount = 0;

  const commitBatch = async () => {
    if (batchCount > 0) {
      try {
        await currentBatch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'catalog_import_batch');
        throw error; // Re-throw to stop the import loop
      }
      currentBatch = writeBatch(db);
      batchCount = 0;
    }
  };

  for (const row of rows) {
    const rawName = mapping.productNameColumn ? String(row[mapping.productNameColumn] || '').trim() : '';
    if (!rawName) continue;

    let brand = mapping.brandColumn ? String(row[mapping.brandColumn] || '').trim() : undefined;
    const cost = mapping.costColumn ? parseNumber(row[mapping.costColumn]) : undefined;
    const qty = mapping.quantityColumn ? parseNumber(row[mapping.quantityColumn]) : undefined;
    const sku = mapping.skuColumn ? String(row[mapping.skuColumn] || '').trim() : undefined;
    const category = mapping.categoryColumn ? String(row[mapping.categoryColumn] || '').trim() : undefined;

    // If SKU column is actually brand, use it as brand if brand is missing
    if (skuIsActuallyBrand && sku && !brand) {
      brand = sku;
    }

    // If SKU is actually brand, don't use it as a unique SKU for duplicate detection
    const effectiveSku = skuIsActuallyBrand ? undefined : sku;

    const normalizedName = normalizeProductName(rawName);
    const signature = createSensitiveSignature({
      brand,
      modelFamily: normalizedName // Include name in signature to ensure uniqueness per brand+name
    });

    // Duplicate detection
    let existing: CanonicalProduct | undefined;
    
    if (effectiveSku) {
      // Priority 1: SKU (Only if truly unique/not a brand)
      existing = byRef.get(effectiveSku.toLowerCase().trim());
      
      // Priority 2: Sensitive Signature (Brand + Name + Variants)
      if (!existing) {
        existing = bySignature.get(signature);
      }
      
      // Priority 3: Normalized Name (Only if brand matches)
      if (!existing) {
        existing = findExistingByNormalizedNameAndBrand(normalizedName, brand);
      }
    } else {
      // Priority 1: Sensitive Signature (Brand + Name + Variants)
      existing = bySignature.get(signature);
      
      // Priority 2: Normalized Name (Only if brand matches)
      if (!existing) {
        existing = findExistingByNormalizedNameAndBrand(normalizedName, brand);
      }
    }

    if (existing) {
      // Update existing
      const updates: Partial<CanonicalProduct> = {
        updatedAt: serverTimestamp()
      };

      if (cost !== undefined) updates.costPrice = cost;
      if (qty !== undefined) updates.stockQty = qty;
      if (brand && !existing.brand) updates.brand = brand;
      if (sku && !existing.internalReference) updates.internalReference = sku;
      if (category) updates.category = category;

      const productRef = doc(db, COLLECTIONS.CANONICAL_PRODUCTS, existing.id);
      currentBatch.update(productRef, sanitizeFirestoreData(updates));
      summary.updatedProducts++;
    } else {
      // Create new
      const productId = doc(collection(db, COLLECTIONS.CANONICAL_PRODUCTS)).id;
      const newProduct: CanonicalProduct = {
        id: productId,
        ownerUserId,
        canonicalName: rawName,
        normalizedName,
        brand,
        category,
        internalReference: sku,
        searchTokens: generateSearchTokens(normalizedName),
        sensitiveSignature: signature,
        status: 'active',
        costPrice: cost,
        stockQty: qty,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const productRef = doc(db, COLLECTIONS.CANONICAL_PRODUCTS, productId);
      currentBatch.set(productRef, sanitizeFirestoreData(newProduct));
      summary.createdProducts++;

      // Also create an alias
      const aliasId = doc(collection(db, COLLECTIONS.PRODUCT_ALIASES)).id;
      const newAlias: Partial<ProductAlias> = {
        ownerUserId,
        productId,
        aliasText: rawName,
        normalizedAlias: normalizedName,
        sourceType: 'manual',
        createdAt: serverTimestamp()
      };
      
      const aliasRef = doc(db, COLLECTIONS.PRODUCT_ALIASES, aliasId);
      currentBatch.set(aliasRef, sanitizeFirestoreData(newAlias));
      summary.createdAliases++;
      
      // Add to local maps to prevent duplicates within the same import
      const nameBrandKey = `${normalizedName}|${(brand || '').toLowerCase().trim()}`;
      byNameAndBrand.set(nameBrandKey, { ...newProduct, id: productId });
      bySignature.set(signature, { ...newProduct, id: productId });
      if (sku) {
        byRef.set(sku.toLowerCase().trim(), { ...newProduct, id: productId });
      }
    }

    batchCount++;
    if (batchCount >= BATCH_SIZE) {
      await commitBatch();
    }
  }

  await commitBatch();

  return summary;
}
