import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, deleteDoc, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { PriceEntry, SupplierUpload, CanonicalProduct, MatchReview, Supplier, ExchangeRate } from '../types';
import { ArrowLeft, Loader2, FileText, Trash2, Edit2, Save, X, AlertCircle, Package, DollarSign, Tag, Search, CheckCircle2, History, Plus, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { COLLECTIONS } from '../services/firestoreCollections';
import { cn } from '../lib/utils';
import { sanitizeFirestoreData } from '../lib/firestore-utils';
import { matchesSearch, highlightSearchText } from '../lib/search';
import ProductPicker from '../components/ProductPicker';
import CreateProductModal from '../components/CreateProductModal';
import { syncPriceEntry, convertPrice } from '../services/pricingService';

const SnapshotDetails: React.FC = () => {
  const { supplierId, uploadId } = useParams<{ supplierId: string; uploadId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [snapshot, setSnapshot] = useState<SupplierUpload | null>(null);
  const [items, setItems] = useState<PriceEntry[]>([]);
  const [products, setProducts] = useState<CanonicalProduct[]>([]);
  const [reviews, setReviews] = useState<MatchReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PriceEntry | null>(null);
  const [editValues, setEditValues] = useState<{
    price: number;
    currency: string;
    usdPrice: number;
  } | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [isConfirmingDeleteSnapshot, setIsConfirmingDeleteSnapshot] = useState(false);
  const [isDeletingSnapshot, setIsDeletingSnapshot] = useState(false);
  const [isUpdatingItem, setIsUpdatingItem] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [correctingReview, setCorrectingReview] = useState<MatchReview | null>(null);
  const [creatingProductReview, setCreatingProductReview] = useState<MatchReview | null>(null);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalculateSuccess, setRecalculateSuccess] = useState(false);

  useEffect(() => {
    if (profile) {
      console.log("SnapshotDetails: Current Profile", {
        uid: profile.uid,
        role: profile.role,
        email: profile.email
      });
    }
  }, [profile]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile?.uid || !supplierId || !uploadId) {
        console.log("Waiting for profile/params...", { profileUid: profile?.uid, supplierId, uploadId });
        return;
      }
      
      console.log("Fetching snapshot details for:", { profileUid: profile.uid, supplierId, uploadId });
      setLoading(true);
      setError(null);
      try {
        const [supplierDoc, snapshotDoc, itemsSnap, productsSnap, reviewsSnap, ratesSnap] = await Promise.all([
          getDoc(doc(db, COLLECTIONS.SUPPLIERS, supplierId)),
          getDoc(doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId)),
          getDocs(query(collection(db, COLLECTIONS.PRICE_ENTRIES), where('ownerUserId', '==', profile.uid), where('uploadId', '==', uploadId))),
          getDocs(query(collection(db, COLLECTIONS.CANONICAL_PRODUCTS), where('ownerUserId', '==', profile.uid))),
          getDocs(query(collection(db, COLLECTIONS.MATCH_REVIEWS), where('ownerUserId', '==', profile.uid), where('uploadId', '==', uploadId))),
          getDocs(query(collection(db, COLLECTIONS.EXCHANGE_RATES), where('ownerUserId', '==', profile.uid)))
        ]);

        if (!supplierDoc.exists()) {
          setError("Supplier not found.");
          return;
        }
        if (!snapshotDoc.exists()) {
          setError("Snapshot not found.");
          return;
        }

        const supplierData = { id: supplierDoc.id, ...supplierDoc.data() } as Supplier;
        const snapshotData = { id: snapshotDoc.id, ...snapshotDoc.data() } as SupplierUpload;

        console.log("Snapshot data loaded:", snapshotData);

        // Verify ownership scoping
        if (profile.role !== 'super_admin' && (supplierData.ownerUserId !== profile.uid || snapshotData.ownerUserId !== profile.uid)) {
          console.warn("Ownership mismatch:", { supplierOwner: supplierData.ownerUserId, snapshotOwner: snapshotData.ownerUserId, userUid: profile.uid });
          setError("You do not have permission to view this snapshot.");
          return;
        }

        setSupplier(supplierData);
        setSnapshot(snapshotData);
        
        setItems(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as PriceEntry)));
        setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as CanonicalProduct)));
        setReviews(reviewsSnap.docs.map(d => ({ id: d.id, ...d.data() } as MatchReview)));
        setExchangeRates(ratesSnap.docs.map(d => ({ id: d.id, ...d.data() } as ExchangeRate)));
      } catch (err: any) {
        console.error("Error loading snapshot details:", err);
        try {
          handleFirestoreError(err, OperationType.GET, COLLECTIONS.PRICE_ENTRIES);
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to load snapshot details."));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [profile?.uid, supplierId, uploadId]);

  // Duplicate detection logic
  const duplicateCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    reviews.forEach(r => {
      const key = `${r.rawName.toLowerCase().trim()}-${(r.rawCode || '').toLowerCase().trim()}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [reviews]);

  const handleRecalculatePrices = async () => {
    if (!profile?.uid || !uploadId) return;
    
    setIsRecalculating(true);
    setError(null);
    setRecalculateSuccess(false);
    
    try {
      // 1. Re-fetch latest exchange rates
      const ratesQuery = query(collection(db, COLLECTIONS.EXCHANGE_RATES), where('ownerUserId', '==', profile.uid));
      
      const ratesSnap = await getDocs(ratesQuery);
      const latestRates = ratesSnap.docs.map(d => ({ id: d.id, ...d.data() } as ExchangeRate));
      setExchangeRates(latestRates);

      const batch = writeBatch(db);
      let updatedCount = 0;

      // 2. Recalculate all price entries
      items.forEach(item => {
        const newUsdPrice = convertPrice(item.price, item.currency, latestRates) || 0;

        if (newUsdPrice !== null) {
          if (Math.abs(newUsdPrice - item.priceInDefaultCurrency) > 0.001) {
            batch.update(doc(db, COLLECTIONS.PRICE_ENTRIES, item.id), {
              priceInDefaultCurrency: newUsdPrice,
              updatedAt: Timestamp.now(),
              ownerUserId: profile.uid
            });
            updatedCount++;
          }
        }
      });

      if (updatedCount > 0) {
        await batch.commit();
        // Refresh local state
        setItems(prev => prev.map(item => {
          const newUsdPrice = convertPrice(item.price, item.currency, latestRates) || 0;
          if (newUsdPrice !== null) {
            return { ...item, priceInDefaultCurrency: newUsdPrice };
          }
          return item;
        }));
      }

      setRecalculateSuccess(true);
      setTimeout(() => setRecalculateSuccess(false), 3000);
    } catch (err: any) {
      console.error("Error recalculating prices:", err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, COLLECTIONS.PRICE_ENTRIES);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to recalculate prices."));
      }
    } finally {
      setIsRecalculating(false);
    }
  };

  const getStatusInfo = (review: MatchReview) => {
    const key = `${review.rawName.toLowerCase().trim()}-${(review.rawCode || '').toLowerCase().trim()}`;
    const isDuplicate = duplicateCounts[key] > 1;
    const dupSuffix = isDuplicate ? ` (x${duplicateCounts[key]})` : '';

    if (review.reviewStatus === 'rejected') {
      return { label: `Rejected${dupSuffix}`, color: 'bg-red-50 text-red-600 border-red-100' };
    }
    
    if (review.reviewStatus === 'approved' || review.finalAction === 'approve_suggested' || review.finalAction === 'manual' || review.finalAction === 'create_new_product') {
      const isManual = review.finalAction === 'manual' || (review.reviewedBy && review.reviewedBy !== 'system_auto_approve');
      const isCreated = review.finalAction === 'create_new_product';
      
      let label = 'Approved Auto';
      if (isManual) label = 'Approved Manual';
      if (isCreated) label = 'Created & Matched';
      
      return { 
        label: `${label}${dupSuffix}`, 
        color: 'bg-emerald-50 text-emerald-600 border-emerald-100' 
      };
    }

    if (!review.suggestedProductId && review.reviewStatus === 'pending') {
      return { label: `No Match${dupSuffix}`, color: 'bg-stone-50 text-stone-500 border-stone-100' };
    }

    if (review.confidenceScore < 0.6 && review.reviewStatus === 'pending') {
      return { label: `Low Confidence${dupSuffix}`, color: 'bg-amber-50 text-amber-600 border-amber-100' };
    }

    return { label: `Pending${dupSuffix}`, color: 'bg-blue-50 text-blue-600 border-blue-100' };
  };

  const filteredItems = React.useMemo(() => {
    return reviews.filter(review => {
      const product = products.find(p => p.id === (review.finalProductId || review.suggestedProductId));
      const searchLower = searchQuery.toLowerCase();
      
      return (
        review.rawName.toLowerCase().includes(searchLower) ||
        (review.rawCode || '').toLowerCase().includes(searchLower) ||
        product?.canonicalName.toLowerCase().includes(searchLower) ||
        product?.internalReference?.toLowerCase().includes(searchLower)
      );
    }).sort((a, b) => (a.rawName || '').localeCompare(b.rawName || ''));
  }, [reviews, products, searchQuery]);

  const stats = {
    totalItems: reviews.length,
    matchedItems: reviews.filter(r => r.reviewStatus === 'approved').length,
    avgPrice: items.length > 0 
      ? items.reduce((acc, curr) => acc + curr.priceInDefaultCurrency, 0) / items.length 
      : 0,
    currency: supplier?.defaultCurrency || 'USD'
  };

  const handleCorrectMatch = async (newProductId: string | null) => {
    if (!correctingReview || !profile?.uid) return;
    
    setIsCorrecting(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, correctingReview.id);
      const existingPriceEntry = items.find(i => i.reviewItemId === correctingReview.id);
      
      const oldProductId = correctingReview.finalProductId || correctingReview.suggestedProductId;
      const oldStatus = correctingReview.reviewStatus;
      
      // 1. Update MatchReview
      const reviewUpdate: Partial<MatchReview> = {
        ownerUserId: snapshot?.ownerUserId || profile?.uid || '',
        finalProductId: newProductId || null,
        reviewStatus: newProductId ? 'approved' : 'rejected',
        finalAction: newProductId ? 'manual' : 'reject',
        reviewedAt: Timestamp.now(),
        reviewedBy: profile.uid
      };
      batch.update(reviewRef, sanitizeFirestoreData(reviewUpdate));
 
       // 2. Update PriceEntry (using unified service)
       syncPriceEntry(batch, {
         reviewId: correctingReview.id,
         ownerUserId: snapshot?.ownerUserId || profile?.uid || '',
         uploadId: uploadId!,
         supplierId: supplierId!,
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
         actionType: 'match_correction',
         entityType: 'match_review',
         entityId: correctingReview.id,
         description: `Corrected match for "${correctingReview.rawName}"`,
         meta: {
           oldProductId: oldProductId || null,
           newProductId: newProductId || null,
           oldStatus: oldStatus || null,
           newStatus: newProductId ? 'approved' : 'rejected',
           uploadId: uploadId || null
         },
         createdAt: Timestamp.now()
       });
 
       await batch.commit();
       
       // Update local state
       setReviews(prev => prev.map(r => r.id === correctingReview.id ? { ...r, ...reviewUpdate } : r));
       
       // Re-fetch items to ensure local state is consistent with Firestore
       const itemsQuery = query(collection(db, COLLECTIONS.PRICE_ENTRIES), where('ownerUserId', '==', profile.uid), where('uploadId', '==', uploadId));
       
       const itemsSnap = await getDocs(itemsQuery);
       setItems(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as PriceEntry)));

      setCorrectingReview(null);
    } catch (err: any) {
      console.error("Error correcting match:", err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, COLLECTIONS.MATCH_REVIEWS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to correct match."));
      }
    } finally {
      setIsCorrecting(false);
    }
  };

  const handleUpdateItem = async (e?: React.BaseSyntheticEvent) => {
    if (e) e.preventDefault();
    if (!editingItem || !editValues || !profile?.uid) {
      console.warn("Update aborted: missing required data", { editingItem, editValues, profileUid: profile?.uid });
      return;
    }
    
    setIsUpdatingItem(true);
    try {
      const { price, currency } = editValues;
      const usdPrice = convertPrice(price, currency, exchangeRates) || 0;
 
       if (isNaN(price) || isNaN(usdPrice)) {
         setError("Invalid price values.");
         setIsUpdatingItem(false);
         return;
       }
 
       console.log(`Updating item ${editingItem.id}...`, { price, currency, usdPrice });
 
       const itemRef = doc(db, COLLECTIONS.PRICE_ENTRIES, editingItem.id);
       const updateData = {
         price,
         currency: (currency || 'USD').toUpperCase(),
         priceInDefaultCurrency: usdPrice,
         updatedAt: Timestamp.now(),
         ownerUserId: profile.uid
       };

      await updateDoc(itemRef, updateData);

      console.log("Update successful");

      setItems(prev => prev.map(item => 
        item.id === editingItem.id ? { 
          ...item, 
          ...updateData
        } : item
      ));
      setEditingItem(null);
      setEditValues(null);
      setError(null);
    } catch (err: any) {
      console.error("Error updating item:", err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, `${COLLECTIONS.PRICE_ENTRIES}/${editingItem.id}`);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to update item."));
      }
    } finally {
      setIsUpdatingItem(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deletingItemId || !profile?.uid) return;
    
    const itemToDelete = items.find(i => i.id === deletingItemId);
    if (!itemToDelete) return;

    console.log(`Deleting item ${deletingItemId}...`);
    try {
      const batch = writeBatch(db);
      
      // 1. Delete the PriceEntry
      batch.delete(doc(db, COLLECTIONS.PRICE_ENTRIES, deletingItemId));
      
      // 2. Update the MatchReview to 'rejected'
      if (itemToDelete.reviewItemId) {
        const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, itemToDelete.reviewItemId);
        batch.update(reviewRef, {
          ownerUserId: profile.uid,
          reviewStatus: 'rejected',
          finalProductId: null,
          finalAction: 'reject',
          reviewedAt: Timestamp.now(),
          reviewedBy: profile.uid
        });
      }
      
      await batch.commit();
      
      console.log("Delete successful");
      setItems(prev => prev.filter(item => item.id !== deletingItemId));
      
      // Also update local reviews state if we updated a review
      if (itemToDelete.reviewItemId) {
        setReviews(prev => prev.map(r => 
          r.id === itemToDelete.reviewItemId 
            ? { ...r, reviewStatus: 'rejected', finalProductId: null, finalAction: 'reject' } 
            : r
        ));
      }
      
      setDeletingItemId(null);
      setError(null);
    } catch (err: any) {
      console.error("Error deleting item:", err);
      try {
        handleFirestoreError(err, OperationType.DELETE, COLLECTIONS.PRICE_ENTRIES);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to delete item."));
      }
    }
  };

  const handleDeleteSnapshot = async () => {
    if (!uploadId || !profile?.uid) return;
    console.log(`Deleting snapshot ${uploadId}...`);
    setIsDeletingSnapshot(true);
    setError(null);
    try {
      // 1. Delete all related records
      const [itemsSnap, reviewsSnap, rawItemsSnap] = await Promise.all([
        getDocs(query(collection(db, COLLECTIONS.PRICE_ENTRIES), where('ownerUserId', '==', profile.uid), where('uploadId', '==', uploadId))),
        getDocs(query(collection(db, COLLECTIONS.MATCH_REVIEWS), where('ownerUserId', '==', profile.uid), where('uploadId', '==', uploadId))),
        getDocs(query(collection(db, COLLECTIONS.UPLOAD_ITEMS_RAW), where('ownerUserId', '==', profile.uid), where('uploadId', '==', uploadId)))
      ]);

      console.log(`Found ${itemsSnap.size} price entries, ${reviewsSnap.size} reviews, and ${rawItemsSnap.size} raw items to delete.`);
      
      const batch = writeBatch(db);
      
      itemsSnap.docs.forEach(d => batch.delete(d.ref));
      reviewsSnap.docs.forEach(d => batch.delete(d.ref));
      rawItemsSnap.docs.forEach(d => batch.delete(d.ref));
      batch.delete(doc(db, COLLECTIONS.SUPPLIER_UPLOADS, uploadId));

      await batch.commit();
      console.log("Snapshot and all related data deleted successfully");
      
      navigate(`/app/suppliers/${supplierId}/snapshots`);
    } catch (err: any) {
      console.error("Error deleting snapshot:", err);
      try {
        handleFirestoreError(err, OperationType.DELETE, COLLECTIONS.SUPPLIER_UPLOADS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to delete snapshot."));
      }
      setIsDeletingSnapshot(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 text-stone-300 animate-spin" />
        <p className="text-stone-400 font-bold animate-pulse">Loading snapshot items...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate(`/app/suppliers/${supplierId}/snapshots`)}
            className="p-2 hover:bg-stone-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-stone-600" />
          </button>
          <div>
            <h2 className="text-2xl font-bold">Snapshot Details</h2>
            <p className="text-stone-500">
              {supplier?.name} • {snapshot?.fileName} • {snapshot ? new Date((snapshot.finalizedAt?.seconds || snapshot.createdAt?.seconds || 0) * 1000).toLocaleDateString() : 'Loading...'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleRecalculatePrices}
            disabled={isRecalculating}
            className={cn(
              "px-4 py-2 border rounded-xl text-sm font-bold transition-all flex items-center gap-2",
              recalculateSuccess 
                ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
            )}
          >
            {isRecalculating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : recalculateSuccess ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <RefreshCcw className="w-4 h-4 text-stone-400" />
            )}
            {recalculateSuccess ? "Refreshed!" : "Refresh USD Values"}
          </button>

          <button 
            onClick={() => setIsConfirmingDeleteSnapshot(true)}
            disabled={isDeletingSnapshot}
            className="px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl text-sm font-bold hover:bg-red-100 transition-all flex items-center gap-2"
          >
            {isDeletingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete Entire Snapshot
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center text-stone-600">
              <Package className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Total Items</span>
          </div>
          <p className="text-2xl font-black text-stone-900">{stats.totalItems}</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center text-stone-600">
              <DollarSign className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Avg. Price ({stats.currency})</span>
          </div>
          <p className="text-2xl font-black text-stone-900">
            {stats.avgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center text-stone-600">
              <Tag className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Status</span>
          </div>
          <p className="text-2xl font-black text-emerald-600 capitalize">{snapshot?.status}</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
        <input 
          type="text" 
          placeholder="Search by product name, original name, SKU, or currency..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-stone-900/5 outline-none transition-all"
        />
      </div>

      {/* Items Table */}
      <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">Product (Canonical)</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">Original Name</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">Price (Orig)</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500">Price ($)</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-wider text-stone-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-stone-400 font-medium">
                    {searchQuery ? `No items matching "${searchQuery}"` : 'No items found in this snapshot.'}
                  </td>
                </tr>
              ) : (
                filteredItems.map(review => {
                  const product = products.find(p => p.id === (review.finalProductId || review.suggestedProductId));
                  const item = items.find(i => i.reviewItemId === review.id);
                  const isEditing = editingItem?.id === item?.id;
                  const statusInfo = getStatusInfo(review);

                  return (
                    <tr key={review.id} className="hover:bg-stone-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider",
                          statusInfo.color
                        )}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-stone-900">
                            {product ? highlightSearchText(product.canonicalName, searchQuery) : <span className="text-stone-400 italic">No Match</span>}
                          </span>
                          {product && (
                            <span className="text-[10px] text-stone-400 font-medium">
                              {product.brand} {product.internalReference ? <>• {highlightSearchText(product.internalReference, searchQuery)}</> : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-stone-600 italic">
                          {highlightSearchText(review.rawName, searchQuery)}
                        </span>
                        {review.rawCode && (
                          <div className="text-[10px] text-stone-400 font-mono mt-0.5">{review.rawCode}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {isEditing && item ? (
                          <div className="flex items-center gap-2">
                            <input 
                              type="number" 
                              step="0.01"
                              value={editValues?.price || 0}
                              onChange={(e) => setEditValues(prev => prev ? { ...prev, price: parseFloat(e.target.value) } : null)}
                              className="w-20 px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-stone-900/5 outline-none"
                              autoFocus
                            />
                            <input 
                              type="text" 
                              value={editValues?.currency || ''}
                              onChange={(e) => setEditValues(prev => prev ? { ...prev, currency: e.target.value } : null)}
                              className="w-16 px-2 py-1 border rounded text-sm uppercase focus:ring-2 focus:ring-stone-900/5 outline-none"
                            />
                          </div>
                        ) : (
                          <span className="font-medium text-stone-600">
                            {item ? (
                              <>{(item.price || 0).toLocaleString()} {highlightSearchText(item.currency, searchQuery)}</>
                            ) : (
                              <>{(review.rawPrice || 0).toLocaleString()} {highlightSearchText(review.rawCurrency, searchQuery)}</>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {isEditing && item ? (
                          <input 
                            type="number" 
                            step="0.01"
                            value={editValues?.usdPrice || 0}
                            onChange={(e) => setEditValues(prev => prev ? { ...prev, usdPrice: parseFloat(e.target.value) } : null)}
                            className="w-24 px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-stone-900/5 outline-none"
                          />
                        ) : (
                          <span className="font-bold text-stone-900">
                            {(() => {
                              const p = item ? item.price : review.rawPrice;
                              const c = item ? item.currency : review.rawCurrency;
                              const stored = item ? item.priceInDefaultCurrency : 0;
                              
                              // 1. If USD, it's always the price
                              if (c?.trim().toUpperCase() === 'USD') return p.toFixed(2);
                              
                              // 2. If we have a stored value that is NOT the raw price, use it (respects manual edits)
                              // We use a small epsilon for float comparison
                              if (stored !== 0 && Math.abs(stored - p) > 0.001) return stored.toFixed(2);
                              
                              // 3. Otherwise, calculate it using unified logic
                              const calculated = convertPrice(p, c, exchangeRates);
                              if (calculated === null) return <span className="text-stone-400 font-normal italic">Missing Rate</span>;
                              return calculated.toFixed(2);
                            })()}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isEditing && item ? (
                            <>
                              <button 
                                onClick={handleUpdateItem}
                                disabled={isUpdatingItem}
                                className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {isUpdatingItem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              </button>
                              <button 
                                type="button"
                                onClick={() => {
                                  setEditingItem(null);
                                  setEditValues(null);
                                }}
                                disabled={isUpdatingItem}
                                className="p-2 text-stone-400 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={() => setCreatingProductReview(review)}
                                className="p-2 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                title="Create Product"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setCorrectingReview(review)}
                                className="p-2 text-stone-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                title="Correct Match"
                              >
                                <History className="w-4 h-4" />
                              </button>
                              {item && (
                                <>
                                  <button 
                                    onClick={() => {
                                      setEditingItem(item);
                                      setEditValues({
                                        price: item.price,
                                        currency: item.currency,
                                        usdPrice: item.priceInDefaultCurrency
                                      });
                                    }}
                                    className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                    title="Edit Price"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => setDeletingItemId(item.id)}
                                    className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                    title="Delete Price Entry"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          )}
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

      {/* Snapshot Delete Confirmation */}
      <AnimatePresence>
        {isConfirmingDeleteSnapshot && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">Delete Entire Snapshot?</h3>
              <p className="text-sm text-stone-500 mb-8">
                This will permanently remove the snapshot header, all price entries, and all match reviews. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsConfirmingDeleteSnapshot(false)} 
                  disabled={isDeletingSnapshot}
                  className="flex-1 px-4 py-3 border border-stone-200 rounded-2xl font-bold hover:bg-stone-50 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    await handleDeleteSnapshot();
                    setIsConfirmingDeleteSnapshot(false);
                  }} 
                  disabled={isDeletingSnapshot}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isDeletingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete All'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
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
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Current Match</p>
                  {(() => {
                    const currentProduct = products.find(p => p.id === (correctingReview.finalProductId || correctingReview.suggestedProductId));
                    return currentProduct ? (
                      <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <div>
                          <p className="text-sm font-bold text-emerald-900">{currentProduct.canonicalName}</p>
                          <p className="text-[10px] text-emerald-600 uppercase tracking-widest">{currentProduct.brand} • {currentProduct.category}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-stone-400 text-sm italic">
                        No product matched
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Select New Product</p>
                  <ProductPicker 
                    products={products}
                    onSelect={(productId) => handleCorrectMatch(productId)}
                    placeholder="Search for a different product..."
                  />
                </div>

                <div className="pt-4 border-t border-stone-100 flex gap-3">
                  <button 
                    onClick={() => handleCorrectMatch(null)}
                    disabled={isCorrecting}
                    className="flex-1 px-4 py-3 bg-red-50 text-red-600 border border-red-100 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                  >
                    {isCorrecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Remove Match
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
      <AnimatePresence>
        {deletingItemId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">Delete Item?</h3>
              <p className="text-sm text-stone-500 mb-8">Are you sure you want to remove this item from the snapshot?</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setDeletingItemId(null)} 
                  className="flex-1 px-4 py-3 border border-stone-200 rounded-2xl font-bold hover:bg-stone-50 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDeleteItem} 
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {creatingProductReview && (
          <CreateProductModal 
            review={creatingProductReview}
            onClose={() => setCreatingProductReview(null)}
            onSuccess={() => {
              setCreatingProductReview(null);
              // Local state will be updated by the next fetch or onSnapshot if we had one
              // For now, let's just trigger a re-fetch or manual update
              window.location.reload(); 
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default SnapshotDetails;
