import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, orderBy, limit, Timestamp, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { CanonicalProduct, Supplier, PriceEntry } from '../types';
import { COLLECTIONS } from '../services/firestoreCollections';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { 
  Search, 
  Filter, 
  ArrowUpDown, 
  Upload, 
  Plus, 
  X, 
  ChevronDown, 
  TrendingDown, 
  TrendingUp, 
  Package, 
  Building2,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Check,
  XCircle,
  Loader2,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatSnapshotDate } from '../lib/utils';
import { processComparisonRequestFile, ComparisonMatchResult } from '../services/comparisonRequestService';
import { matchesSearch, highlightSearchText } from '../lib/search';

import { loadPageState, savePageState, clearPageState } from '../services/persistenceService';
import * as XLSX from 'xlsx';

interface ComparisonSource {
  type: 'supplier' | 'catalog' | 'upload';
  id: string; // supplierId or 'catalog' or 'upload'
  uploadId?: string; // specific snapshot
  name: string;
  dateLabel?: string;
  sourceKey: string; // Unique key for this source instance
}

interface ComparisonPrice {
  rawPrice: number;
  currency: string;
  usdPrice: number;
}

interface ComparisonRow {
  productId: string;
  productName: string;
  brand?: string;
  prices: Record<string, ComparisonPrice>; // sourceKey -> ComparisonPrice
  bestPriceUSD?: number;
  bestSourceKey?: string;
  worstPriceUSD?: number;
  worstSourceKey?: string;
  priceDiffPercent?: number;
  sourceCount: number;
}

// Helper functions for product matching
function scoreProduct(product: CanonicalProduct, keywords: string[], brand?: string) {
  let score = 0;
  const nameLower = product.canonicalName.toLowerCase();

  keywords.forEach(k => {
    if (!k || k.length < 2) return;
    const kLower = k.toLowerCase();
    if (nameLower.includes(kLower)) {
      // Higher score for exact word match vs partial
      // Escape special characters to avoid invalid regex
      const escapedK = kLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isExactWord = new RegExp(`\\b${escapedK}\\b`).test(nameLower);
      score += isExactWord ? 5 : 3;
    }
  });

  if (product.brand && brand && product.brand.toLowerCase() === brand.toLowerCase()) {
    score += 10; // High priority for brand match
  }

  return score;
}

const SupplierComparison: React.FC = () => {
  const { profile } = useAuth();
  const [mode, setMode] = useState<'catalog' | 'upload'>('catalog');
  const [loading, setLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [allProducts, setAllProducts] = useState<CanonicalProduct[]>([]);
  const [priceEntries, setPriceEntries] = useState<PriceEntry[]>([]);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  
  // Selection
  const [selectedSources, setSelectedSources] = useState<ComparisonSource[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [uploadResults, setUploadResults] = useState<ComparisonMatchResult[]>([]);
  const [supplierUploads, setSupplierUploads] = useState<Record<string, any[]>>({});
  
  // UI State
  const [searchTerm, setSearchTerm] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'bestPrice' | 'diff'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isProductSelectorOpen, setIsProductSelectorOpen] = useState(false);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [reviewingIndex, setReviewingIndex] = useState<number | null>(null);

  const extractedKeywords = useMemo(() => {
    const source = reviewingIndex !== null 
      ? uploadResults[reviewingIndex].rawName 
      : modalSearchTerm;
    
    if (!source) return [];
    
    // Extract words that look like models or codes
    const words = source.split(/[\s,._/]+/).filter(w => w.length >= 2);
    const codes = source.match(/[A-Z0-9-]{2,}/g) || [];
    
    return Array.from(new Set([...words, ...codes, modalSearchTerm].filter(w => w && w.length >= 2)));
  }, [reviewingIndex, uploadResults, modalSearchTerm]);

  const suggestedProducts = useMemo(() => {
    if (reviewingIndex === null || !allProducts.length) return [];
    
    const rawItem = uploadResults[reviewingIndex];
    
    return allProducts
      .map(p => ({
        product: p,
        score: scoreProduct(p, extractedKeywords, rawItem.rawBrand)
      }))
      .filter(item => item.score > 5) // Minimum threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(item => item.product);
  }, [reviewingIndex, uploadResults, allProducts, extractedKeywords]);

  const renderProductCard = (p: CanonicalProduct) => (
    <button
      key={p.id}
      onClick={() => handleProductSelect(p.id)}
      className={cn(
        "flex items-center justify-between p-4 rounded-2xl border transition-all text-left group",
        (mode === 'catalog' && selectedProductIds.includes(p.id))
          ? "bg-stone-900 border-stone-900 text-white shadow-lg shadow-stone-900/20"
          : "bg-white border-stone-100 hover:border-stone-300 text-stone-700"
      )}
    >
      <div className="space-y-1 flex-1 min-w-0 pr-4">
        <div 
          className="text-sm font-bold line-clamp-3 leading-snug" 
          title={p.canonicalName}
        >
          {highlightSearchText(p.canonicalName, modalSearchTerm)}
        </div>
        <p className={cn("text-[10px] font-bold uppercase", (mode === 'catalog' && selectedProductIds.includes(p.id)) ? "text-stone-300" : "text-stone-400")}>
          {highlightSearchText(p.brand || 'No Brand', modalSearchTerm)}
        </p>
      </div>
      {(mode === 'catalog' && selectedProductIds.includes(p.id)) && <CheckCircle2 className="w-4 h-4 text-white" />}
    </button>
  );
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [snapshotSupplier, setSnapshotSupplier] = useState<Supplier | null>(null);
  const [isUploadReviewModalOpen, setIsUploadReviewModalOpen] = useState(false);
  const [selectedUploadItems, setSelectedUploadItems] = useState<Set<number>>(new Set());
  const [excludedUploadItems, setExcludedUploadItems] = useState<Set<number>>(new Set());
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [newProductData, setNewProductData] = useState({
    canonicalName: '',
    brand: '',
    category: '',
    costPrice: 0,
    internalReference: ''
  });

  // 1. Initial Data Fetch
  useEffect(() => {
    if (!profile?.uid) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [suppliersSnap, productsSnap, uploadsSnap, ratesSnap] = await Promise.all([
          getDocs(query(collection(db, COLLECTIONS.SUPPLIERS), where('ownerUserId', '==', profile.uid))),
          getDocs(query(collection(db, COLLECTIONS.CANONICAL_PRODUCTS), where('ownerUserId', '==', profile.uid), where('status', '==', 'active'))),
          getDocs(query(collection(db, COLLECTIONS.SUPPLIER_UPLOADS), where('ownerUserId', '==', profile.uid), where('status', '==', 'finalized'))),
          getDocs(query(collection(db, COLLECTIONS.EXCHANGE_RATES), where('ownerUserId', '==', profile.uid)))
        ]);

        const fetchedSuppliers = suppliersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier));
        setSuppliers(fetchedSuppliers);
        setAllProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as CanonicalProduct)));
        
        const rates: Record<string, number> = {};
        ratesSnap.docs.forEach(d => {
          const data = d.data();
          rates[data.currencyCode] = data.rateToBase;
        });
        setExchangeRates(rates);

        const uploadsMap: Record<string, any[]> = {};
        const sortedUploads = uploadsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        
        // Sort in memory to avoid composite index requirement
        sortedUploads.sort((a: any, b: any) => {
          const dateA = a.finalizedAt instanceof Timestamp ? a.finalizedAt.toMillis() : new Date(a.finalizedAt as any).getTime();
          const dateB = b.finalizedAt instanceof Timestamp ? b.finalizedAt.toMillis() : new Date(b.finalizedAt as any).getTime();
          return dateB - dateA;
        });

        sortedUploads.forEach(data => {
          if (!uploadsMap[data.supplierId]) uploadsMap[data.supplierId] = [];
          uploadsMap[data.supplierId].push(data);
        });
        setSupplierUploads(uploadsMap);

        // Restore state after data is loaded
        const savedState = loadPageState('supplier_comparison', profile.uid);
        if (savedState) {
          if (savedState.mode) setMode(savedState.mode);
          if (savedState.selectedSources) setSelectedSources(savedState.selectedSources);
          if (savedState.selectedProductIds) setSelectedProductIds(savedState.selectedProductIds);
          if (savedState.searchTerm) setSearchTerm(savedState.searchTerm);
          if (savedState.brandFilter) setBrandFilter(savedState.brandFilter);
          if (savedState.sortBy) setSortBy(savedState.sortBy);
          if (savedState.sortOrder) setSortOrder(savedState.sortOrder);
          if (savedState.uploadResults) setUploadResults(savedState.uploadResults);
        }
        setIsInitialized(true);
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, 'multiple_collections');
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to load comparison data."));
        }
        console.error("Error fetching comparison data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [profile?.uid]);

  // Persistence Effect
  useEffect(() => {
    if (!profile?.uid || !isInitialized) return;
    savePageState('supplier_comparison', profile.uid, {
      mode,
      selectedSources,
      selectedProductIds,
      searchTerm,
      brandFilter,
      sortBy,
      sortOrder,
      uploadResults
    });
  }, [mode, selectedSources, selectedProductIds, searchTerm, brandFilter, sortBy, sortOrder, uploadResults, profile?.uid, isInitialized]);

  // 2. Fetch Prices when selection changes
  useEffect(() => {
    if (!profile?.uid) return;
    
    const targetProductIds = mode === 'catalog' 
      ? selectedProductIds 
      : uploadResults.map(r => r.matchedProductId).filter((id): id is string => !!id);

    if (targetProductIds.length === 0 || selectedSources.length === 0) {
      setPriceEntries([]);
      return;
    }

    const fetchPrices = async () => {
      try {
        // We fetch all price entries for the selected suppliers to keep it simple
        // but we'll filter them in the useMemo based on uploadId if specified.
        const supplierIds = selectedSources
          .filter(s => s.type === 'supplier')
          .map(s => s.id);

        if (supplierIds.length === 0) {
          setPriceEntries([]);
          return;
        }

        const q = query(
          collection(db, COLLECTIONS.PRICE_ENTRIES),
          where('ownerUserId', '==', profile.uid),
          where('supplierId', 'in', supplierIds),
          where('status', '==', 'finalized')
        );
        
        const snap = await getDocs(q);
        setPriceEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as PriceEntry)));
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, COLLECTIONS.PRICE_ENTRIES);
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to fetch prices."));
        }
        console.error("Error fetching prices:", err);
      }
    };

    fetchPrices();
  }, [profile?.uid, selectedProductIds, uploadResults, mode, selectedSources]);

  // 3. File Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && profile?.uid) {
      setLoading(true);
      try {
        const results = await processComparisonRequestFile(profile.uid, e.target.files[0]);
        setUploadResults(results);
        setIsUploadReviewModalOpen(true);
      } catch (err) {
        console.error("Upload failed:", err);
        alert("Failed to process file. Please check the format.");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleProductSelect = (productId: string) => {
    if (mode === 'catalog') {
      if (selectedProductIds.includes(productId)) {
        setSelectedProductIds(selectedProductIds.filter(id => id !== productId));
      } else {
        setSelectedProductIds([...selectedProductIds, productId]);
      }
    } else if (reviewingIndex !== null) {
      const product = allProducts.find(p => p.id === productId);
      if (product) {
        setUploadResults(prev => {
          const next = [...prev];
          next[reviewingIndex] = {
            ...next[reviewingIndex],
            matchedProductId: product.id,
            matchedProductName: product.canonicalName,
            needsReview: false, // Mark as reviewed after manual selection
            confidence: 1.0
          };
          return next;
        });
        setReviewingIndex(null);
        setIsProductSelectorOpen(false);
      }
    }
  };

  const handleCreateProduct = async () => {
    if (!profile?.uid || !newProductData.canonicalName) return;
    
    setLoading(true);
    try {
      const normalizedName = newProductData.canonicalName.toLowerCase().trim();
      const searchTokens = normalizedName.split(/[\s,._/]+/).filter(t => t.length > 1);
      
      const productData: any = {
        ownerUserId: profile.uid,
        canonicalName: newProductData.canonicalName,
        normalizedName,
        brand: newProductData.brand,
        category: newProductData.category,
        internalReference: newProductData.internalReference,
        searchTokens,
        sensitiveSignature: `${newProductData.brand || ''}_${normalizedName}`,
        costPrice: Number(newProductData.costPrice) || 0,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      const docRef = await addDoc(collection(db, COLLECTIONS.CANONICAL_PRODUCTS), productData);
      const newProduct = { id: docRef.id, ...productData } as CanonicalProduct;
      
      // Update local state
      setAllProducts(prev => [...prev, newProduct]);
      
      // If we were reviewing an upload item, match it automatically
      if (reviewingIndex !== null) {
        setUploadResults(prev => {
          const next = [...prev];
          next[reviewingIndex] = {
            ...next[reviewingIndex],
            matchedProductId: newProduct.id,
            matchedProductName: newProduct.canonicalName,
            needsReview: true,
            confidence: 1.0
          };
          return next;
        });
        setReviewingIndex(null);
      }
      
      setIsCreatingProduct(false);
      setNewProductData({
        canonicalName: '',
        brand: '',
        category: '',
        costPrice: 0,
        internalReference: ''
      });
    } catch (err) {
      console.error("Error creating product:", err);
      alert("Failed to create product.");
    } finally {
      setLoading(false);
    }
  };

  const resetComparison = () => {
    // Note: confirm() is avoided in iframe environments
    setSelectedSources([]);
    setSelectedProductIds([]);
    setUploadResults([]);
    setSearchTerm('');
    setBrandFilter('all');
    setSortBy('name');
    setSortOrder('asc');
    setMode('catalog');
    if (profile?.uid) {
      clearPageState('supplier_comparison', profile.uid);
    }
  };

  const handleExportExcel = () => {
    if (comparisonData.length === 0) return;

    const worksheetData = comparisonData.map(row => {
      const rowData: any = {
        'Product Name': row.productName,
        'Brand': row.brand || 'N/A',
      };

      selectedSources.forEach(source => {
        const price = row.prices[source.sourceKey];
        rowData[source.name] = price ? `${price.rawPrice} ${price.currency}` : 'N/A';
        rowData[`${source.name} (USD)`] = price ? price.usdPrice.toFixed(2) : 'N/A';
      });

      rowData['Best Source'] = row.bestSourceKey ? selectedSources.find(s => s.sourceKey === row.bestSourceKey)?.name : 'N/A';
      rowData['Best Price (USD)'] = row.bestPriceUSD ? row.bestPriceUSD.toFixed(2) : 'N/A';
      rowData['Price Variance (USD)'] = (row.worstPriceUSD && row.bestPriceUSD) ? (row.worstPriceUSD - row.bestPriceUSD).toFixed(2) : 'N/A';
      rowData['Difference %'] = row.priceDiffPercent ? `${row.priceDiffPercent.toFixed(2)}%` : 'N/A';

      return rowData;
    });

    const ws = XLSX.utils.json_to_sheet(worksheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparison');

    // Summary Sheet
    const summaryData = [
      ['Comparison Summary'],
      ['Export Timestamp', new Date().toLocaleString()],
      ['Total Products Compared', summaryStats.totalProducts],
      ['Suppliers Selected', selectedSources.filter(s => s.type === 'supplier').map(s => s.name).join(', ')],
      ['Best Overall Supplier', summaryStats.bestOverallSource],
      ['Average Lowest Price (USD)', (summaryStats.avgLowestPrice || 0).toFixed(2)],
      ['Average Price Spread', `${(summaryStats.avgSpread || 0).toFixed(2)}%`]
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    const fileName = `comparison_${new Date().toISOString().split('T')[0]}_${new Date().getHours()}-${new Date().getMinutes()}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // 4. Comparison Logic
  const comparisonData = useMemo(() => {
    const targetItems = mode === 'catalog'
      ? selectedProductIds.map(id => {
          const p = allProducts.find(ap => ap.id === id);
          return p ? { product: p, rowId: `catalog_${p.id}` } : null;
        }).filter((item): item is { product: CanonicalProduct; rowId: string } => !!item)
      : uploadResults.map((res, idx) => {
          const p = allProducts.find(ap => ap.id === res.matchedProductId);
          return p ? { 
            product: { ...p, canonicalName: res.matchedProductName || p.canonicalName },
            rowId: `upload_${idx}`,
            uploadResult: res
          } : null;
        }).filter((item): item is { product: CanonicalProduct; rowId: string; uploadResult: ComparisonMatchResult } => !!item);

    const rows: (ComparisonRow & { rowId: string })[] = targetItems.map(item => {
      const { product } = item;
      const prices: Record<string, ComparisonPrice> = {};
      let bestPriceUSD = Infinity;
      let bestSourceKey = '';
      let worstPriceUSD = -Infinity;
      let sourceCount = 0;

      selectedSources.forEach((source) => {
        const sourceKey = source.sourceKey;
        let priceData: ComparisonPrice | undefined;

        if (source.type === 'catalog') {
          priceData = {
            rawPrice: product.costPrice,
            currency: 'USD',
            usdPrice: product.costPrice
          };
        } else if (source.type === 'upload') {
          const uploadResult = (item as any).uploadResult;
          if (uploadResult && uploadResult.rawPrice) {
            priceData = {
              rawPrice: uploadResult.rawPrice,
              currency: uploadResult.rawCurrency || 'USD',
              usdPrice: uploadResult.rawPrice / (exchangeRates[uploadResult.rawCurrency || 'USD'] || 1)
            };
          }
        } else {
          // Find matching price entry
          const entries = priceEntries.filter(pe => 
            pe.canonicalProductId === product.id && 
            pe.supplierId === source.id
          );

          let entry: PriceEntry | undefined;
          if (source.uploadId) {
            entry = entries.find(pe => pe.uploadId === source.uploadId);
          } else {
            // Get latest
            entry = entries.sort((a, b) => {
              const dateA = a.effectiveDate instanceof Timestamp ? a.effectiveDate.toMillis() : new Date(a.effectiveDate as any).getTime();
              const dateB = b.effectiveDate instanceof Timestamp ? b.effectiveDate.toMillis() : new Date(b.effectiveDate as any).getTime();
              return dateB - dateA;
            })[0];
          }

          if (entry) {
            let usdPrice = entry.priceInDefaultCurrency;
            
            // Fallback calculation if priceInDefaultCurrency is missing or 0
            if ((!usdPrice || usdPrice === 0) && entry.currency !== 'USD') {
              const rate = exchangeRates[entry.currency];
              if (rate && rate > 0) {
                usdPrice = entry.price / rate;
              }
            } else if (!usdPrice && entry.currency === 'USD') {
              usdPrice = entry.price;
            }

            priceData = {
              rawPrice: entry.price,
              currency: entry.currency,
              usdPrice: usdPrice || 0
            };
          }
        }

        if (priceData) {
          prices[sourceKey] = priceData;
          sourceCount++;
          if (priceData.usdPrice < bestPriceUSD) {
            bestPriceUSD = priceData.usdPrice;
            bestSourceKey = sourceKey;
          }
          if (priceData.usdPrice > worstPriceUSD) {
            worstPriceUSD = priceData.usdPrice;
          }
        }
      });

      return {
        rowId: item.rowId,
        productId: product.id,
        productName: product.canonicalName,
        brand: product.brand,
        prices,
        bestPriceUSD: bestPriceUSD === Infinity ? undefined : bestPriceUSD,
        bestSourceKey: bestSourceKey || undefined,
        worstPriceUSD: worstPriceUSD === -Infinity ? undefined : worstPriceUSD,
        priceDiffPercent: (bestPriceUSD !== Infinity && worstPriceUSD !== -Infinity && worstPriceUSD !== bestPriceUSD)
          ? ((worstPriceUSD - bestPriceUSD) / bestPriceUSD) * 100
          : undefined,
        sourceCount
      };
    });

    // Apply Search & Filter
    let filtered = rows.filter(row => 
      (matchesSearch(row.productName, searchTerm) || matchesSearch(row.brand, searchTerm)) &&
      (brandFilter === 'all' || row.brand === brandFilter)
    );

    // Apply Sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = (a.productName || '').localeCompare(b.productName || '');
      } else if (sortBy === 'bestPrice') {
        comparison = (a.bestPriceUSD || 999999) - (b.bestPriceUSD || 999999);
      } else if (sortBy === 'diff') {
        comparison = (b.priceDiffPercent || 0) - (a.priceDiffPercent || 0);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [mode, allProducts, selectedProductIds, uploadResults, selectedSources, priceEntries, searchTerm, brandFilter, sortBy, sortOrder, exchangeRates]);

  const brands = useMemo(() => {
    const b = new Set(allProducts.map(p => p.brand).filter(Boolean));
    return ['all', ...Array.from(b)];
  }, [allProducts]);

  const leaderboard = useMemo(() => {
    const stats: Record<string, { wins: number; totalItems: number; totalPriceUSD: number }> = {};
    
    selectedSources.forEach((source) => {
      stats[source.sourceKey] = { wins: 0, totalItems: 0, totalPriceUSD: 0 };
    });

    comparisonData.forEach(row => {
      if (row.bestSourceKey && stats[row.bestSourceKey]) {
        stats[row.bestSourceKey].wins++;
      }
      Object.entries(row.prices).forEach(([sourceKey, priceData]) => {
        if (stats[sourceKey]) {
          stats[sourceKey].totalItems++;
          stats[sourceKey].totalPriceUSD += priceData.usdPrice;
        }
      });
    });

    return selectedSources.map((source) => {
      const sourceKey = source.sourceKey;
      return {
        sourceKey,
        name: source.name,
        dateLabel: source.dateLabel,
        avgPriceUSD: stats[sourceKey].totalItems > 0 ? stats[sourceKey].totalPriceUSD / stats[sourceKey].totalItems : 0,
        availableCount: stats[sourceKey].totalItems,
        wins: stats[sourceKey].wins
      };
    }).sort((a, b) => b.wins - a.wins || a.avgPriceUSD - b.avgPriceUSD);
  }, [comparisonData, selectedSources]);

  const summaryStats = useMemo(() => {
    const totalProducts = comparisonData.length;
    const totalSources = selectedSources.length;
    const bestOverallSource = leaderboard[0]?.name || 'N/A';
    
    const validBestPrices = comparisonData.map(r => r.bestPriceUSD).filter((p): p is number => p !== undefined);
    const avgLowestPrice = validBestPrices.length > 0 
      ? validBestPrices.reduce((a, b) => a + b, 0) / validBestPrices.length 
      : 0;

    const validSpreads = comparisonData.map(r => r.priceDiffPercent).filter((p): p is number => p !== undefined);
    const avgSpread = validSpreads.length > 0
      ? validSpreads.reduce((a, b) => a + b, 0) / validSpreads.length
      : 0;

    const sourceWithMostMissing = [...leaderboard].sort((a, b) => a.availableCount - b.availableCount)[0];

    return {
      totalProducts,
      totalSources,
      bestOverallSource,
      avgLowestPrice,
      avgSpread,
      mostMissingSource: sourceWithMostMissing && sourceWithMostMissing.availableCount < totalProducts ? sourceWithMostMissing.name : 'None'
    };
  }, [comparisonData, selectedSources, leaderboard]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Error Display */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-900">Database Error</p>
                <p className="text-xs text-red-700 mt-1">{error}</p>
                {error.includes('quota') && (
                  <p className="text-[10px] text-red-600 mt-2 font-medium">
                    The system is currently under heavy load. Please try again in a few minutes or contact support if the issue persists.
                  </p>
                )}
              </div>
              <button 
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight text-stone-900">Supplier Comparison</h2>
          <p className="text-stone-500">Compare prices across your approved supplier network.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-stone-100 p-1 rounded-xl">
            <button
              onClick={() => setMode('catalog')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                mode === 'catalog' ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              )}
            >
              Catalog Mode
            </button>
            <button
              onClick={() => setMode('upload')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                mode === 'upload' ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              )}
            >
              Upload Mode
            </button>
          </div>
          
          <label className="cursor-pointer bg-stone-900 text-white px-4 py-2 rounded-xl font-bold hover:bg-stone-800 transition-all flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload Request
            <input type="file" className="hidden" onChange={handleFileUpload} accept=".xlsx,.xls,.csv" />
          </label>

          <button
            onClick={handleExportExcel}
            disabled={comparisonData.length === 0}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export to Excel
          </button>

          <button
            onClick={resetComparison}
            className="px-4 py-2 bg-white border border-stone-200 text-stone-600 rounded-xl font-bold hover:bg-stone-50 transition-all flex items-center gap-2"
          >
            <X className="w-4 h-4" />
            Reset
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Products Compared', value: summaryStats.totalProducts, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Sources Selected', value: summaryStats.totalSources, icon: Building2, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Best Overall Source', value: summaryStats.bestOverallSource, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Avg Lowest Price', value: `$${(summaryStats.avgLowestPrice || 0).toFixed(2)}`, icon: TrendingDown, color: 'text-amber-600', bg: 'bg-amber-50', isPrice: true },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm flex items-center gap-4">
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", stat.bg, stat.color)}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{stat.label}</p>
              <p className="text-xl font-black text-stone-900 font-variant-numeric tabular-nums">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Controls */}
        <div className="space-y-6">
          {/* Sources Selection */}
          <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-stone-900">
                <Building2 className="w-4 h-4" />
                <h3 className="font-bold uppercase text-xs tracking-wider">Comparison Sources</h3>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full">
                {selectedSources.length} Selected
              </span>
            </div>

            <div className="space-y-4">
              {/* Product Catalog Option */}
              <button
                onClick={() => {
                  const exists = selectedSources.find(s => s.type === 'catalog');
                  if (exists) {
                    setSelectedSources(selectedSources.filter(s => s.type !== 'catalog'));
                  } else {
                    const newSource: ComparisonSource = { 
                      type: 'catalog', 
                      id: 'catalog', 
                      name: 'Product Catalog',
                      sourceKey: 'catalog_latest'
                    };
                    setSelectedSources([...selectedSources, newSource]);
                  }
                }}
                className={cn(
                  "w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left",
                  selectedSources.find(s => s.type === 'catalog')
                    ? "bg-stone-50 border-stone-900 ring-1 ring-stone-900"
                    : "bg-white border-stone-100 hover:border-stone-200"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    selectedSources.find(s => s.type === 'catalog') ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-400"
                  )}>
                    <Package className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-stone-900">Product Catalog</div>
                    <div className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">Internal Reference</div>
                  </div>
                </div>
                {selectedSources.find(s => s.type === 'catalog') && (
                  <CheckCircle2 className="w-4 h-4 text-stone-900" />
                )}
              </button>

              <div className="h-px bg-stone-100" />

              {/* Suppliers List */}
              <div className="space-y-3 max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                {suppliers.map(supplier => {
                  const selectedSnapshots = selectedSources.filter(s => s.id === supplier.id && s.uploadId);
                  const selectedSnapshotsCount = selectedSnapshots.length;
                  const isLatestSelected = selectedSources.some(s => s.sourceKey === `${supplier.id}_latest`);
                  
                  return (
                    <div key={supplier.id} className="p-3 rounded-xl border bg-white border-stone-100 space-y-3 shadow-sm">
                      {/* Row 1: Supplier Identity */}
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-stone-100 text-slate-400 shrink-0">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div 
                            className="text-sm font-bold text-stone-900 truncate" 
                            title={supplier.name}
                          >
                            {supplier.name}
                          </div>
                          {selectedSnapshotsCount > 0 && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <div className="w-1 h-1 rounded-full bg-emerald-500" />
                              <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">
                                {selectedSnapshotsCount} Snapshot{selectedSnapshotsCount > 1 ? 's' : ''} Selected
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Action Buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const sourceKey = `${supplier.id}_latest`;
                            if (isLatestSelected) {
                              setSelectedSources(selectedSources.filter(s => s.sourceKey !== sourceKey));
                            } else {
                              setSelectedSources([...selectedSources, { 
                                type: 'supplier', 
                                id: supplier.id, 
                                name: supplier.name,
                                sourceKey
                              }]);
                            }
                          }}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all border",
                            isLatestSelected
                              ? "bg-stone-900 border-stone-900 text-white shadow-sm"
                              : "bg-stone-50 border-stone-100 text-stone-500 hover:bg-stone-100"
                          )}
                        >
                          {isLatestSelected ? 'Latest Active' : 'Latest'}
                        </button>
                        <button
                          onClick={() => {
                            setSnapshotSupplier(supplier);
                            setIsSnapshotModalOpen(true);
                          }}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all border",
                            selectedSnapshotsCount > 0
                              ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm"
                              : "bg-stone-50 border-stone-100 text-stone-500 hover:bg-stone-100"
                          )}
                        >
                          {selectedSnapshotsCount > 0 ? 'Snapshots' : 'Choose'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Product Selector (Mode A) */}
          {mode === 'catalog' && (
            <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-900">
                  <Package className="w-4 h-4" />
                  <h3 className="font-bold uppercase text-xs tracking-wider">Products ({selectedProductIds.length})</h3>
                </div>
                <button 
                  onClick={() => {
                    setModalSearchTerm('');
                    setIsProductSelectorOpen(true);
                  }}
                  className="text-stone-400 hover:text-stone-900"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              
              <div className="space-y-2">
                {selectedProductIds.length === 0 ? (
                  <p className="text-xs text-stone-400 italic">No products selected.</p>
                ) : (
                  selectedProductIds.map(id => {
                    const p = allProducts.find(ap => ap.id === id);
                    return (
                      <div key={id} className="flex items-center justify-between p-2 bg-stone-50 rounded-lg group">
                        <span className="text-xs font-medium text-stone-600 truncate max-w-[150px]">{p?.canonicalName}</span>
                        <button 
                          onClick={() => setSelectedProductIds(selectedProductIds.filter(sid => sid !== id))}
                          className="text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Upload Status (Mode B) */}
          {mode === 'upload' && (
            <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-stone-900">
                <FileSpreadsheet className="w-4 h-4" />
                <h3 className="font-bold uppercase text-xs tracking-wider">Request File</h3>
              </div>
              <div className="space-y-3">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-100">
                  <p className="text-xs font-bold text-stone-900 truncate">{uploadResults.length} Items Parsed</p>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-stone-500">Matched</span>
                      <span className="font-bold text-emerald-600">{uploadResults.filter(r => !r.needsReview).length}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-stone-500">Needs Review</span>
                      <span className="font-bold text-amber-600">{uploadResults.filter(r => r.needsReview).length}</span>
                    </div>
                  </div>
                </div>

                {uploadResults.some(r => r.needsReview) && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase text-stone-400">Items Needing Review</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                      {uploadResults.map((res, idx) => {
                        if (!res.needsReview) return null;
                        return (
                          <div key={idx} className="p-2 bg-amber-50 rounded-lg border border-amber-100 space-y-2">
                            <p className="text-[10px] font-bold text-amber-900 truncate" title={res.rawName}>
                              {res.rawName}
                            </p>
                            <button 
                              onClick={() => {
                                setModalSearchTerm('');
                                setReviewingIndex(idx);
                                setIsProductSelectorOpen(true);
                              }}
                              className="w-full py-1 text-[10px] font-bold bg-white border border-amber-200 text-amber-700 rounded hover:bg-amber-100 transition-all"
                            >
                              Match Product
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button 
                  onClick={() => setMode('catalog')}
                  className="w-full py-2 text-xs font-bold text-stone-500 hover:text-stone-900 border border-stone-200 rounded-lg"
                >
                  Clear & Switch to Catalog
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-3 space-y-6">
          {/* Filters & Search */}
          <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all text-sm"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-stone-400" />
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className="bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-sm outline-none"
              >
                {brands.map(b => (
                  <option key={b} value={b}>{b === 'all' ? 'All Brands' : b}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-stone-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-sm outline-none"
              >
                <option value="name">Sort by Name</option>
                <option value="bestPrice">Sort by Best Price</option>
                <option value="diff">Sort by Price Diff %</option>
              </select>
              <button 
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
              >
                <ChevronDown className={cn("w-4 h-4 transition-transform", sortOrder === 'desc' && "rotate-180")} />
              </button>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">Product Details</th>
                    {selectedSources.map((source) => {
                      const sourceKey = source.sourceKey;
                      return (
                        <th key={sourceKey} className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500 text-center">
                          <div className="flex flex-col items-center">
                            <span className="truncate max-w-[120px]">{source.name}</span>
                            <span className="text-[8px] text-stone-400 font-medium lowercase">
                              {source.type === 'catalog' ? 'internal cost' : (source.dateLabel || 'latest list')}
                            </span>
                          </div>
                        </th>
                      );
                    })}
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500 text-right">Best Offer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {loading ? (
                    <tr>
                      <td colSpan={selectedSources.length + 2} className="px-6 py-20 text-center">
                        <Loader2 className="w-8 h-8 text-stone-300 animate-spin mx-auto" />
                        <p className="mt-4 text-stone-400 font-medium">Loading comparison data...</p>
                      </td>
                    </tr>
                  ) : comparisonData.length === 0 ? (
                    <tr>
                      <td colSpan={selectedSources.length + 2} className="px-6 py-20 text-center">
                        <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Package className="w-8 h-8 text-stone-200" />
                        </div>
                        <p className="text-stone-400 font-medium">No products selected for comparison.</p>
                      </td>
                    </tr>
                  ) : (
                    comparisonData.map((row) => (
                      <tr key={row.rowId} className="hover:bg-stone-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="space-y-0.5">
                            <p className="font-bold text-stone-900">{highlightSearchText(row.productName, searchTerm)}</p>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-tighter">
                                {highlightSearchText(row.brand || 'No Brand', searchTerm)}
                              </span>
                              <span className="text-[10px] text-stone-300">•</span>
                              <span className="text-[10px] font-medium text-stone-500">{row.sourceCount} Sources</span>
                            </div>
                          </div>
                        </td>
                        
                        {selectedSources.map((source) => {
                          const sourceKey = source.sourceKey;
                          const priceData = row.prices[sourceKey];
                          const isBest = sourceKey === row.bestSourceKey && row.sourceCount > 1;
                          const isWorst = sourceKey === row.worstSourceKey && row.sourceCount > 1;
                          
                          return (
                            <td key={sourceKey} className="px-6 py-4 text-center">
                              {priceData ? (
                                <div className="space-y-1">
                                  <div className="flex flex-col items-center">
                                    <span className={cn(
                                      "text-sm font-bold",
                                      isBest ? "text-emerald-600" : isWorst ? "text-red-600" : "text-stone-900"
                                    )}>
                                      { (priceData.rawPrice || 0).toLocaleString() } {priceData.currency}
                                    </span>
                                    {priceData.currency !== 'USD' && (
                                      <span className="text-[10px] text-stone-400 font-medium">
                                        ≈ ${ (priceData.usdPrice || 0).toFixed(2) }
                                      </span>
                                    )}
                                  </div>
                                  {isBest && (
                                    <div className="flex items-center justify-center gap-1 text-[9px] font-bold text-emerald-500 uppercase">
                                      <TrendingDown className="w-2.5 h-2.5" />
                                      Best
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[10px] text-stone-300 font-medium italic">Not available</span>
                              )}
                            </td>
                          );
                        })}

                        <td className="px-6 py-4 text-right">
                          {row.bestPriceUSD !== undefined ? (
                            <div className="space-y-1">
                              <p className="text-sm font-black text-stone-900">${(row.bestPriceUSD || 0).toFixed(2)}</p>
                              <p className="text-[9px] font-bold text-stone-400 uppercase truncate max-w-[120px] ml-auto">
                                {selectedSources.find(s => s.sourceKey === row.bestSourceKey)?.name}
                              </p>
                              {row.priceDiffPercent !== undefined && row.priceDiffPercent > 0 && (
                                <p className="text-[9px] font-bold text-red-500">
                                  +{(row.priceDiffPercent || 0).toFixed(1)}% variance
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-stone-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Leaderboard & Insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Leaderboard */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-stone-100 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-sm uppercase tracking-wider">Supplier Leaderboard</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-100">
                      <th className="px-4 py-3 font-bold text-stone-500">Rank</th>
                      <th className="px-4 py-3 font-bold text-stone-500">Supplier</th>
                      <th className="px-4 py-3 font-bold text-stone-500 text-center">Avg Price</th>
                      <th className="px-4 py-3 font-bold text-stone-500 text-center">Availability</th>
                      <th className="px-4 py-3 font-bold text-stone-500 text-right">Wins</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {leaderboard.map((s, i) => (
                      <tr key={s.sourceKey} className="hover:bg-stone-50 transition-colors">
                        <td className="px-4 py-3 font-bold text-stone-400">#{i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-bold text-stone-900">{s.name}</span>
                            {s.dateLabel && <span className="text-[10px] text-stone-400">{s.dateLabel}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-stone-600">${(s.avgPriceUSD || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full font-bold text-[10px]",
                            s.availableCount === summaryStats.totalProducts ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-600"
                          )}>
                            {s.availableCount}/{summaryStats.totalProducts}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-black text-emerald-600">{s.wins}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Insights */}
            <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm space-y-6">
              <div className="flex items-center gap-2 text-stone-900">
                <AlertCircle className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-sm uppercase tracking-wider">Summary Insights</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <TrendingDown className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-stone-900">{summaryStats.bestOverallSource}</p>
                    <p className="text-xs text-stone-500">Most competitive source with {leaderboard[0]?.wins || 0} lowest-price wins.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-stone-900">{summaryStats.mostMissingSource}</p>
                    <p className="text-xs text-stone-500">Source with the most missing items in this comparison.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-stone-900">{(summaryStats.avgSpread || 0).toFixed(1)}% Avg Spread</p>
                    <p className="text-xs text-stone-500">Average price difference between the cheapest and most expensive options.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Review Modal */}
      <AnimatePresence>
        {isUploadReviewModalOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
                <div>
                  <h3 className="text-xl font-black text-stone-900">Review Uploaded Request</h3>
                  <p className="text-xs text-stone-500 mt-1">
                    {uploadResults.length} items parsed. {excludedUploadItems.size > 0 && `${excludedUploadItems.size} excluded.`} Please verify matches before finalizing.
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setIsUploadReviewModalOpen(false);
                    setUploadResults([]);
                  }} 
                  className="p-2 text-stone-400 hover:text-stone-900 hover:bg-white rounded-xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                <div className="grid grid-cols-1 gap-3">
                  {uploadResults.map((res, idx) => {
                    if (excludedUploadItems.has(idx)) return null;
                    
                    return (
                      <div 
                        key={idx} 
                        className={cn(
                          "p-4 rounded-2xl border transition-all flex items-center justify-between gap-4",
                          res.needsReview 
                            ? "bg-amber-50/30 border-amber-100" 
                            : "bg-white border-stone-100",
                          selectedUploadItems.has(idx) && "ring-2 ring-stone-900 bg-stone-50"
                        )}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <button
                            onClick={() => {
                              const next = new Set(selectedUploadItems);
                              if (next.has(idx)) next.delete(idx);
                              else next.add(idx);
                              setSelectedUploadItems(next);
                            }}
                            className={cn(
                              "w-5 h-5 rounded border flex items-center justify-center transition-all",
                              selectedUploadItems.has(idx) 
                                ? "bg-stone-900 border-stone-900 text-white" 
                                : "bg-white border-stone-200 text-transparent"
                            )}
                          >
                            <Check className="w-3 h-3" />
                          </button>

                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-stone-900 truncate" title={res.rawName}>
                                {res.rawName}
                              </p>
                              {res.rawPrice && (
                                <span className="text-[10px] font-black bg-stone-100 px-1.5 py-0.5 rounded text-stone-600">
                                  {res.rawPrice} {res.rawCurrency}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {res.matchedProductId ? (
                                <div className="flex items-center gap-1.5">
                                  {res.needsReview ? (
                                    <div className="flex items-center gap-1.5">
                                      <AlertCircle className="w-3 h-3 text-amber-500" />
                                      <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">
                                        Awaiting Approval
                                      </span>
                                      <span className="text-[11px] text-stone-400 font-medium">
                                        Suggested: <span className="text-stone-600">{res.matchedProductName}</span>
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                      <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
                                        Manual Match
                                      </span>
                                      <span className="text-[11px] text-stone-600 font-medium">
                                        Matched to: <span className="font-bold text-stone-900">{res.matchedProductName}</span>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <AlertCircle className="w-3 h-3 text-amber-500" />
                                  <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">No Match Found</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setReviewingIndex(idx);
                              setModalSearchTerm(res.rawName);
                              setIsProductSelectorOpen(true);
                            }}
                            className="px-4 py-2 bg-white border border-stone-200 text-stone-600 rounded-xl text-xs font-bold hover:bg-stone-50 transition-all"
                          >
                            {res.matchedProductId ? 'Change Match' : 'Find Match'}
                          </button>
                          
                          <button
                            onClick={() => {
                              const next = new Set(excludedUploadItems);
                              next.add(idx);
                              setExcludedUploadItems(next);
                              
                              const nextSelected = new Set(selectedUploadItems);
                              nextSelected.delete(idx);
                              setSelectedUploadItems(nextSelected);
                            }}
                            className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                            title="Exclude from comparison"
                          >
                            <XCircle className="w-5 h-5" />
                          </button>

                          {res.matchedProductId && (
                            <button
                              onClick={() => {
                                setUploadResults(prev => {
                                  const next = [...prev];
                                  next[idx] = { 
                                    ...next[idx], 
                                    matchedProductId: null, 
                                    matchedProductName: null,
                                    needsReview: true,
                                    confidence: 0
                                  };
                                  return next;
                                });
                              }}
                              className="px-4 py-2 bg-white border border-red-100 text-red-600 rounded-xl text-xs font-bold hover:bg-red-50 transition-all"
                            >
                              Clear Match
                            </button>
                          )}
                          {!res.matchedProductId && (
                            <button
                              onClick={() => {
                                setReviewingIndex(idx);
                                setNewProductData({
                                  canonicalName: res.rawName,
                                  brand: res.rawBrand || '',
                                  category: '',
                                  costPrice: res.rawPrice || 0,
                                  internalReference: res.rawSku || ''
                                });
                                setIsCreatingProduct(true);
                              }}
                              className="px-4 py-2 bg-stone-100 text-stone-600 rounded-xl text-xs font-bold hover:bg-stone-200 transition-all"
                            >
                              Create Product
                            </button>
                          )}
                          {res.matchedProductId && res.needsReview && (
                            <button
                              onClick={() => {
                                setUploadResults(prev => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], needsReview: false };
                                  return next;
                                });
                              }}
                              className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-sm"
                            >
                              Approve Match
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {excludedUploadItems.size > 0 && (
                  <div className="space-y-3 pt-6 border-t border-stone-100">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider">Excluded Items ({excludedUploadItems.size})</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {Array.from(excludedUploadItems).map(idx => {
                        const res = uploadResults[idx];
                        return (
                          <div key={idx} className="p-3 rounded-xl bg-stone-50 border border-stone-100 flex items-center justify-between gap-4 opacity-60">
                            <p className="text-xs font-medium text-stone-600 truncate">{res.rawName}</p>
                            <button
                              onClick={() => {
                                const next = new Set(excludedUploadItems);
                                next.delete(idx);
                                setExcludedUploadItems(next);
                              }}
                              className="text-[10px] font-bold text-stone-400 hover:text-stone-900 uppercase tracking-wider"
                            >
                              Restore
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 bg-stone-50 border-t border-stone-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-bold text-stone-600">
                      {uploadResults.filter(r => !r.needsReview).length} Ready
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-xs font-bold text-stone-600">
                      {uploadResults.filter(r => r.needsReview).length} Needs Review
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setIsUploadReviewModalOpen(false);
                      setUploadResults([]);
                      setSelectedUploadItems(new Set());
                      setExcludedUploadItems(new Set());
                    }}
                    className="px-6 py-3 text-stone-500 font-bold hover:text-stone-900 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={uploadResults.some((r, i) => !excludedUploadItems.has(i) && r.needsReview)}
                    onClick={() => {
                      setIsUploadReviewModalOpen(false);
                      setMode('upload');
                      
                      // If items are selected, only include those. Otherwise include all non-excluded.
                      if (selectedUploadItems.size > 0) {
                        const filteredResults = uploadResults.filter((_, i) => selectedUploadItems.has(i));
                        setUploadResults(filteredResults);
                      } else {
                        const filteredResults = uploadResults.filter((_, i) => !excludedUploadItems.has(i));
                        setUploadResults(filteredResults);
                      }

                      // Add upload as a source
                      const sourceKey = 'upload_current';
                      if (!selectedSources.some(s => s.sourceKey === sourceKey)) {
                        setSelectedSources(prev => [...prev, {
                          type: 'upload',
                          id: 'upload',
                          name: 'Uploaded Request',
                          sourceKey
                        }]);
                      }
                      
                      setSelectedUploadItems(new Set());
                      setExcludedUploadItems(new Set());
                    }}
                    className={cn(
                      "px-10 py-3 rounded-2xl font-black transition-all shadow-xl",
                      (selectedUploadItems.size > 0
                        ? Array.from(selectedUploadItems).some(idx => uploadResults[idx].needsReview)
                        : uploadResults.some((r, i) => !excludedUploadItems.has(i) && r.needsReview))
                        ? "bg-stone-200 text-stone-400 cursor-not-allowed shadow-none"
                        : "bg-stone-900 text-white hover:bg-stone-800 shadow-stone-900/20"
                    )}
                  >
                    {selectedUploadItems.size > 0 ? `Add ${selectedUploadItems.size} selected only to compare` : 'Add To Compare'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Snapshot Selector Modal */}
      <AnimatePresence>
        {isSnapshotModalOpen && snapshotSupplier && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-black text-stone-900">Select Snapshots</h3>
                  <p className="text-xs text-stone-500">{snapshotSupplier.name}</p>
                </div>
                <button onClick={() => setIsSnapshotModalOpen(false)} className="text-stone-400 hover:text-stone-900">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                {(supplierUploads[snapshotSupplier.id] || []).length === 0 ? (
                  <p className="text-center py-8 text-stone-400 italic">No historical snapshots found.</p>
                ) : (
                  (supplierUploads[snapshotSupplier.id] || []).map(u => {
                    const sourceKey = `${snapshotSupplier.id}_${u.id}`;
                    const isSelected = selectedSources.some(s => s.sourceKey === sourceKey);
                    return (
                      <button
                        key={u.id}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedSources(selectedSources.filter(s => s.sourceKey !== sourceKey));
                          } else {
                            setSelectedSources([...selectedSources, { 
                              type: 'supplier', 
                              id: snapshotSupplier.id, 
                              name: snapshotSupplier.name,
                              uploadId: u.id,
                              dateLabel: formatSnapshotDate(u),
                              sourceKey
                            }]);
                          }
                        }}
                        className={cn(
                          "w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
                          isSelected
                            ? "bg-stone-900 border-stone-900 text-white shadow-lg shadow-stone-900/20"
                            : "bg-white border-stone-100 hover:border-stone-300 text-stone-700"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Calendar className={cn("w-5 h-5", isSelected ? "text-white/60" : "text-stone-400")} />
                          <div>
                            <p className="font-bold">{formatSnapshotDate(u)}</p>
                            <p className={cn("text-[10px] truncate max-w-[200px]", isSelected ? "text-white/40" : "text-stone-400")}>
                              {u.fileName}
                            </p>
                          </div>
                        </div>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="p-6 bg-stone-50 flex justify-end">
                <button
                  onClick={() => setIsSnapshotModalOpen(false)}
                  className="bg-stone-900 text-white px-8 py-3 rounded-2xl font-black hover:bg-stone-800 transition-all"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Product Selector Modal */}
      {isProductSelectorOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">
                  {reviewingIndex !== null ? 'Match Product' : 'Select Products to Compare'}
                </h3>
                {reviewingIndex !== null && (
                  <p className="text-xs text-stone-500 mt-1">
                    Matching: <span className="font-bold text-stone-900">{uploadResults[reviewingIndex].rawName}</span>
                  </p>
                )}
              </div>
              <button 
                onClick={() => {
                  setIsProductSelectorOpen(false);
                  setReviewingIndex(null);
                }} 
                className="text-stone-400 hover:text-stone-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search catalog..."
                  value={modalSearchTerm}
                  className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all"
                  onChange={(e) => setModalSearchTerm(e.target.value)}
                />
              </div>

              <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-6">
                {suggestedProducts.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <p className="text-xs font-bold uppercase tracking-wider">Suggested Matches</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {suggestedProducts.map(p => renderProductCard(p))}
                    </div>
                    <div className="h-px bg-stone-100 my-4" />
                  </div>
                )}

                <div className="space-y-3">
                  {suggestedProducts.length > 0 && (
                    <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">All Products</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {allProducts
                      .filter(p => 
                        p.canonicalName.toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                        p.brand?.toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                        p.internalReference?.toLowerCase().includes(modalSearchTerm.toLowerCase())
                      )
                      .map(p => renderProductCard(p))}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-stone-50 flex justify-end">
              <button
                onClick={() => {
                  setIsProductSelectorOpen(false);
                  setReviewingIndex(null);
                }}
                className="bg-stone-900 text-white px-8 py-3 rounded-2xl font-bold hover:bg-stone-800 transition-all"
              >
                {reviewingIndex !== null ? 'Cancel' : `Done (${selectedProductIds.length} Selected)`}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Create Product Modal */}
      <AnimatePresence>
        {isCreatingProduct && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between">
                <h3 className="text-xl font-black text-stone-900">Create New Product</h3>
                <button onClick={() => setIsCreatingProduct(false)} className="text-stone-400 hover:text-stone-900">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-stone-400 tracking-wider">Product Name</label>
                  <input
                    type="text"
                    value={newProductData.canonicalName}
                    onChange={(e) => setNewProductData({ ...newProductData, canonicalName: e.target.value })}
                    className="w-full px-4 py-2 bg-stone-50 border border-stone-100 rounded-xl outline-none focus:ring-2 focus:ring-stone-900/5"
                    placeholder="e.g. iPhone 15 Pro Max"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-stone-400 tracking-wider">Brand</label>
                    <input
                      type="text"
                      value={newProductData.brand}
                      onChange={(e) => setNewProductData({ ...newProductData, brand: e.target.value })}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-100 rounded-xl outline-none focus:ring-2 focus:ring-stone-900/5"
                      placeholder="e.g. Apple"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-stone-400 tracking-wider">Category</label>
                    <input
                      type="text"
                      value={newProductData.category}
                      onChange={(e) => setNewProductData({ ...newProductData, category: e.target.value })}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-100 rounded-xl outline-none focus:ring-2 focus:ring-stone-900/5"
                      placeholder="e.g. Smartphones"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-stone-400 tracking-wider">Internal Reference</label>
                    <input
                      type="text"
                      value={newProductData.internalReference}
                      onChange={(e) => setNewProductData({ ...newProductData, internalReference: e.target.value })}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-100 rounded-xl outline-none focus:ring-2 focus:ring-stone-900/5"
                      placeholder="SKU-123"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-stone-400 tracking-wider">Cost Price (USD)</label>
                    <input
                      type="number"
                      value={newProductData.costPrice}
                      onChange={(e) => setNewProductData({ ...newProductData, costPrice: Number(e.target.value) })}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-100 rounded-xl outline-none focus:ring-2 focus:ring-stone-900/5"
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 bg-stone-50 flex justify-end gap-3">
                <button
                  onClick={() => setIsCreatingProduct(false)}
                  className="px-6 py-2 text-stone-500 font-bold hover:text-stone-900 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProduct}
                  disabled={!newProductData.canonicalName}
                  className="bg-stone-900 text-white px-8 py-2 rounded-xl font-black hover:bg-stone-800 transition-all disabled:opacity-50"
                >
                  Create & Match
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SupplierComparison;
