import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Product, ProductAlias } from '../types';
import { suggestProductMatch } from './geminiService';

export interface MatchResult {
  productId: string | null;
  confidence: number;
  reason: string;
  warnings: string[];
}

export async function findBestMatch(
  companyId: string,
  rawName: string,
  rawCode?: string,
  supplierId?: string
): Promise<MatchResult> {
  const normalizedRaw = rawName.toLowerCase().trim();

  // 1. Check Exact Alias Memory
  const aliasesRef = collection(db, 'product_aliases');
  const aliasQuery = query(
    aliasesRef, 
    where('companyId', '==', companyId),
    where('rawName', '==', rawName),
    where('isActive', '==', true)
  );
  const aliasSnap = await getDocs(aliasQuery);
  
  if (!aliasSnap.empty) {
    const alias = aliasSnap.docs[0].data() as ProductAlias;
    return {
      productId: alias.productId,
      confidence: 1.0,
      reason: "Exact match found in approved aliases.",
      warnings: []
    };
  }

  // 2. Check Internal Reference (SKU)
  if (rawCode) {
    const productsRef = collection(db, 'products');
    const codeQuery = query(
      productsRef,
      where('companyId', '==', companyId),
      where('internalReference', '==', rawCode)
    );
    const codeSnap = await getDocs(codeQuery);
    
    if (!codeSnap.empty) {
      return {
        productId: codeSnap.docs[0].id,
        confidence: 0.95,
        reason: "Matched via Internal Reference (SKU).",
        warnings: []
      };
    }
  }

  // 3. AI-Powered Matching (Fallback)
  // Fetch a subset of the catalog to provide context to Gemini
  // In a large catalog, we'd use vector search or keyword filtering first.
  const catalogSnap = await getDocs(query(collection(db, 'products'), where('companyId', '==', companyId)));
  const catalog = catalogSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const aiMatch = await suggestProductMatch(rawName, catalog);
  
  if (aiMatch) {
    return {
      productId: aiMatch.productId,
      confidence: aiMatch.confidence,
      reason: aiMatch.reason,
      warnings: aiMatch.warnings
    };
  }

  return {
    productId: null,
    confidence: 0,
    reason: "No match found.",
    warnings: ["Could not identify a suitable product in the catalog."]
  };
}
