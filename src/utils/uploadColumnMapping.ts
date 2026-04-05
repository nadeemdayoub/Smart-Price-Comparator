/**
 * Utility for flexible column mapping during file uploads.
 * This allows the system to handle various supplier file formats by mapping
 * columns to normalized fields before processing.
 */

export interface ColumnMapping {
  productNameColumn: string | null;
  priceColumn: string | null;
  skuColumn?: string | null;
  currencyColumn?: string | null;
  qtyColumn?: string | null;
}

export interface NormalizedUploadItem {
  rawName: string;
  rawCode?: string | null;
  rawPrice?: number | null;
  rawCurrency?: string | null;
  rawQty?: number | null;
  rawRowData: Record<string, any>;
}

/**
 * Inspects uploaded parsed rows and returns a list of available column keys.
 * Preserves order based on the first row if possible.
 */
export function extractColumnCandidates(rows: Record<string, any>[]): string[] {
  if (!rows || rows.length === 0) return [];
  
  // We use the first row to determine the keys and their order.
  // In most CSV/Excel parsers, Object.keys preserves the header order.
  return Object.keys(rows[0]);
}

/**
 * Safely parses a price value into a number.
 * Handles strings with currency symbols, commas, and whitespace.
 */
function parsePrice(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;

  // Remove common currency symbols and formatting characters
  // Keeps digits, decimal points, and minus signs
  const cleaned = value.replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  
  return isNaN(parsed) ? null : parsed;
}

/**
 * Safely parses a quantity value into a number.
 */
function parseQty(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;

  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Transforms raw parsed rows into normalized upload items based on the provided mapping.
 */
export function applyColumnMapping(
  rows: Record<string, any>[],
  mapping: ColumnMapping,
  uiFallbackCurrency: string | null,
  supplierDefaultCurrency?: string | null,
  globalDefaultCurrency: string = 'USD'
): NormalizedUploadItem[] {
  return rows.map((row) => {
    // Extract values based on mapping
    const rawName = mapping.productNameColumn ? String(row[mapping.productNameColumn] || '') : 'Unknown Product';
    const rawCode = mapping.skuColumn ? String(row[mapping.skuColumn] || '') : null;
    const rawPrice = mapping.priceColumn ? parsePrice(row[mapping.priceColumn]) : null;
    
    // Currency precedence: 
    // 1. Explicit row currency from mapped column
    // 2. User-selected UI fallback currency
    // 3. Supplier default currency
    // 4. Global default (USD)
    let rawCurrency = mapping.currencyColumn ? String(row[mapping.currencyColumn] || '').trim() : null;
    
    // If mapped column is empty or invalid, use fallbacks in order
    if (!rawCurrency || rawCurrency.length < 2) {
      rawCurrency = uiFallbackCurrency || supplierDefaultCurrency || globalDefaultCurrency;
    }

    const rawQty = mapping.qtyColumn ? parseQty(row[mapping.qtyColumn]) : null;

    return {
      rawName,
      rawCode,
      rawPrice,
      rawCurrency: rawCurrency,
      rawQty,
      rawRowData: row,
    };
  });
}
