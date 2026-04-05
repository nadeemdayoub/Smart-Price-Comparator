import CryptoJS from 'crypto-js';

/**
 * Normalizes a product name for matching.
 * 
 * Note: This implementation is optimized for English product catalogs for now 
 * and can be extended later for multi-language support.
 * 
 * Processing steps:
 * - convert to lowercase
 * - normalize separators (-, /, _, (, )) into spaces
 * - remove remaining special characters except letters and numbers
 * - replace multiple spaces with single space
 * - trim spaces
 */
export function normalizeProductName(rawName: string): string {
  if (!rawName) return '';
  
  return rawName
    .toLowerCase()
    // Normalize separators into spaces
    .replace(/[-/_()]/g, ' ')
    // Remove remaining special characters except letters, numbers, and spaces
    .replace(/[^a-z0-9\s]/g, ' ')
    // Replace multiple spaces with single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates search tokens used for product search and fuzzy matching.
 * 
 * Example input: "sony a7 iv body"
 * Example output: ["sony", "a7", "iv", "body", "sony a7", "a7 iv", "iv body", "sony a7 iv body"]
 */
export function generateSearchTokens(normalizedName: string): string[] {
  if (!normalizedName) return [];
  
  const words = normalizedName.split(' ').filter(w => w.length > 0);
  const unigrams = [...words];
  const bigrams: string[] = [];
  
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i+1]}`);
  }
  
  const tokens = [...unigrams, ...bigrams];
  
  // Include the full normalized phrase itself as a token
  if (normalizedName.trim()) {
    tokens.push(normalizedName.trim());
  }
  
  // Return unique tokens
  return Array.from(new Set(tokens));
}

/**
 * Data structure for signature generation.
 */
export interface ProductSignatureData {
  brand?: string;
  modelFamily?: string;
  capacity?: string;
  color?: string;
  version?: string;
}

/**
 * Generates a deterministic signature used to detect duplicate canonical products.
 * 
 * Combines: brand, modelFamily, capacity, color, version
 */
export function createSensitiveSignature(productData: ProductSignatureData): string {
  const {
    brand = '',
    modelFamily = '',
    capacity = '',
    color = '',
    version = ''
  } = productData;
  
  // Create a stable string representation by normalizing components
  const components = [
    brand.toLowerCase().trim(),
    modelFamily.toLowerCase().trim(),
    capacity.toLowerCase().trim(),
    color.toLowerCase().trim(),
    version.toLowerCase().trim()
  ];
  
  const stableString = components.join('|');
  
  // Generate a SHA-256 hashed string
  return CryptoJS.SHA256(stableString).toString();
}
