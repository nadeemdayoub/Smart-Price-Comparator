import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, Timestamp, writeBatch, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { MatchReview, CanonicalProduct, Supplier, SupplierUpload, PriceEntry, ExchangeRate } from '../types';
import { ShieldAlert, Search, Filter, Loader2, Package, History, Plus, AlertCircle, CheckCircle2, X, Trash2, ArrowRight, ExternalLink, Calendar, ArrowUpDown, CheckSquare, Square, Download, EyeOff, Layers } from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { COLLECTIONS } from '../services/firestoreCollections';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { syncPriceEntry } from '../services/pricingService';
import { sanitizeFirestoreData } from '../lib/firestore-utils';
import { cn, formatSnapshotDate } from '../lib/utils';
import { matchesSearch, highlightSearchText } from '../lib/search';
import ProductPicker from '../components/ProductPicker';
import CreateProductModal from '../components/CreateProductModal';
import { useNavigate } from 'react-router-dom';

const UnmappedItems: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<MatchReview[]>([]);
  const [products, setProducts] = useState<CanonicalProduct[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [uploads, setUploads] = useState<SupplierUpload[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [sortBy, setSortBy] = useState<'date' | 'supplier' | 'status'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActionType, setBulkActionType] = useState<'match' | 'ignore' | 'create' | null>(null);
  
  const [correctingReview, setCorrectingReview] = useState<MatchReview | null>(null);
  const [creatingProductReview, setCreatingProductReview] = useState<MatchReview | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!profile?.uid) return;

    setLoading(true);
    
    // Fetch all unmapped items (pending, rejected, no_match, low_confidence)
    const reviewsQuery = query(
      collection(db, COLLECTIONS.MATCH_REVIEWS),
      where('ownerUserId', '==', profile.uid),
      where('reviewStatus', 'in', ['pending', 'rejected', 'no_match', 'low_confidence', 'duplicate', 'ignored'])
    );

    const productsQuery = query(
      collection(db, COLLECTIONS.CANONICAL_PRODUCTS),
      where('ownerUserId', '==', profile.uid)
    );

    const suppliersQuery = query(
      collection(db, COLLECTIONS.SUPPLIERS),
      where('ownerUserId', '==', profile.uid)
    );

    const uploadsQuery = query(
      collection(db, COLLECTIONS.SUPPLIER_UPLOADS),
      where('ownerUserId', '==', profile.uid)
    );

    const ratesQuery = query(
      collection(db, COLLECTIONS.EXCHANGE_RATES),
      where('ownerUserId', '==', profile.uid)
    );

    const unsubReviews = onSnapshot(reviewsQuery, (snapshot) => {
      setReviews(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MatchReview)));
      setLoading(false);
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.MATCH_REVIEWS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to load unmapped items."));
      }
      setLoading(false);
    });

    const unsubProducts = onSnapshot(productsQuery, (snapshot) => {
      setProducts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CanonicalProduct)));
    });

    const unsubSuppliers = onSnapshot(suppliersQuery, (snapshot) => {
      setSuppliers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Supplier)));
    });

    const unsubUploads = onSnapshot(uploadsQuery, (snapshot) => {
      setUploads(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SupplierUpload)));
    });

    const unsubRates = onSnapshot(ratesQuery, (snapshot) => {
      setExchangeRates(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ExchangeRate)));
    });

    return () => {
      unsubReviews();
      unsubProducts();
      unsubSuppliers();
      unsubUploads();
      unsubRates();
    };
  }, [profile?.uid]);

  const filteredItems = useMemo(() => {
    return reviews.filter(review => {
      const supplier = suppliers.find(s => s.id === review.supplierId);
      const upload = uploads.find(u => u.id === review.uploadId);
      const searchLower = searchQuery.toLowerCase();
      
      const matchesSearchText = 
        review.rawName.toLowerCase().includes(searchLower) ||
        (review.rawCode || '').toLowerCase().includes(searchLower) ||
        (supplier?.name || '').toLowerCase().includes(searchLower) ||
        (upload?.fileName || '').toLowerCase().includes(searchLower);

      const matchesStatus = statusFilter === 'all' || review.reviewStatus === statusFilter;
      const matchesSupplier = supplierFilter === 'all' || review.supplierId === supplierFilter;

      // Date filtering
      let matchesDate = true;
      if (upload?.createdAt) {
        const uploadDate = upload.createdAt instanceof Timestamp 
          ? upload.createdAt.toDate() 
          : new Date(upload.createdAt);
        
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          if (uploadDate < start) matchesDate = false;
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (uploadDate > end) matchesDate = false;
        }
      }

      return matchesSearchText && matchesStatus && matchesSupplier && matchesDate;
    }).sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'date') {
        const uploadA = uploads.find(u => u.id === a.uploadId);
        const uploadB = uploads.find(u => u.id === b.uploadId);
        const dateA = uploadA?.createdAt?.seconds || 0;
        const dateB = uploadB?.createdAt?.seconds || 0;
        comparison = dateA - dateB;
      } else if (sortBy === 'supplier') {
        const supplierA = suppliers.find(s => s.id === a.supplierId)?.name || '';
        const supplierB = suppliers.find(s => s.id === b.supplierId)?.name || '';
        comparison = (supplierA || '').localeCompare(supplierB || '');
      } else if (sortBy === 'status') {
        comparison = (a.reviewStatus || '').localeCompare(b.reviewStatus || '');
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [reviews, products, suppliers, uploads, searchQuery, statusFilter, supplierFilter, startDate, endDate, sortBy, sortOrder]);

  const handleCorrectMatch = async (newProductId: string | null) => {
    if (!correctingReview || !profile?.uid) return;
    
    setIsProcessing(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, correctingReview.id);
      
      // 1. Update MatchReview
      const reviewUpdate: Partial<MatchReview> = {
        ownerUserId: profile.uid,
        finalProductId: newProductId || null,
        reviewStatus: newProductId ? 'approved' : 'rejected',
        finalAction: newProductId ? 'manual' : 'reject',
        reviewedAt: Timestamp.now(),
        reviewedBy: profile.uid
      };
      batch.update(reviewRef, sanitizeFirestoreData(reviewUpdate));

      // 2. Sync PriceEntry if matched
      syncPriceEntry(batch, {
        reviewId: correctingReview.id,
        ownerUserId: profile.uid,
        uploadId: correctingReview.uploadId!,
        supplierId: correctingReview.supplierId!,
        productId: newProductId,
        price: correctingReview.rawPrice,
        currency: correctingReview.rawCurrency,
        rates: exchangeRates,
        status: newProductId ? 'approved' : 'rejected'
      });

      // 3. Audit Log
      const auditRef = doc(collection(db, COLLECTIONS.AUDIT_LOGS));
      batch.set(auditRef, {
        ownerUserId: profile.uid,
        userId: profile.uid,
        actionType: 'match_correction_from_unmapped',
        entityType: 'match_review',
        entityId: correctingReview.id,
        description: `Corrected match for "${correctingReview.rawName}" from Unmapped Items`,
        meta: {
          newProductId,
          oldStatus: correctingReview.reviewStatus,
          newStatus: newProductId ? 'approved' : 'rejected',
          uploadId: correctingReview.uploadId,
          supplierId: correctingReview.supplierId
        },
        createdAt: Timestamp.now()
      });

      await batch.commit();
      setCorrectingReview(null);
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to correct match."));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkIgnore = async () => {
    if (selectedIds.length === 0 || !profile?.uid) return;
    
    setIsProcessing(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      const affectedReviews = reviews.filter(r => selectedIds.includes(r.id));
      
      affectedReviews.forEach(review => {
        const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, review.id);
        batch.update(reviewRef, sanitizeFirestoreData({
          ownerUserId: profile.uid,
          finalProductId: null,
          reviewStatus: 'ignored',
          finalAction: 'ignore',
          reviewedAt: Timestamp.now(),
          reviewedBy: profile.uid
        }));
      });

      // Audit Log
      const auditRef = doc(collection(db, COLLECTIONS.AUDIT_LOGS));
      batch.set(auditRef, {
        ownerUserId: profile.uid,
        userId: profile.uid,
        actionType: 'bulk_ignore_unmapped',
        entityType: 'match_review',
        description: `Bulk ignored ${selectedIds.length} unmapped items`,
        meta: {
          affectedIds: selectedIds,
          newStatus: 'ignored'
        },
        createdAt: Timestamp.now()
      });

      await batch.commit();
      setSelectedIds([]);
      setBulkActionType(null);
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to ignore items."));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkMatch = async (productId: string) => {
    if (selectedIds.length === 0 || !profile?.uid) return;
    
    setIsProcessing(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      const affectedReviews = reviews.filter(r => selectedIds.includes(r.id));
      
      affectedReviews.forEach(review => {
        const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, review.id);
        batch.update(reviewRef, sanitizeFirestoreData({
          ownerUserId: profile.uid,
          finalProductId: productId || null,
          reviewStatus: 'approved',
          finalAction: 'manual',
          reviewedAt: Timestamp.now(),
          reviewedBy: profile.uid
        }));

        syncPriceEntry(batch, {
          reviewId: review.id,
          ownerUserId: profile.uid,
          uploadId: review.uploadId!,
          supplierId: review.supplierId!,
          productId: productId,
          price: review.rawPrice,
          currency: review.rawCurrency,
          rates: exchangeRates,
          status: 'approved'
        });
      });

      // Audit Log
      const auditRef = doc(collection(db, COLLECTIONS.AUDIT_LOGS));
      batch.set(auditRef, {
        ownerUserId: profile.uid,
        userId: profile.uid,
        actionType: 'bulk_match_unmapped',
        entityType: 'match_review',
        description: `Bulk matched ${selectedIds.length} items to product ID ${productId}`,
        meta: {
          affectedIds: selectedIds,
          newProductId: productId,
          newStatus: 'approved'
        },
        createdAt: Timestamp.now()
      });

      await batch.commit();
      setSelectedIds([]);
      setBulkActionType(null);
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to match items."));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkExport = () => {
    if (selectedIds.length === 0) return;
    
    const selectedReviews = filteredItems.filter(r => selectedIds.includes(r.id));
    const data = selectedReviews.map(review => {
      const supplier = suppliers.find(s => s.id === review.supplierId);
      const upload = uploads.find(u => u.id === review.uploadId);
      return {
        'Supplier': supplier?.name || 'Unknown',
        'Snapshot': upload?.fileName || 'Unknown',
        'Upload Date': formatSnapshotDate(upload),
        'Raw Name': review.rawName,
        'Raw Code': review.rawCode || 'N/A',
        'Price': review.rawPrice,
        'Currency': review.rawCurrency,
        'Status': review.reviewStatus
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Unmapped Items');
    XLSX.writeFile(wb, `unmapped_items_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const suggestGroups = () => {
    // Simple grouping: items with similar names (first 3 words)
    const groups: Record<string, string[]> = {};
    
    filteredItems.forEach(item => {
      const words = item.rawName.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 3);
      if (words.length >= 2) {
        const key = words.join(' ');
        if (!groups[key]) groups[key] = [];
        groups[key].push(item.id);
      }
    });

    // Find the largest group that isn't already fully selected
    const sortedGroups = Object.entries(groups)
      .filter(([_, ids]) => ids.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [_, ids] of sortedGroups) {
      const unselectedInGroup = ids.filter(id => !selectedIds.includes(id));
      if (unselectedInGroup.length > 0) {
        setSelectedIds(prev => [...new Set([...prev, ...ids])]);
        return; // Select one group at a time for clarity
      }
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map(i => i.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'rejected': return { label: 'Rejected', color: 'bg-red-50 text-red-600 border-red-100' };
      case 'ignored': return { label: 'Ignored', color: 'bg-stone-100 text-stone-600 border-stone-200' };
      case 'no_match': return { label: 'No Match', color: 'bg-stone-50 text-stone-500 border-stone-100' };
      case 'low_confidence': return { label: 'Low Confidence', color: 'bg-amber-50 text-amber-600 border-amber-100' };
      case 'pending': return { label: 'Pending', color: 'bg-blue-50 text-blue-600 border-blue-100' };
      case 'duplicate': return { label: 'Duplicate', color: 'bg-stone-50 text-stone-400 border-stone-100' };
      default: return { label: status, color: 'bg-stone-50 text-stone-500 border-stone-100' };
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 text-stone-300 animate-spin" />
        <p className="text-stone-400 font-bold animate-pulse">Loading unmapped items...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-amber-500" />
            Unmapped Items
          </h2>
          <p className="text-stone-500">Manage supplier items that couldn't be automatically matched.</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-stone-900 text-white px-6 py-4 rounded-2xl shadow-2xl z-[150] flex items-center gap-6 border border-white/10"
          >
            <div className="flex items-center gap-2 pr-6 border-r border-white/10">
              <CheckSquare className="w-5 h-5 text-emerald-400" />
              <span className="font-bold">{selectedIds.length} items selected</span>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => setBulkActionType('create')}
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-xl transition-colors text-sm font-bold"
              >
                <Plus className="w-4 h-4" />
                Create Products
              </button>
              <button 
                onClick={() => setBulkActionType('match')}
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-xl transition-colors text-sm font-bold"
              >
                <Layers className="w-4 h-4" />
                Bulk Match
              </button>
              <button 
                onClick={() => setBulkActionType('ignore')}
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-xl transition-colors text-sm font-bold text-stone-400 hover:text-white"
              >
                <EyeOff className="w-4 h-4" />
                Ignore
              </button>
              <button 
                onClick={handleBulkExport}
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-xl transition-colors text-sm font-bold text-stone-400 hover:text-white"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>

            <button 
              onClick={() => setSelectedIds([])}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters */}
      <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
            <input 
              type="text" 
              placeholder="Search items, suppliers or snapshots..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-stone-50 border border-stone-100 rounded-2xl focus:ring-2 focus:ring-stone-900/5 outline-none transition-all"
            />
          </div>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-3 bg-stone-50 border border-stone-100 rounded-2xl focus:ring-2 focus:ring-stone-900/5 outline-none transition-all"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="no_match">No Match</option>
            <option value="low_confidence">Low Confidence</option>
            <option value="rejected">Rejected</option>
            <option value="ignored">Ignored</option>
            <option value="duplicate">Duplicate</option>
          </select>
          <select 
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="px-4 py-3 bg-stone-50 border border-stone-100 rounded-2xl focus:ring-2 focus:ring-stone-900/5 outline-none transition-all"
          >
            <option value="all">All Suppliers</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-stone-400" />
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="flex-1 px-3 py-2 bg-stone-50 border border-stone-100 rounded-xl text-xs outline-none"
            />
            <span className="text-stone-300">-</span>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="flex-1 px-3 py-2 bg-stone-50 border border-stone-100 rounded-xl text-xs outline-none"
            />
          </div>

          <div className="flex items-center gap-2 md:col-span-2">
            <Filter className="w-4 h-4 text-stone-400" />
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 bg-stone-50 border border-stone-100 rounded-xl text-xs outline-none"
            >
              <option value="date">Sort by Date</option>
              <option value="supplier">Sort by Supplier</option>
              <option value="status">Sort by Status</option>
            </select>
            <button 
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-2 bg-stone-50 border border-stone-100 rounded-xl hover:bg-stone-100 transition-colors"
            >
              <ArrowUpDown className="w-4 h-4 text-stone-600" />
            </button>
          </div>

          <button 
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setSupplierFilter('all');
              setStartDate('');
              setEndDate('');
              setSortBy('date');
              setSortOrder('desc');
            }}
            className="text-xs font-bold text-stone-400 hover:text-stone-900 transition-colors text-right"
          >
            Clear Filters
          </button>
        </div>

        <div className="pt-4 border-t border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={suggestGroups}
              className="inline-flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-600 text-xs font-bold rounded-xl hover:bg-stone-200 transition-all"
            >
              <Layers className="w-3 h-3" />
              Suggest Groups
            </button>
            <p className="text-xs text-stone-400">
              Groups similar unmapped items for faster bulk matching.
            </p>
          </div>
          {selectedIds.length > 0 && (
            <button 
              onClick={() => setSelectedIds([])}
              className="text-xs font-bold text-red-500 hover:text-red-600 transition-colors"
            >
              Clear Selection ({selectedIds.length})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                <th className="px-6 py-4 w-10">
                  <button 
                    onClick={toggleSelectAll}
                    className="p-1 hover:bg-stone-200 rounded-md transition-colors"
                  >
                    {selectedIds.length === filteredItems.length && filteredItems.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Square className="w-4 h-4 text-stone-300" />
                    )}
                  </button>
                </th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  <button onClick={() => { setSortBy('status'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }} className="flex items-center gap-1">
                    Status
                    {sortBy === 'status' && <ArrowUpDown className="w-3 h-3" />}
                  </button>
                </th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  <button onClick={() => { setSortBy('supplier'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }} className="flex items-center gap-1">
                    Supplier / Snapshot
                    {sortBy === 'supplier' && <ArrowUpDown className="w-3 h-3" />}
                  </button>
                </th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">Original Item</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">Price</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-stone-400 font-medium">
                    No unmapped items found.
                  </td>
                </tr>
              ) : (
                filteredItems.map(review => {
                  const supplier = suppliers.find(s => s.id === review.supplierId);
                  const upload = uploads.find(u => u.id === review.uploadId);
                  const badge = getStatusBadge(review.reviewStatus);

                  return (
                    <tr key={review.id} className={cn(
                      "hover:bg-stone-50/50 transition-colors group",
                      selectedIds.includes(review.id) && "bg-stone-50"
                    )}>
                      <td className="px-6 py-4">
                        <button onClick={() => toggleSelect(review.id)} className="p-1 hover:bg-stone-200 rounded transition-colors">
                          {selectedIds.includes(review.id) ? (
                            <CheckSquare className="w-4 h-4 text-stone-900" />
                          ) : (
                            <Square className="w-4 h-4 text-stone-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider",
                          badge.color
                        )}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-stone-900">{supplier?.name || 'Unknown'}</span>
                          <button 
                            onClick={() => navigate(`/app/suppliers/${review.supplierId}/snapshots/${review.uploadId}`)}
                            className="text-[10px] text-stone-400 font-medium hover:text-stone-900 flex items-center gap-1"
                          >
                            {upload?.fileName || 'Unknown Snapshot'}
                            <ExternalLink className="w-2 h-2" />
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-stone-700">{highlightSearchText(review.rawName, searchQuery)}</span>
                          {review.rawCode && <span className="text-[10px] text-stone-400 font-mono">{review.rawCode}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-bold text-stone-900">
                          {(review.rawPrice || 0).toLocaleString()} {review.rawCurrency}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => setCreatingProductReview(review)}
                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-900 text-white text-xs font-bold rounded-xl hover:bg-stone-800 transition-all"
                          >
                            <Plus className="w-3 h-3" />
                            Create Product
                          </button>
                          <button 
                            onClick={() => setCorrectingReview(review)}
                            className="p-2 text-stone-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Correct Match"
                          >
                            <History className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correct Match Modal */}
      <AnimatePresence>
        {correctingReview && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Correct Match</h3>
                <button onClick={() => setCorrectingReview(null)} className="p-2 hover:bg-stone-100 rounded-full">
                  <X className="w-5 h-5 text-stone-400" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Original Item</p>
                  <p className="font-bold text-stone-900">{correctingReview.rawName}</p>
                  {correctingReview.rawCode && <p className="text-xs text-stone-500 font-mono mt-1">{correctingReview.rawCode}</p>}
                </div>

                <div>
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Select Product from Catalog</p>
                  <ProductPicker 
                    products={products}
                    onSelect={(productId) => handleCorrectMatch(productId)}
                    placeholder="Search for a product to match..."
                  />
                </div>

                <div className="pt-4 border-t border-stone-100 flex gap-3">
                  <button 
                    onClick={() => handleCorrectMatch(null)}
                    disabled={isProcessing}
                    className="flex-1 px-4 py-3 bg-red-50 text-red-600 border border-red-100 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Mark as Rejected
                  </button>
                  <button 
                    onClick={() => setCorrectingReview(null)}
                    className="flex-1 px-4 py-3 border border-stone-200 rounded-2xl font-bold hover:bg-stone-50 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Product Modal */}
      {creatingProductReview && (
        <CreateProductModal 
          review={creatingProductReview}
          onClose={() => setCreatingProductReview(null)}
          onSuccess={() => {
            setCreatingProductReview(null);
            // Local update is handled by onSnapshot
          }}
        />
      )}

      {/* Bulk Match Modal */}
      <AnimatePresence>
        {bulkActionType === 'match' && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold">Bulk Match Selected</h3>
                  <p className="text-sm text-stone-500">Apply one product to {selectedIds.length} items.</p>
                </div>
                <button onClick={() => setBulkActionType(null)} className="p-2 hover:bg-stone-100 rounded-full">
                  <X className="w-5 h-5 text-stone-400" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="max-h-40 overflow-y-auto space-y-2 p-4 bg-stone-50 rounded-2xl border border-stone-100">
                  {reviews.filter(r => selectedIds.includes(r.id)).map(r => (
                    <div key={r.id} className="text-xs font-medium text-stone-600 flex items-center gap-2">
                      <div className="w-1 h-1 bg-stone-400 rounded-full" />
                      {r.rawName}
                    </div>
                  ))}
                </div>

                <div>
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Select Target Product</p>
                  <ProductPicker 
                    products={products}
                    onSelect={(productId) => productId && handleBulkMatch(productId)}
                    placeholder="Search for a product to match all..."
                  />
                </div>

                <div className="pt-4 border-t border-stone-100 flex gap-3">
                  <button 
                    onClick={() => setBulkActionType(null)}
                    className="flex-1 px-4 py-3 border border-stone-200 rounded-2xl font-bold hover:bg-stone-50 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk Ignore Confirmation */}
      <AnimatePresence>
        {bulkActionType === 'ignore' && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-stone-100 text-stone-600 rounded-2xl flex items-center justify-center">
                  <EyeOff className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Ignore Selected Items?</h3>
                  <p className="text-sm text-stone-500">These {selectedIds.length} items will be hidden from comparison.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setBulkActionType(null)}
                  className="flex-1 px-4 py-3 border border-stone-200 rounded-2xl font-bold hover:bg-stone-50 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleBulkIgnore}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-3 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all flex items-center justify-center gap-2"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm Ignore
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk Create Flow */}
      {bulkActionType === 'create' && (
        <BulkCreateFlow 
          reviews={reviews.filter(r => selectedIds.includes(r.id))}
          onClose={() => {
            setBulkActionType(null);
            setSelectedIds([]);
          }}
        />
      )}
    </div>
  );
};

interface BulkCreateFlowProps {
  reviews: MatchReview[];
  onClose: () => void;
}

const BulkCreateFlow: React.FC<BulkCreateFlowProps> = ({ reviews, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentReview = reviews[currentIndex];

  if (!currentReview) return null;

  return (
    <div className="fixed inset-0 bg-stone-900/80 backdrop-blur-md z-[300] flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="flex items-center justify-between mb-4 text-white">
          <div className="flex items-center gap-3">
            <div className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold">
              {currentIndex + 1} of {reviews.length}
            </div>
            <h3 className="text-lg font-bold">Bulk Create Products</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <CreateProductModal 
          key={currentReview.id}
          review={currentReview}
          onClose={onClose}
          onSuccess={() => {
            if (currentIndex < reviews.length - 1) {
              setCurrentIndex(currentIndex + 1);
            } else {
              onClose();
            }
          }}
        />
      </div>
    </div>
  );
};

export default UnmappedItems;
