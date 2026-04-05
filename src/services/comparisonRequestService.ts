import * as XLSX from 'xlsx';
import { runBulkMatching, BulkRawItem } from './bulkMatchingService';

export interface ComparisonMatchResult {
  rawName: string;
  rawBrand?: string;
  rawSku?: string;
  rawPrice?: number;
  rawCurrency?: string;
  matchedProductId: string | null;
  matchedProductName: string | null;
  confidence: number;
  warnings: string[];
  needsReview: boolean;
}

/**
 * Auto-detects specific columns from a list of headers based on keywords.
 */
function detectColumn(headers: string[], candidates: string[]): string | null {
  const normalizedHeaders = headers.map(h => ({
    original: h,
    normalized: h.toLowerCase().replace(/[^a-z0-9]/g, '')
  }));

  // Priority 1: Exact matches
  for (const candidate of candidates) {
    const match = normalizedHeaders.find(h => h.normalized === candidate);
    if (match) return match.original;
  }

  // Priority 2: Partial matches
  for (const candidate of candidates) {
    const match = normalizedHeaders.find(h => h.normalized.includes(candidate));
    if (match) return match.original;
  }

  return null;
}

/**
 * Processes a file for comparison request.
 * Parses the file, detects columns, and runs matching against canonical products.
 * Returns a list of results with matching information.
 * 
 * @param ownerUserId The ID of the user owning the data.
 * @param file The Excel or CSV file to process.
 * @returns A promise resolving to an array of comparison match results.
 */
export async function processComparisonRequestFile(
  ownerUserId: string,
  file: File
): Promise<ComparisonMatchResult[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rows = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];
        if (rows.length === 0) {
          resolve([]);
          return;
        }
        
        const headers = Object.keys(rows[0]);
        
        // Detect columns
        const nameCol = detectColumn(headers, ['productname', 'product', 'name', 'description', 'item', 'article', 'designation', 'produit', 'nom', 'libelle', 'desc', 'label']);
        const brandCol = detectColumn(headers, ['brand', 'marque', 'manufacturer', 'fabricant', 'vendor']);
        const skuCol = detectColumn(headers, ['sku', 'ref', 'code', 'internal', 'partnumber', 'mpn', 'reference', 'model']);
        const priceCol = detectColumn(headers, ['price', 'cost', 'unitprice', 'prix', 'tarif', 'amount', 'valeur']);
        const currencyCol = detectColumn(headers, ['currency', 'devise', 'monnaie', 'unit', 'unite']);
        
        if (!nameCol) {
          throw new Error('Could not detect product name column. Please ensure your file has a "Product Name" column.');
        }
        
        // Build raw items for matching
        const rawItems: (BulkRawItem & { brand?: string })[] = rows.map(row => ({
          rawName: String(row[nameCol] || '').trim(),
          rawCode: skuCol ? String(row[skuCol] || '').trim() : null,
          brand: brandCol ? String(row[brandCol] || '').trim() : undefined,
          rawPrice: priceCol ? Number(String(row[priceCol] || '').replace(/[^0-9.]/g, '')) : null,
          rawCurrency: currencyCol ? String(row[currencyCol] || '').trim().toUpperCase() : 'USD'
        })).filter(item => item.rawName.length > 0);
        
        // Run matching
        const matchResults = await runBulkMatching(ownerUserId, rawItems);
        
        // Map to ComparisonMatchResult
        const results: ComparisonMatchResult[] = matchResults.map(mr => {
          const best = mr.result.bestCandidate;
          
          const matchedProductId = best?.candidateProductId || null;
          const matchedProductName = best?.candidateName || null;
          const confidence = best ? best.score : 0;
          const warnings = best?.warnings || [];
          
          // Heuristic for needsReview: low confidence, blocked, or has warnings
          const needsReview = !matchedProductId || confidence < 0.85 || warnings.length > 0;
          
          return {
            rawName: mr.rawItem.rawName,
            rawBrand: (mr.rawItem as any).brand,
            rawSku: mr.rawItem.rawCode || undefined,
            rawPrice: mr.rawItem.rawPrice || undefined,
            rawCurrency: mr.rawItem.rawCurrency || undefined,
            matchedProductId,
            matchedProductName,
            confidence,
            warnings,
            needsReview
          };
        });
        
        resolve(results);
      } catch (err) {
        reject(err);
      }
    };
    
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
