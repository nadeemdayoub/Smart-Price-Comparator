import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, writeBatch, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { CanonicalProduct, PriceEntry, Supplier } from '../types';
import { Plus, Search, Filter, Edit2, Trash2, Archive, Package, X, Upload, Settings2, Table, ArrowRight, Loader2, CheckCircle2, AlertCircle, Trash, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { extractColumnCandidates } from '../utils/uploadColumnMapping';
import { importCatalog, CatalogColumnMapping, ImportSummary } from '../services/catalogImportService';
import { COLLECTIONS } from '../services/firestoreCollections';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { normalizeProductName, generateSearchTokens, createSensitiveSignature } from '../utils/productNormalization';
import { sanitizeFirestoreData } from '../lib/firestore-utils';
import { cn, devLog } from '../lib/utils';
import { matchesSearch, highlightSearchText } from '../lib/search';

const Catalog: React.FC = () => {
  const { profile, user } = useAuth();
  const [products, setProducts] = useState<CanonicalProduct[]>([]);
  const [priceEntries, setPriceEntries] = useState<PriceEntry[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CanonicalProduct | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [productToDelete, setProductToDelete] = useState<CanonicalProduct | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof CanonicalProduct | 'pricing'; direction: 'asc' | 'desc' }>({
    key: 'canonicalName',
    direction: 'asc'
  });

  // Import Flow State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'processing' | 'summary'>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [columnMapping, setColumnMapping] = useState<CatalogColumnMapping>({
    productNameColumn: null,
    brandColumn: null,
    costColumn: null,
    quantityColumn: null,
    skuColumn: null,
    categoryColumn: null,
  });
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const columnCandidates = useMemo(() => extractColumnCandidates(parsedRows), [parsedRows]);

  useEffect(() => {
    if (!profile?.uid) return;

    const q = query(
      collection(db, COLLECTIONS.CANONICAL_PRODUCTS),
      where('ownerUserId', '==', profile.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanonicalProduct));
      setProducts(items);
      setLoading(false);
      setError(null);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, COLLECTIONS.CANONICAL_PRODUCTS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to sync catalog."));
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile?.uid) return;

    // Fetch latest price entries
    const priceQ = query(
      collection(db, COLLECTIONS.PRICE_ENTRIES),
      where('ownerUserId', '==', profile.uid)
    );

    const unsubscribePrices = onSnapshot(priceQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PriceEntry));
      setPriceEntries(items);
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.PRICE_ENTRIES);
      } catch (e) {
        devLog.error("Error fetching prices:", getFirestoreErrorMessage(e));
      }
    });

    // Fetch suppliers for names
    const supplierQ = query(
      collection(db, COLLECTIONS.SUPPLIERS),
      where('ownerUserId', '==', profile.uid)
    );

    const unsubscribeSuppliers = onSnapshot(supplierQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
      setSuppliers(items);
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.SUPPLIERS);
      } catch (e) {
        devLog.error("Error fetching suppliers:", getFirestoreErrorMessage(e));
      }
    });

    return () => {
      unsubscribePrices();
      unsubscribeSuppliers();
    };
  }, [profile?.uid]);

  const productPriceSummaries = useMemo(() => {
    const summaries: Record<string, { latest: PriceEntry | null; best: PriceEntry | null; supplierName: string }> = {};
    
    products.forEach(p => {
      const entries = priceEntries.filter(e => e.canonicalProductId === p.id);
      if (entries.length === 0) {
        summaries[p.id] = { latest: null, best: null, supplierName: '' };
        return;
      }

      // Sort by date desc for latest
      const sortedByDate = [...entries].sort((a, b) => {
        const dateA = a.effectiveDate?.seconds || a.date?.seconds || 0;
        const dateB = b.effectiveDate?.seconds || b.date?.seconds || 0;
        return dateB - dateA;
      });

      // Sort by price asc for best
      const sortedByPrice = [...entries].sort((a, b) => a.price - b.price);

      const latest = sortedByDate[0];
      const best = sortedByPrice[0];
      const supplier = suppliers.find(s => s.id === latest.supplierId);

      summaries[p.id] = {
        latest,
        best,
        supplierName: supplier?.name || 'Unknown'
      };
    });

    return summaries;
  }, [products, priceEntries, suppliers]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setImportFile(selectedFile);
      
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataBuffer = evt.target?.result;
        if (!dataBuffer) return;
        
        const wb = XLSX.read(new Uint8Array(dataBuffer as ArrayBuffer), { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        setParsedRows(data);
        
        // Auto-suggest columns
        const candidates = extractColumnCandidates(data as any[]);
        setColumnMapping({
          productNameColumn: candidates.find(c => /name|desc|product|item/i.test(c)) || candidates[0] || null,
          brandColumn: candidates.find(c => /brand|make|manufacturer/i.test(c)) || null,
          costColumn: candidates.find(c => /cost|price|rate/i.test(c)) || null,
          quantityColumn: candidates.find(c => /qty|quant|stock|amount/i.test(c)) || null,
          skuColumn: candidates.find(c => /sku|ref|code|part/i.test(c)) || null,
          categoryColumn: candidates.find(c => /cat|group|type/i.test(c)) || null,
        });
      };
      reader.readAsArrayBuffer(selectedFile);
    }
  };

  const handleRunImport = async () => {
    if (!profile?.uid) return;
    if (!parsedRows.length) return;
    
    setIsProcessing(true);
    setImportStep('processing');
    
    try {
      const summary = await importCatalog(profile.uid, parsedRows, columnMapping);
      setImportSummary(summary);
      setImportStep('summary');
      setError(null);
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.WRITE, 'catalog_import');
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Import failed. Please check console for details."));
      }
      setImportStep('mapping');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const canonicalName = formData.get('name') as string;
    const brand = formData.get('brand') as string;
    const category = formData.get('category') as string;
    const internalReference = formData.get('internalReference') as string;
    const capacity = formData.get('capacity') as string;
    const color = formData.get('color') as string;
    const version = formData.get('version') as string;

    const normalizedName = normalizeProductName(canonicalName);
    const costPrice = parseFloat(formData.get('costPrice') as string) || 0;
    const stockQty = parseInt(formData.get('stockQty') as string) || 0;
    
    const data: Partial<CanonicalProduct> = {
      canonicalName,
      normalizedName,
      brand,
      category,
      internalReference,
      capacity,
      color,
      version,
      costPrice,
      stockQty,
      ownerUserId: profile?.uid || user?.uid || '',
      searchTokens: generateSearchTokens(normalizedName),
      sensitiveSignature: createSensitiveSignature({
        brand,
        capacity,
        color,
        version
      }),
      status: 'active',
      updatedAt: serverTimestamp(),
    };

    if (!data.ownerUserId) {
      setError("User not authenticated. Please log in again.");
      return;
    }

    try {
      if (editingProduct) {
        await updateDoc(doc(db, COLLECTIONS.CANONICAL_PRODUCTS, editingProduct.id), sanitizeFirestoreData(data));
      } else {
        const newData = {
          ...data,
          createdAt: serverTimestamp(),
        };
        await addDoc(collection(db, COLLECTIONS.CANONICAL_PRODUCTS), sanitizeFirestoreData(newData));
      }
      setIsModalOpen(false);
      setEditingProduct(null);
      setError(null);
    } catch (error) {
      try {
        handleFirestoreError(error, editingProduct ? OperationType.UPDATE : OperationType.CREATE, COLLECTIONS.CANONICAL_PRODUCTS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to save product."));
      }
    }
  };

  const handleDeleteAll = async () => {
    if (!profile?.uid) return;
    setIsDeletingAll(true);
    try {
      const q = query(
        collection(db, COLLECTIONS.CANONICAL_PRODUCTS),
        where('ownerUserId', '==', profile.uid)
      );
      const snapshot = await getDocs(q);
      
      // Firestore batches are limited to 500 operations
      const BATCH_SIZE = 400;
      const docs = snapshot.docs;
      
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_SIZE);
        chunk.forEach(d => batch.delete(d.ref));
        try {
          await batch.commit();
        } catch (commitError) {
          try {
            handleFirestoreError(commitError, OperationType.DELETE, COLLECTIONS.CANONICAL_PRODUCTS);
          } catch (e) {
            setError(getFirestoreErrorMessage(e, "Failed to delete batch."));
          }
          throw commitError; // Re-throw to stop the loop
        }
      }
      
      setShowDeleteConfirm(false);
      setError(null);
    } catch (error) {
      // Error already handled in loop or top-level
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleDeleteSingle = async () => {
    if (!productToDelete) return;
    setIsDeletingSingle(true);
    try {
      await deleteDoc(doc(db, COLLECTIONS.CANONICAL_PRODUCTS, productToDelete.id));
      setProductToDelete(null);
      setError(null);
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.DELETE, COLLECTIONS.CANONICAL_PRODUCTS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to delete product."));
      }
    } finally {
      setIsDeletingSingle(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsDeletingSelected(true);
    try {
      const BATCH_SIZE = 400;
      const idsArray = Array.from(selectedIds);
      
      for (let i = 0; i < idsArray.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = idsArray.slice(i, i + BATCH_SIZE);
        chunk.forEach(id => {
          batch.delete(doc(db, COLLECTIONS.CANONICAL_PRODUCTS, id));
        });
        await batch.commit();
      }
      
      setSelectedIds(new Set());
      setShowDeleteSelectedConfirm(false);
      setError(null);
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.DELETE, COLLECTIONS.CANONICAL_PRODUCTS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to delete selected products."));
      }
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedAndFilteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedAndFilteredProducts.map(p => p.id)));
    }
  };

  const toggleSelectProduct = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const isUnpriced = (product: CanonicalProduct) => {
    const summary = productPriceSummaries[product.id];
    const hasCostPrice = product.costPrice && product.costPrice > 0;
    const hasLatestPrice = summary?.latest != null;
    const hasBestPrice = summary?.best != null;
    return !hasCostPrice && !hasLatestPrice && !hasBestPrice;
  };

  const sortedAndFilteredProducts = useMemo(() => {
    let result = [...products];
    
    if (searchTerm.trim()) {
      result = result.filter(p => 
        matchesSearch(p.canonicalName, searchTerm) ||
        matchesSearch(p.brand || '', searchTerm) ||
        matchesSearch(p.internalReference || '', searchTerm) ||
        matchesSearch(p.category || '', searchTerm)
      );
    }

    return result.sort((a, b) => {
      // Priority 1: Unpriced first
      const unpricedA = isUnpriced(a);
      const unpricedB = isUnpriced(b);

      if (unpricedA && !unpricedB) return -1;
      if (!unpricedA && unpricedB) return 1;

      // Priority 2: Current selected sort
      const { key, direction } = sortConfig;
      
      if (key === 'pricing') {
        const priceA = a.costPrice || productPriceSummaries[a.id]?.latest?.price || 0;
        const priceB = b.costPrice || productPriceSummaries[b.id]?.latest?.price || 0;
        return direction === 'asc' ? priceA - priceB : priceB - priceA;
      }

      const valA = (a[key as keyof CanonicalProduct] || '').toString().toLowerCase();
      const valB = (b[key as keyof CanonicalProduct] || '').toString().toLowerCase();

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [products, searchTerm, productPriceSummaries, sortConfig]);

  const handleExportExcel = () => {
    const dataToExport = sortedAndFilteredProducts.map(product => {
      const summary = productPriceSummaries[product.id];
      return {
        'Product Name': product.canonicalName,
        'Brand': product.brand || '-',
        'Category': product.category || '-',
        'Internal Reference / SKU': product.internalReference || '-',
        'Capacity': product.capacity || '-',
        'Color': product.color || '-',
        'Version': product.version || '-',
        'Cost Price': product.costPrice || '-',
        'Best Known Price': summary?.best?.price || '-',
        'Latest Price': summary?.latest?.price || '-',
        'Currency': summary?.latest?.currency || '-',
        'Supplier': summary?.supplierName || '-',
        'Status': product.status || 'active'
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-').slice(0, 5);
    XLSX.writeFile(wb, `product_catalog_${date}_${time}.xlsx`);
  };

  const handleSort = (key: keyof CanonicalProduct | 'pricing') => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Product Catalog</h2>
          <p className="text-stone-500">Manage your canonical product registry.</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setShowDeleteSelectedConfirm(true)}
              className="inline-flex items-center justify-center gap-2 bg-red-50 text-red-600 px-4 py-2 rounded-xl font-medium hover:bg-red-100 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete Selected ({selectedIds.size})
            </button>
          )}
          {products.length > 0 && (
            <button
              onClick={handleExportExcel}
              className="inline-flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-700 px-4 py-2 rounded-xl font-medium hover:bg-stone-50 transition-colors"
            >
              <Table className="w-4 h-4" />
              Export to Excel
            </button>
          )}
          {products.length > 0 && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center justify-center gap-2 bg-white border border-red-200 text-red-600 px-4 py-2 rounded-xl font-medium hover:bg-red-50 transition-colors"
            >
              <Trash className="w-4 h-4" />
              Delete All
            </button>
          )}
          <button
            onClick={() => {
              setImportStep('upload');
              setImportFile(null);
              setParsedRows([]);
              setIsImportModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-700 px-4 py-2 rounded-xl font-medium hover:bg-stone-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import Catalog
          </button>
          <button
            onClick={() => {
              setEditingProduct(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-xl font-medium hover:bg-stone-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="Search by name, brand or reference..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all"
          />
        </div>
        <button className="p-2 bg-white border border-stone-200 rounded-xl hover:bg-stone-50">
          <Filter className="w-5 h-5 text-stone-600" />
        </button>
      </div>

      {/* Product List */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                <th className="px-6 py-4 w-10">
                  <input 
                    type="checkbox"
                    checked={sortedAndFilteredProducts.length > 0 && selectedIds.size === sortedAndFilteredProducts.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-stone-900"
                  />
                </th>
                <th 
                  className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-stone-500 cursor-pointer hover:text-stone-900 transition-colors"
                  onClick={() => handleSort('canonicalName')}
                >
                  <div className="flex items-center gap-1">
                    Product
                    {sortConfig.key === 'canonicalName' && (
                      <span className="text-[10px]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-stone-500 cursor-pointer hover:text-stone-900 transition-colors"
                  onClick={() => handleSort('internalReference')}
                >
                  <div className="flex items-center gap-1">
                    Reference
                    {sortConfig.key === 'internalReference' && (
                      <span className="text-[10px]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-stone-500 cursor-pointer hover:text-stone-900 transition-colors"
                  onClick={() => handleSort('brand')}
                >
                  <div className="flex items-center gap-1">
                    Brand/Category
                    {sortConfig.key === 'brand' && (
                      <span className="text-[10px]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-stone-500 cursor-pointer hover:text-stone-900 transition-colors"
                  onClick={() => handleSort('pricing')}
                >
                  <div className="flex items-center gap-1">
                    Pricing Summary
                    {sortConfig.key === 'pricing' && (
                      <span className="text-[10px]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-stone-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-stone-400">Loading catalog...</td>
                </tr>
              ) : sortedAndFilteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center">
                        <Package className="w-6 h-6 text-stone-400" />
                      </div>
                      <div>
                        {searchTerm ? (
                          <>
                            <p className="text-stone-600 font-medium">No products match "{searchTerm}"</p>
                            <p className="text-stone-400 text-sm mt-1">Try a different search term or clear the filter</p>
                          </>
                        ) : products.length === 0 ? (
                          <>
                            <p className="text-stone-600 font-medium">Your catalog is empty</p>
                            <p className="text-stone-400 text-sm mt-1">Import products to get started or create them manually</p>
                          </>
                        ) : (
                          <>
                            <p className="text-stone-600 font-medium">No products to display</p>
                            <p className="text-stone-400 text-sm mt-1">Check your filters or adjust the view</p>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedAndFilteredProducts.map((product) => (
                  <tr key={product.id} className={cn(
                    "hover:bg-stone-50 transition-all duration-150 group",
                    selectedIds.has(product.id) && "bg-stone-50/50",
                    isUnpriced(product) && "bg-amber-50/30"
                  )}>
                    <td className="px-6 py-4">
                      <input 
                        type="checkbox"
                        checked={selectedIds.has(product.id)}
                        onChange={() => toggleSelectProduct(product.id)}
                        className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-stone-900"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center mr-3">
                          <Package className="w-4 h-4 text-stone-500" />
                        </div>
                        <div>
                          <p className="font-medium flex items-center gap-2">
                            {highlightSearchText(product.canonicalName, searchTerm)}
                            {isUnpriced(product) && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-bold rounded uppercase flex items-center gap-1">
                                <AlertCircle className="w-2 h-2" />
                                No Pricing
                              </span>
                            )}
                            {product.meta?.origin === 'supplier_upload' && (
                              <span className="px-1.5 py-0.5 bg-stone-900 text-white text-[8px] font-bold rounded uppercase flex items-center gap-1">
                                <FileText className="w-2 h-2" />
                                From Supplier
                              </span>
                            )}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {product.capacity && (
                              <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-bold rounded uppercase">
                                {product.capacity}
                              </span>
                            )}
                            {product.color && (
                              <span className="px-1.5 py-0.5 bg-stone-100 text-stone-600 text-[9px] font-bold rounded uppercase">
                                {product.color}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-stone-500">
                      {product.internalReference ? highlightSearchText(product.internalReference, searchTerm) : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="text-stone-900">
                        {product.brand ? highlightSearchText(product.brand, searchTerm) : '-'}
                      </span>
                      <span className="text-stone-400 mx-1">/</span>
                      <span className="text-stone-500">
                        {product.category ? highlightSearchText(product.category, searchTerm) : '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {product.costPrice ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-stone-900 font-variant-numeric tabular-nums">
                              ${product.costPrice.toFixed(2)}
                            </span>
                            <span className="px-1 py-0.5 bg-stone-100 text-stone-500 text-[8px] font-bold rounded uppercase">
                              Internal
                            </span>
                          </div>
                        ) : productPriceSummaries[product.id]?.latest ? (
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-stone-900">
                                {(productPriceSummaries[product.id].latest?.price || 0).toLocaleString()} {productPriceSummaries[product.id].latest?.currency}
                              </span>
                              <span className="px-1 py-0.5 bg-blue-50 text-blue-600 text-[8px] font-bold rounded uppercase">
                                Latest
                              </span>
                            </div>
                            <span className="text-[9px] text-stone-400 truncate max-w-[120px]">
                              via {productPriceSummaries[product.id].supplierName}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-amber-500 italic">Not priced yet</span>
                            <span className="text-[9px] text-stone-400">Needs pricing attention</span>
                          </div>
                        )}
                        
                        <div className="flex items-center justify-between mt-1 pt-1 border-t border-stone-50">
                          <span className="text-[10px] text-stone-500 font-bold">
                            Stock: {product.stockQty ?? 0}
                          </span>
                          {productPriceSummaries[product.id]?.best && productPriceSummaries[product.id]?.best?.id !== productPriceSummaries[product.id]?.latest?.id && (
                            <span className="text-[9px] text-emerald-600 font-bold">
                              Best: {(productPriceSummaries[product.id].best?.price || 0).toLocaleString()} {productPriceSummaries[product.id].best?.currency}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingProduct(product);
                            setIsModalOpen(true);
                          }}
                          className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-lg"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setProductToDelete(product)}
                          className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <h3 className="text-lg font-bold">{editingProduct ? 'Edit Product' : 'Add New Product'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-stone-400 hover:text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/20 rounded-lg p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Canonical Name</label>
                <input
                  name="name"
                  required
                  defaultValue={editingProduct?.canonicalName}
                  placeholder="e.g. MacBook Pro M3 14-inch"
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-500 uppercase">Brand</label>
                  <input
                    name="brand"
                    defaultValue={editingProduct?.brand}
                    placeholder="Apple"
                    className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-500 uppercase">Category</label>
                  <input
                    name="category"
                    defaultValue={editingProduct?.category}
                    placeholder="Laptops"
                    className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-500 uppercase">Cost Price</label>
                  <input
                    name="costPrice"
                    type="number"
                    step="0.01"
                    defaultValue={editingProduct?.costPrice}
                    placeholder="0.00"
                    className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-500 uppercase">Stock Quantity</label>
                  <input
                    name="stockQty"
                    type="number"
                    defaultValue={editingProduct?.stockQty}
                    placeholder="0"
                    className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Internal Reference (Odoo SKU)</label>
                <input
                  name="internalReference"
                  defaultValue={editingProduct?.internalReference}
                  placeholder="LAP-MBP-14-M3"
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none font-mono"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-500 uppercase">Capacity</label>
                  <input
                    name="capacity"
                    defaultValue={editingProduct?.capacity}
                    placeholder="512GB"
                    className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-500 uppercase">Color</label>
                  <input
                    name="color"
                    defaultValue={editingProduct?.color}
                    placeholder="Space Gray"
                    className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-500 uppercase">Version</label>
                  <input
                    name="version"
                    defaultValue={editingProduct?.version}
                    placeholder="2024"
                    className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                  />
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-stone-200 rounded-xl font-medium hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-900/20 focus:ring-offset-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900/20 focus:ring-offset-2 transition-colors"
                >
                  {editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>

      {/* Delete All Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-stone-900">Delete All Products?</h3>
                <p className="text-stone-500">
                  This will permanently remove all <span className="font-bold text-stone-900">{products.length}</span> products from your catalog. This action cannot be undone.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeletingAll}
                  className="flex-1 px-4 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-50 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAll}
                  disabled={isDeletingAll}
                  className="flex-1 bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeletingAll ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Yes, Delete All'
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Single Product Delete Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                <Trash2 className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-stone-900">Delete Product?</h3>
                <p className="text-stone-500">
                  Are you sure you want to delete <span className="font-bold text-stone-900">{productToDelete.canonicalName}</span>? This action cannot be undone.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setProductToDelete(null)}
                  disabled={isDeletingSingle}
                  className="flex-1 px-4 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-50 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteSingle}
                  disabled={isDeletingSingle}
                  className="flex-1 bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeletingSingle ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Product'
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Multiple Products Delete Confirmation Modal */}
      {showDeleteSelectedConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                <Trash2 className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-stone-900">Delete Selected Products?</h3>
                <p className="text-stone-500">
                  Are you sure you want to delete <span className="font-bold text-stone-900">{selectedIds.size}</span> selected products? This action cannot be undone.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowDeleteSelectedConfirm(false)}
                  disabled={isDeletingSelected}
                  className="flex-1 px-4 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-50 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={isDeletingSelected}
                  className="flex-1 bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeletingSelected ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Selected'
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center text-stone-600">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Import Product Catalog</h3>
                  <p className="text-xs text-stone-500">Upload Excel or CSV to sync your products.</p>
                </div>
              </div>
              <button onClick={() => setIsImportModalOpen(false)} className="text-stone-400 hover:text-stone-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8">
              <AnimatePresence mode="wait">
                {importStep === 'upload' && (
                  <motion.div 
                    key="upload"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <div 
                      onClick={() => document.getElementById('catalog-file-input')?.click()}
                      className={cn(
                        "border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer",
                        importFile ? "border-emerald-200 bg-emerald-50/30" : "border-stone-200 hover:border-stone-400 hover:bg-stone-50"
                      )}
                    >
                      <input
                        id="catalog-file-input"
                        type="file"
                        onChange={handleFileChange}
                        className="hidden"
                        accept=".xlsx,.xls,.csv"
                      />
                      <div className="space-y-4">
                        <div className={cn(
                          "w-16 h-16 mx-auto rounded-2xl flex items-center justify-center",
                          importFile ? "bg-emerald-100 text-emerald-600" : "bg-stone-100 text-stone-400"
                        )}>
                          <Upload className="w-8 h-8" />
                        </div>
                        <div>
                          <p className="text-lg font-bold">{importFile ? importFile.name : "Select Catalog File"}</p>
                          <p className="text-sm text-stone-500">Excel or CSV files only</p>
                        </div>
                      </div>
                    </div>
                    <button
                      disabled={!importFile}
                      onClick={() => setImportStep('mapping')}
                      className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      Next: Map Columns
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </motion.div>
                )}

                {importStep === 'mapping' && (
                  <motion.div 
                    key="mapping"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: 'Product Name', key: 'productNameColumn', required: true },
                        { label: 'Brand', key: 'brandColumn', required: false },
                        { label: 'Cost Price', key: 'costColumn', required: false },
                        { label: 'Stock Qty', key: 'quantityColumn', required: false },
                        { label: 'SKU / Reference', key: 'skuColumn', required: false },
                        { label: 'Category', key: 'categoryColumn', required: false },
                      ].map((field) => (
                        <div key={field.key} className="space-y-1">
                          <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                            {field.label} {field.required && <span className="text-red-500">*</span>}
                          </label>
                          <select
                            value={columnMapping[field.key as keyof CatalogColumnMapping] || ''}
                            onChange={(e) => setColumnMapping(prev => ({ ...prev, [field.key]: e.target.value || null }))}
                            className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm outline-none"
                          >
                            <option value="">Select column...</option>
                            {columnCandidates.map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-stone-500">
                        <Table className="w-3 h-3" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Preview (First 3 rows)</span>
                      </div>
                      <div className="overflow-x-auto border border-stone-100 rounded-xl">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-stone-50">
                            <tr>
                              {columnCandidates.slice(0, 4).map(col => (
                                <th key={col} className="px-3 py-2 font-bold text-stone-600">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {parsedRows.slice(0, 3).map((row, i) => (
                              <tr key={i} className="border-t border-stone-50">
                                {columnCandidates.slice(0, 4).map(col => (
                                  <td key={col} className="px-3 py-2 text-stone-500 truncate max-w-[100px]">{String(row[col] || '')}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => setImportStep('upload')}
                        className="flex-1 px-4 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-50"
                      >
                        Back
                      </button>
                      <button
                        disabled={!columnMapping.productNameColumn}
                        onClick={handleRunImport}
                        className="flex-[2] bg-stone-900 text-white font-bold py-3 rounded-xl hover:bg-stone-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        Start Import ({parsedRows.length} Rows)
                        <ArrowRight className="w-5 h-5" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {importStep === 'processing' && (
                  <motion.div 
                    key="processing"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="py-12 text-center space-y-4"
                  >
                    <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto">
                      <Loader2 className="w-8 h-8 text-stone-900 animate-spin" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xl font-bold">Importing Catalog</h4>
                      <p className="text-stone-500">Processing rows and updating canonical products...</p>
                    </div>
                  </motion.div>
                )}

                {importStep === 'summary' && importSummary && (
                  <motion.div 
                    key="summary"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6"
                  >
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-center space-y-2">
                      <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <h4 className="text-xl font-bold text-emerald-900">Import Complete!</h4>
                      <p className="text-sm text-emerald-700">Your product catalog has been updated.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-stone-50 rounded-xl border border-stone-100">
                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">New Products</p>
                        <p className="text-2xl font-bold text-stone-900">{importSummary.createdProducts}</p>
                      </div>
                      <div className="p-4 bg-stone-50 rounded-xl border border-stone-100">
                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Updated Products</p>
                        <p className="text-2xl font-bold text-stone-900">{importSummary.updatedProducts}</p>
                      </div>
                      <div className="p-4 bg-stone-50 rounded-xl border border-stone-100">
                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Aliases Created</p>
                        <p className="text-2xl font-bold text-stone-900">{importSummary.createdAliases}</p>
                      </div>
                      <div className="p-4 bg-stone-50 rounded-xl border border-stone-100">
                        <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Duplicates Skipped</p>
                        <p className="text-2xl font-bold text-stone-900">{importSummary.skippedDuplicates}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => setIsImportModalOpen(false)}
                      className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-all"
                    >
                      Close
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Catalog;
