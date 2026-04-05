import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, addDoc, serverTimestamp, getDocs, orderBy } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../AuthContext';
import { Quotation, QuotationItem, Product, MatchReview, CanonicalProduct, ExchangeRate, PriceEntry, Supplier } from '../types';
import { COLLECTIONS } from '../services/firestoreCollections';
import { loadMatchReviewsByUpload } from '../services/matchReviewReadService';
import { approveMatch, rejectMatch, manualMatch, undoMatch, finalizeReview, createNewProduct, ignoreMatch } from '../services/reviewDecisionService';
import { markUploadNeedsReview } from '../services/uploadSessionService';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  AlertCircle,
  ChevronRight, 
  Search,
  ArrowLeft,
  Info,
  Loader2,
  Settings2,
  PlusCircle,
  FileText,
  Tag,
  Layers,
  Hash,
  Box,
  Palette,
  GitBranch
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import ProductPicker from '../components/ProductPicker';
import { matchesSearch, highlightSearchText } from '../lib/search';

/**
 * Compatibility interface to allow unified rendering of legacy QuotationItems
 * and new MatchReview records in the Review UI.
 */
interface ReviewItemCompatibility {
  id: string;
  rawName: string;
  rawCode?: string | null;
  price: number;
  currency: string;
  suggestedProductId?: string;
  suggestedProductName?: string;
  confidence: number;
  matchReason: string;
  reasons: string[];
  warnings: string[];
  dangerFlags: string[];
  alternativeCandidates: any[];
  status: 'pending' | 'approved' | 'rejected' | 'manual';
  _isNewSystem: boolean;
  isAliasMatch?: boolean;
}

const Review: React.FC = () => {
  const { quotationId } = useParams<{ quotationId: string }>();
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  
  const [quotation, setQuotation] = useState<any>(null);
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [matchReviews, setMatchReviews] = useState<MatchReview[]>([]);
  const [products, setProducts] = useState<CanonicalProduct[]>([]);
  const [priceEntries, setPriceEntries] = useState<PriceEntry[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const exchangeRates = useMemo(() => {
    const mapping: Record<string, number> = {};
    rates.forEach(r => {
      // Internal model: 1 USD = X units of foreign currency
      // So fromCurrency is USD, toCurrency is the foreign currency
      if (r && r.fromCurrency?.toUpperCase() === 'USD' && r.toCurrency) {
        mapping[r.toCurrency.toUpperCase()] = r.rate;
      }
      // Support reverse mapping if it exists
      else if (r && r.toCurrency?.toUpperCase() === 'USD' && r.fromCurrency) {
        mapping[r.fromCurrency.toUpperCase()] = 1 / r.rate;
      }
    });
    return mapping;
  }, [rates]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("processing");
  const [searchQuery, setSearchQuery] = useState('');
  const [stagedMatches, setStagedMatches] = useState<Record<string, string>>({});
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [excludedItems, setExcludedItems] = useState<Set<string>>(new Set());
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [itemToCreate, setItemToCreate] = useState<ReviewItemCompatibility | null>(null);
  const [newProductData, setNewProductData] = useState({
    canonicalName: '',
    brand: '',
    category: '',
    costPrice: 0,
    internalReference: '',
    capacity: '',
    color: '',
    version: ''
  });

  const fetchNewReviews = async () => {
    if (!profile?.uid || !quotationId) return;
    console.log(`[Review] Fetching all reviews for uploadId: ${quotationId}`);
    try {
      const reviews = await loadMatchReviewsByUpload(profile.uid, quotationId);
      console.log(`[Review] Fetched ${reviews.length} match reviews`);
      setMatchReviews(reviews);
      setLoading(false);
    } catch (err) {
      console.error("[Review] Failed to load match reviews:", err);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!quotationId || !profile?.uid) return;

    console.log(`[Review] Initializing for quotationId/uploadId: ${quotationId}`);

    const fetchQuotation = async () => {
      try {
        // Try new system first
        const uploadSnap = await getDoc(doc(db, COLLECTIONS.SUPPLIER_UPLOADS, quotationId));
        if (uploadSnap.exists()) {
          console.log("[Review] Found supplier upload session");
          setQuotation({ id: uploadSnap.id, ...uploadSnap.data() });
          setUploadStatus(uploadSnap.data().status);
        } else {
          // Fallback to legacy
          const snap = await getDoc(doc(db, 'quotations', quotationId));
          if (snap.exists()) {
            console.log("[Review] Found legacy quotation");
            setQuotation({ id: snap.id, ...snap.data() } as Quotation);
            setUploadStatus("completed"); // Legacy is always "completed" for UI
          }
        }
        setError(null);
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, 'quotations');
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to load quotation details."));
        }
      }
    };

    const fetchProducts = async () => {
      try {
        console.log("[Review] Fetching canonical products...");
        const q = query(collection(db, COLLECTIONS.CANONICAL_PRODUCTS), where('ownerUserId', '==', profile.uid));
        const snap = await getDocs(q);
        console.log(`[Review] Loaded ${snap.docs.length} products`);
        setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as CanonicalProduct)));
        setError(null);
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, COLLECTIONS.CANONICAL_PRODUCTS);
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to load products."));
        }
      }
    };

    const fetchExchangeRates = async () => {
      try {
        const q = query(
          collection(db, COLLECTIONS.EXCHANGE_RATES),
          where('ownerUserId', '==', profile.uid)
        );
        const snap = await getDocs(q);
        const ratesData = snap.docs.map(d => ({ id: d.id, ...d.data() } as ExchangeRate));
        setRates(ratesData);
      } catch (err) {
        console.error("Failed to load exchange rates:", err);
      }
    };

    // Real-time listener for match_reviews (New System)
    const unsubscribeMatchReviews = onSnapshot(
      query(
        collection(db, COLLECTIONS.MATCH_REVIEWS),
        where('ownerUserId', '==', auth.currentUser?.uid || profile.uid),
        where('uploadId', '==', quotationId)
      ),
      (snapshot) => {
        const reviews = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MatchReview));
        console.log(`[Review] Real-time match_reviews update: ${reviews.length} items`);
        setMatchReviews(reviews);
        if (reviews.length > 0 || uploadStatus === 'ready_for_review' || uploadStatus === 'completed') {
          setLoading(false);
        }
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, COLLECTIONS.MATCH_REVIEWS);
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to sync match reviews."));
        }
        setLoading(false);
      }
    );

    console.log('[Review] Querying quotation_items for:', {
      profileUid: profile.uid,
      authUid: auth.currentUser?.uid,
      quotationId
    });

    const unsubscribeItems = onSnapshot(
      query(
        collection(db, 'quotation_items'), 
        where('ownerUserId', '==', auth.currentUser?.uid || profile.uid),
        where('quotationId', '==', quotationId)
      ),
      (snapshot) => {
        const legacyItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as QuotationItem));
        console.log(`[Review] Real-time quotation_items update: ${legacyItems.length} items`);
        setItems(legacyItems);
        if (legacyItems.length > 0) {
          setLoading(false);
        }
        setError(null);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, 'quotation_items');
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to sync items."));
        }
        setLoading(false);
      }
    );

    fetchQuotation();
    fetchProducts();
    fetchExchangeRates();

    // Fetch price entries for context
    const fetchPrices = async () => {
      try {
        const q = query(collection(db, COLLECTIONS.PRICE_ENTRIES), where('ownerUserId', '==', profile.uid));
        const snap = await getDocs(q);
        setPriceEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as PriceEntry)));
      } catch (err) {
        console.error("Failed to load prices:", err);
      }
    };

    // Fetch suppliers for context
    const fetchSuppliers = async () => {
      try {
        const q = query(collection(db, COLLECTIONS.SUPPLIERS), where('ownerUserId', '==', profile.uid));
        const snap = await getDocs(q);
        setSuppliers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier)));
      } catch (err) {
        console.error("Failed to load suppliers:", err);
      }
    };

    fetchPrices();
    fetchSuppliers();

    // Polling for upload status
    const interval = setInterval(async () => {
      try {
        const docRef = doc(db, COLLECTIONS.SUPPLIER_UPLOADS, quotationId);
        const snap = await getDoc(docRef);

        if (!snap.exists()) {
          console.warn(`[Review] Upload session ${quotationId} not found`);
          return;
        }

        const data = snap.data();
        console.log(`[Review] Polling status: ${data.status}`);
        setUploadStatus(data.status);
        
        if (data.error) {
          console.error(`[Review] Upload failed with error: ${data.error}`);
          setError(`Upload failed: ${data.error}`);
        }

        if (["ready_for_review", "completed", "finalized", "failed"].includes(data.status)) {
          clearInterval(interval);
          if (data.status === "ready_for_review" || data.status === "completed") {
            fetchNewReviews();
          }
        }
      } catch (err) {
        console.error("[Review] Polling error:", err);
        clearInterval(interval);
      }
    }, 3000);

    return () => {
      unsubscribeMatchReviews();
      unsubscribeItems();
      clearInterval(interval);
    };
  }, [quotationId, profile?.uid]);

  const handleApprove = async (item: ReviewItemCompatibility | QuotationItem) => {
    // If there's a staged match, confirm it instead of approving the original suggestion
    if (stagedMatches[item.id]) {
      await handleConfirmManualMatch(item as ReviewItemCompatibility);
      return;
    }

    if ('_isNewSystem' in item && item._isNewSystem) {
      if (!profile?.uid || !item.suggestedProductId || !quotationId) return;
      setSaving(true);
      try {
        await approveMatch({
          reviewId: item.id,
          ownerUserId: quotation?.ownerUserId || profile?.uid || '',
          uploadId: quotationId,
          supplierId: quotation?.supplierId || '',
          productId: item.suggestedProductId,
          rawName: item.rawName,
          rawPrice: item.price,
          rawCurrency: item.currency,
          reviewedBy: profile?.uid || user?.uid || '',
          confidence: item.confidence || 0,
          rates: rates
        });
      } catch (e) {
        try {
          handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
        } catch (err) {
          setError(getFirestoreErrorMessage(err, "Approval failed."));
        }
      } finally {
        setSaving(false);
      }
      return;
    }
    const legacyItem = item as QuotationItem;
    if (!legacyItem.suggestedProductId) return;
    
    setSaving(true);
    try {
      // 1. Update item status
      await updateDoc(doc(db, 'quotation_items', item.id), {
        status: 'approved'
      });

      // 2. Create Alias (Learning)
      const aliasQuery = query(
        collection(db, 'product_aliases'),
        where('ownerUserId', '==', auth.currentUser?.uid || profile?.uid || ''),
        where('rawName', '==', item.rawName)
      );
      const aliasSnap = await getDocs(aliasQuery);
      
      if (aliasSnap.empty) {
        await addDoc(collection(db, 'product_aliases'), {
          ownerUserId: auth.currentUser?.uid || profile?.uid || '',
          productId: item.suggestedProductId,
          rawName: item.rawName,
          supplierId: quotation?.supplierId,
          createdAt: serverTimestamp(),
        });
      }

      // 3. Log Audit
      await addDoc(collection(db, 'audit_logs'), {
        ownerUserId: auth.currentUser?.uid || profile?.uid || '',
        userId: auth.currentUser?.uid || profile?.uid || '',
        action: 'APPROVE_MATCH',
        details: { itemId: item.id, productId: item.suggestedProductId },
        timestamp: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (item: ReviewItemCompatibility | QuotationItem) => {
    if (!profile?.uid) return;
    
    // Optimistic UI update
    if ('_isNewSystem' in item && item._isNewSystem) {
      setMatchReviews(prev => prev.map(r => r.id === item.id ? { ...r, reviewStatus: 'ignored' } as MatchReview : r));
    } else {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'ignored' } as QuotationItem : i));
    }
    
    try {
      if ('_isNewSystem' in item && item._isNewSystem) {
        // New system
        await ignoreMatch({
          reviewId: item.id,
          ownerUserId: profile.uid,
          uploadId: quotationId!,
          reviewedBy: profile.uid,
          supplierId: quotation?.supplierId
        });
      } else {
        // Legacy system
        const reviewRef = doc(db, COLLECTIONS.QUOTATION_ITEMS, item.id);
        await updateDoc(reviewRef, { 
          status: 'ignored',
          reviewedAt: serverTimestamp(),
          reviewedBy: profile.uid
        });
      }
    } catch (error) {
      console.error("Error ignoring item:", error);
      // Rollback (onSnapshot will handle this eventually, but for immediate feedback:)
      if ('_isNewSystem' in item && item._isNewSystem) {
        setMatchReviews(prev => prev.map(r => r.id === item.id ? { ...r, reviewStatus: (item as any).reviewStatus } as MatchReview : r));
      } else {
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: (item as any).status } as QuotationItem : i));
      }
    }
  };

  const getLatestPrice = (productId: string) => {
    const entries = priceEntries.filter(e => e.canonicalProductId === productId);
    if (entries.length === 0) return null;
    return [...entries].sort((a, b) => {
      const dateA = (a.effectiveDate as any)?.seconds || (a.date as any)?.seconds || 0;
      const dateB = (b.effectiveDate as any)?.seconds || (b.date as any)?.seconds || 0;
      return dateB - dateA;
    })[0];
  };

  const handleCreateNewProductSubmit = async () => {
    if (!profile?.uid || !quotationId || !itemToCreate) return;
    setSaving(true);
    try {
      await createNewProduct({
        reviewId: itemToCreate.id,
        ownerUserId: quotation?.ownerUserId || profile?.uid || '',
        uploadId: quotationId,
        supplierId: quotation?.supplierId || '',
        reviewedBy: profile?.uid || user?.uid || '',
        productData: newProductData,
        rawPrice: itemToCreate.price,
        rawCurrency: itemToCreate.currency,
        rates: rates
      });
      setIsCreateModalOpen(false);
      setItemToCreate(null);
      // Refresh products to include the new one
      const q = query(collection(db, COLLECTIONS.CANONICAL_PRODUCTS), where('ownerUserId', '==', profile.uid));
      const snap = await getDocs(q);
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as CanonicalProduct)));
      // Refresh reviews
      fetchNewReviews();
    } catch (e) {
      try {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.CANONICAL_PRODUCTS);
      } catch (err) {
        setError(getFirestoreErrorMessage(err, "Create product failed."));
      }
    } finally {
      setSaving(false);
    }
  };

  const openCreateModal = (item: ReviewItemCompatibility) => {
    setItemToCreate(item);
    const convertedPrice = item.currency === 'USD' 
      ? item.price 
      : (exchangeRates[item.currency] ? item.price / exchangeRates[item.currency] : item.price);

    setNewProductData({
      canonicalName: item.rawName,
      brand: '',
      category: '',
      costPrice: Number(convertedPrice.toFixed(2)),
      internalReference: '',
      capacity: '',
      color: '',
      version: ''
    });
    setIsCreateModalOpen(true);
  };

  const handleManualMatch = (item: ReviewItemCompatibility, productId: string) => {
    setStagedMatches(prev => ({ ...prev, [item.id]: productId }));
  };

  const handleConfirmManualMatch = async (item: ReviewItemCompatibility) => {
    const productId = stagedMatches[item.id];
    if (!productId || !profile?.uid || !quotationId) return;
    
    setSaving(true);
    try {
      await manualMatch({
        reviewId: item.id,
        ownerUserId: quotation?.ownerUserId || profile?.uid || '',
        uploadId: quotationId,
        supplierId: quotation?.supplierId || '',
        chosenProductId: productId,
        rawName: item.rawName,
        rawPrice: item.price,
        rawCurrency: item.currency,
        reviewedBy: profile?.uid || user?.uid || '',
        originalSuggestedProductId: item.suggestedProductId,
        isAliasCorrection: !!item.isAliasMatch,
        rates: rates
      });
      // Clear staged match after successful save
      setStagedMatches(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (e) {
      try {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
      } catch (err) {
        setError(getFirestoreErrorMessage(err, "Manual match failed."));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClearStagedMatch = (itemId: string) => {
    setStagedMatches(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const handleUndo = async (item: ReviewItemCompatibility) => {
    if (!profile?.uid || !quotationId) return;
    setSaving(true);
    try {
      await undoMatch(item.id, profile?.uid || user?.uid || '', quotationId, quotation?.supplierId || '');
      // Also remove from selected if it was there
      setSelectedItems(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } catch (e) {
      try {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.MATCH_REVIEWS);
      } catch (err) {
        setError(getFirestoreErrorMessage(err, "Undo failed."));
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleSelectItem = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExcludeItem = (id: string) => {
    setExcludedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // If excluded, remove from selected
    setSelectedItems(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleFinalize = async () => {
    if (!quotationId || !profile?.uid || saving) return;
    setSaving(true);
    
    // If items are selected, only finalize those. Otherwise finalize everything approved/ignored.
    const itemIdsToFinalize = selectedItems.size > 0 ? Array.from(selectedItems) : undefined;
    
    try {
      await finalizeReview(
        quotation?.ownerUserId || profile?.uid || '', 
        quotationId, 
        profile?.uid || user?.uid || '',
        quotation?.supplierId,
        quotation?.completedAt,
        itemIdsToFinalize
      );
      
      // Success message as requested
      if (itemIdsToFinalize) {
        alert(`${itemIdsToFinalize.length} selected items added to compare successfully.`);
        // Clear selection after partial finalization
        setSelectedItems(new Set());
      } else {
        alert('Quotation process completed successfully. Snapshot published and historical records updated.');
        navigate('/app/upload');
      }
    } catch (e) {
      try {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.SUPPLIER_UPLOADS);
      } catch (err) {
        setError(getFirestoreErrorMessage(err, "Failed to finalize price list."));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNeedsReview = async () => {
    if (!quotationId || !profile?.uid || saving) return;
    setSaving(true);
    try {
      await markUploadNeedsReview(quotationId);
      navigate('/app/upload');
    } catch (e) {
      try {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.SUPPLIER_UPLOADS);
      } catch (err) {
        setError(getFirestoreErrorMessage(err, "Failed to save snapshot."));
      }
    } finally {
      setSaving(false);
    }
  };

  const getProduct = (id?: string) => products.find(p => p.id === id);

  // Merge legacy items and new match reviews for unified rendering
  const normalizedMatchReviews: ReviewItemCompatibility[] = matchReviews.map(mr => ({
    id: mr.id,
    rawName: mr.rawName || '',
    rawCode: mr.rawCode || '',
    price: mr.rawPrice || 0,
    currency: mr.rawCurrency || 'USD',
    suggestedProductId: mr.suggestedProductId,
    suggestedProductName: mr.suggestedProductName || '',
    confidence: mr.confidenceScore,
    matchReason: (mr.reasons || []).join(', '),
    reasons: mr.reasons || [],
    warnings: mr.warnings || [],
    dangerFlags: mr.dangerFlags || [],
    alternativeCandidates: mr.alternativeCandidates || [],
    status: mr.reviewStatus === 'pending' ? 'pending' : 
            (mr.reviewStatus === 'rejected' ? 'rejected' : 
            (mr.finalAction === 'manual' ? 'manual' : 'approved')),
    _isNewSystem: true,
    isAliasMatch: (mr.reasons || []).some(r => r?.toLowerCase().includes('alias'))
  }));

  const legacyItems: ReviewItemCompatibility[] = items.map(i => ({
    id: i.id,
    rawName: i.rawName || '',
    rawCode: i.rawCode || '',
    price: i.price || 0,
    currency: i.currency || 'USD',
    suggestedProductId: i.suggestedProductId,
    confidence: i.confidence || 0,
    matchReason: i.matchReason || '',
    reasons: i.matchReason ? [i.matchReason] : [],
    warnings: i.warnings || [],
    dangerFlags: [],
    alternativeCandidates: [],
    status: i.status as 'pending' | 'approved' | 'rejected',
    _isNewSystem: false
  }));

  const allItems = [...legacyItems, ...normalizedMatchReviews];
  
  const visibleItems = useMemo(() => {
    return allItems.filter(item => !excludedItems.has(item.id));
  }, [allItems, excludedItems]);

  const filteredAllItems = useMemo(() => {
    if (!searchQuery.trim()) return visibleItems;
    return visibleItems.filter(i => 
      matchesSearch(i.rawName, searchQuery) ||
      matchesSearch(i.rawCode || '', searchQuery) ||
      matchesSearch(i.suggestedProductName || '', searchQuery)
    );
  }, [visibleItems, searchQuery]);

  const totalItemsCount = allItems.length;
  const pendingItems = filteredAllItems.filter(i => i.status === 'pending');
  const processedItems = filteredAllItems.filter(i => i.status !== 'pending');

  const getPriorityScore = (item: ReviewItemCompatibility) => {
    if (item.dangerFlags && item.dangerFlags.length > 0) return 3;
    if (!item.suggestedProductId) return 2;
    if (item.confidence < 0.6) return 1;
    return 0;
  };

  const sortedPendingItems = [...pendingItems].sort((a, b) => {
    const scoreA = getPriorityScore(a);
    const scoreB = getPriorityScore(b);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (a.rawName || '').localeCompare(b.rawName || '');
  });

  const sortedProcessedItems = [...processedItems].sort((a, b) => {
    // Sort by most recently reviewed first if available
    return 0; // For now stable sort
  });

  const totalPending = useMemo(() => allItems.filter(i => i.status === 'pending').length, [allItems]);
  const dangerCount = pendingItems.filter(i => i.dangerFlags && i.dangerFlags.length > 0).length;
  const noMatchCount = pendingItems.filter(i => !i.suggestedProductId).length;
  const lowConfidenceCount = pendingItems.filter(i => i.confidence < 0.6).length;

  if (uploadStatus === "processing" && items.length === 0 && matchReviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-12 h-12 text-stone-900 animate-spin" />
        <div className="text-center">
          <h3 className="text-xl font-bold">Matching products...</h3>
          <p className="text-stone-500">Our AI is finding the best matches in your catalog.</p>
        </div>
      </div>
    );
  }

  if (uploadStatus === "failed") {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4 text-red-600">
        <XCircle className="w-12 h-12" />
        <div className="text-center">
          <h3 className="text-xl font-bold">Upload failed</h3>
          <p className="text-red-500/80">
            {error || "There was an error processing your quotation. Please try again."}
          </p>
          <button 
            onClick={() => navigate('/app/upload')}
            className="mt-6 px-6 py-2 bg-stone-900 text-white rounded-xl font-bold hover:bg-stone-800"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="py-20 text-center">Loading review data...</div>;

  return (
    <div className="space-y-8 pb-20">
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-stone-100 rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold">Review Quotation</h2>
            <p className="text-stone-500">Verify AI matches for {totalItemsCount} extracted items.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="px-4 py-2 bg-stone-100 rounded-xl text-sm font-medium">
            {processedItems.length} / {totalItemsCount} Processed
          </div>
          <button 
            onClick={() => totalPending > 0 ? handleSaveNeedsReview() : handleFinalize()}
            disabled={saving || !quotation}
            className={cn(
              "px-6 py-2 rounded-xl font-bold transition-all disabled:opacity-50",
              totalPending > 0 
                ? "bg-amber-500 text-white hover:bg-amber-600" 
                : "bg-stone-900 text-white hover:bg-stone-800"
            )}
          >
            {saving ? 'Saving...' : (
              totalPending > 0 
                ? 'Save for Later' 
                : (selectedItems.size > 0 ? `Add ${selectedItems.size} selected only to compare` : 'Add To Compare')
            )}
          </button>
        </div>
      </header>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          placeholder="Search items by name or code..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all"
        />
      </div>

      {pendingItems.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="px-4 py-3 bg-white border border-stone-200 rounded-2xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Total Pending</p>
            <p className="text-xl font-bold">{totalPending}</p>
          </div>
          <div className="px-4 py-3 bg-white border border-stone-200 rounded-2xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1">High Risk</p>
            <p className="text-xl font-bold text-red-600">{dangerCount}</p>
          </div>
          <div className="px-4 py-3 bg-white border border-stone-200 rounded-2xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-1">No Match</p>
            <p className="text-xl font-bold text-amber-600">{noMatchCount}</p>
          </div>
          <div className="px-4 py-3 bg-white border border-stone-200 rounded-2xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Low Confidence</p>
            <p className="text-xl font-bold">{lowConfidenceCount}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {sortedPendingItems.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-stone-400 uppercase tracking-widest px-2">Pending Review</h3>
            <AnimatePresence mode="popLayout">
              {sortedPendingItems.map((item) => {
                const stagedProductId = stagedMatches[item.id];
                const effectiveProductId = stagedProductId || item.suggestedProductId;
                const suggestedProduct = getProduct(effectiveProductId);
                const isStaged = !!stagedProductId;
                
                const confidenceColor = isStaged ? "text-amber-600" :
                  item.confidence! > 0.8 ? "text-emerald-600" : 
                  item.confidence! > 0.5 ? "text-amber-600" : "text-red-600";

                return (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="bg-white rounded-3xl border border-stone-200 shadow-sm"
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-2">
                      {/* Supplier Side */}
                      <div className="p-8 border-r border-stone-100 bg-stone-50/50 relative">
                        <div className="absolute top-4 left-4">
                          <input 
                            type="checkbox" 
                            checked={selectedItems.has(item.id)}
                            onChange={() => toggleSelectItem(item.id)}
                            className="w-5 h-5 rounded border-stone-300 text-stone-900 focus:ring-stone-900 cursor-pointer"
                          />
                        </div>
                        <div className="flex items-center justify-between mb-4 ml-8">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Supplier Item</span>
                          <div className="text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <p className="text-lg font-bold">{formatCurrency(item.price, item.currency)}</p>
                              {item.currency !== 'USD' && (
                                <span className="text-[10px] font-medium text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                                  {exchangeRates[item.currency] 
                                    ? `≈ $${(item.price / exchangeRates[item.currency]).toFixed(2)}`
                                    : 'Missing Rate'}
                                </span>
                              )}
                            </div>
                            {item.currency !== 'USD' && exchangeRates[item.currency] && (
                              <p className="text-[10px] font-mono text-stone-400" title={`Calculated as: ${item.price} / ${exchangeRates[item.currency].toFixed(4)}`}>
                                (at 1 USD = {exchangeRates[item.currency].toFixed(2)} {item.currency})
                              </p>
                            )}
                          </div>
                        </div>
                        <h4 className="text-xl font-bold text-stone-900 leading-tight">
                          {highlightSearchText(item.rawName, searchQuery)}
                        </h4>
                        
                        {(effectiveProductId || item.status === 'approved' || item.status === 'manual') && (
                          <div className="mt-4 p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-0.5">Matched To</p>
                              <p className="text-sm font-bold text-emerald-900 leading-tight">
                                {suggestedProduct?.canonicalName || item.suggestedProductName || 'Unknown Product'}
                              </p>
                              {suggestedProduct && (
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 text-[10px] text-emerald-700 font-medium">
                                  <span>{suggestedProduct.brand || 'No Brand'}</span>
                                  <span className="text-emerald-300">・</span>
                                  <span>
                                    {suggestedProduct.costPrice ? (
                                      formatCurrency(suggestedProduct.costPrice)
                                    ) : (
                                      getLatestPrice(suggestedProduct.id) ? (
                                        formatCurrency(getLatestPrice(suggestedProduct.id)!.price, getLatestPrice(suggestedProduct.id)!.currency)
                                      ) : 'No Price'
                                    )}
                                  </span>
                                  {suggestedProduct.color && (
                                    <>
                                      <span className="text-emerald-300">・</span>
                                      <span className="px-1 bg-emerald-100/50 rounded text-[9px] font-bold uppercase">
                                        {suggestedProduct.color}
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {item.rawCode && (
                          <p className="text-sm font-mono text-stone-500 mt-2">
                            Code: {highlightSearchText(item.rawCode, searchQuery)}
                          </p>
                        )}
                      </div>

                      {/* Match Side */}
                      <div className="p-8 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Suggested Match</span>
                            <div className="flex flex-col items-end">
                              <div className={cn("flex items-center gap-1 text-xs font-bold", confidenceColor)}>
                                {isStaged ? (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Manual Match
                                  </span>
                                ) : (
                                  `${Math.round(item.confidence! * 100)}% Confidence`
                                )}
                              </div>
                              {suggestedProduct && getLatestPrice(suggestedProduct.id) && (
                                <span className="text-[10px] font-medium text-stone-500">
                                  Last: {formatCurrency(getLatestPrice(suggestedProduct.id)!.price, getLatestPrice(suggestedProduct.id)!.currency)}
                                </span>
                              )}
                            </div>
                          </div>

                          {effectiveProductId ? (
                            <div className="space-y-3">
                              <div className={cn(
                                "flex items-center gap-3 p-4 rounded-2xl border transition-all",
                                isStaged ? "bg-amber-50 border-amber-100" : "bg-white border-stone-100"
                              )}>
                                <div className={cn(
                                  "w-10 h-10 rounded-xl flex items-center justify-center shadow-sm",
                                  isStaged ? "bg-amber-500" : "bg-stone-900"
                                )}>
                                  <CheckCircle2 className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                  <p className="font-bold text-lg leading-tight">
                                    {suggestedProduct?.canonicalName || item.suggestedProductName || 'Unknown Product'}
                                  </p>
                                  <div className={cn("text-xs mt-1", isStaged ? "text-amber-700" : "text-stone-500")}>
                                    {isStaged ? (
                                      <p className="font-bold">Manual Match (Ready to Confirm)</p>
                                    ) : (
                                      suggestedProduct ? (
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                          <span className="font-semibold">{suggestedProduct.brand || 'No Brand'}</span>
                                          <span className="text-stone-300">・</span>
                                          <span className="font-bold text-emerald-600">
                                            {suggestedProduct.costPrice ? (
                                              formatCurrency(suggestedProduct.costPrice)
                                            ) : (
                                              getLatestPrice(suggestedProduct.id) ? (
                                                <>
                                                  {formatCurrency(getLatestPrice(suggestedProduct.id)!.price, getLatestPrice(suggestedProduct.id)!.currency)}
                                                  {getLatestPrice(suggestedProduct.id)!.currency !== 'USD' && exchangeRates[getLatestPrice(suggestedProduct.id)!.currency] && (
                                                    <span className="ml-1 text-stone-400 font-normal">
                                                      (${ (getLatestPrice(suggestedProduct.id)!.price / exchangeRates[getLatestPrice(suggestedProduct.id)!.currency]).toFixed(2) })
                                                    </span>
                                                  )}
                                                </>
                                              ) : 'No Price'
                                            )}
                                          </span>
                                          {suggestedProduct.color && (
                                            <>
                                              <span className="text-stone-300">・</span>
                                              <span className="px-2 py-0.5 bg-stone-100 rounded-md text-[10px] font-bold text-stone-600 uppercase tracking-tight">
                                                {suggestedProduct.color}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      ) : <p>Suggested by AI</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {!isStaged && (
                                <div className="p-3 bg-stone-50 rounded-xl border border-stone-100">
                                  <div className="flex gap-2 items-start">
                                    <Info className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                                    <p className="text-xs text-stone-600 italic">"{item.matchReason}"</p>
                                  </div>
                                </div>
                              )}

                              {isStaged && (
                                <div className="flex gap-4 px-2">
                                  <button 
                                    onClick={() => handleClearStagedMatch(item.id)}
                                    className="text-xs font-bold text-stone-400 hover:text-red-600 transition-colors flex items-center gap-1"
                                  >
                                    <XCircle className="w-3 h-3" />
                                    Clear Selection
                                  </button>
                                </div>
                              )}

                              {item._isNewSystem && (item.reasons.length > 0 || item.warnings.length > 0 || item.dangerFlags.length > 0) && (
                                <div className="p-3 bg-white border border-stone-100 rounded-xl space-y-2 shadow-sm">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Match Explanation</p>
                                  <div className="space-y-1">
                                    {item.reasons.map((r, i) => (
                                      <div key={`reason-${i}`} className="flex items-center gap-2 text-emerald-600 text-[11px] font-medium">
                                        <span>✔</span>
                                        {r}
                                      </div>
                                    ))}
                                    {item.isAliasMatch && (
                                      <div className="flex items-center gap-2 text-amber-600 text-[11px] font-bold mt-2 pt-2 border-t border-stone-50">
                                        <AlertTriangle className="w-3 h-3" />
                                        <span>Note: This is a learned match from previous approvals.</span>
                                      </div>
                                    )}
                                    {item.warnings.map((w, i) => (
                                      <div key={`warning-${i}`} className="flex items-center gap-2 text-amber-600 text-[11px] font-medium">
                                        <span>⚠</span>
                                        {w}
                                      </div>
                                    ))}
                                    {item.dangerFlags.map((d, i) => (
                                      <div key={`danger-${i}`} className="flex items-center gap-2 text-red-600 text-[11px] font-medium">
                                        <span>🚨</span>
                                        {d}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {item._isNewSystem && item.alternativeCandidates && item.alternativeCandidates.length > 0 && (
                                <div className="mt-4 space-y-2">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Alternative Matches</p>
                                  <div className="space-y-1">
                                    {item.alternativeCandidates
                                      .filter(c => !c.blocked)
                                      .slice(0, 3)
                                      .map((candidate) => {
                                        const candidateProduct = getProduct(candidate.productId);
                                        const candidatePrice = candidateProduct?.costPrice 
                                          ? { price: candidateProduct.costPrice, currency: 'USD', isCostPrice: true }
                                          : (candidateProduct ? getLatestPrice(candidateProduct.id) : null);
                                        
                                        return (
                                          <button
                                            key={candidate.productId}
                                            onClick={() => handleManualMatch(item, candidate.productId)}
                                            className="w-full text-left px-3 py-2 text-xs bg-stone-50 hover:bg-stone-100 border border-stone-100 rounded-xl transition-colors group"
                                          >
                                            <div className="flex justify-between items-start mb-0.5">
                                              <span className="text-stone-900 font-bold group-hover:text-stone-900 line-clamp-1">
                                                {candidate.name}
                                              </span>
                                              <span className="text-[9px] font-bold text-stone-400 ml-2 shrink-0">
                                                {Math.round(candidate.score * 100)}%
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[10px] text-stone-500">
                                              <span>{candidateProduct?.brand || 'No Brand'}</span>
                                              {candidatePrice && (
                                                <>
                                                  <span className="text-stone-300">・</span>
                                                  <span className="font-bold text-emerald-600">
                                                    {formatCurrency(candidatePrice.price, candidatePrice.currency)}
                                                    {candidatePrice && !('isCostPrice' in candidatePrice && candidatePrice.isCostPrice) && candidatePrice.currency !== 'USD' && exchangeRates[candidatePrice.currency] && (
                                                      <span className="ml-1 text-stone-400 font-normal">
                                                        (${ (candidatePrice.price / exchangeRates[candidatePrice.currency]).toFixed(2) })
                                                      </span>
                                                    )}
                                                  </span>
                                                </>
                                              )}
                                              {candidateProduct?.color && (
                                                <>
                                                  <span className="text-stone-300">・</span>
                                                  <span className="px-1 py-0.5 bg-stone-100 rounded text-[9px] font-bold text-stone-500 uppercase">
                                                    {candidateProduct.color}
                                                  </span>
                                                </>
                                              )}
                                            </div>
                                          </button>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}

                              <div className="mt-4 pt-4 border-t border-stone-100">
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">
                                  {isStaged ? 'Change Selection' : 'Change Match Manually'}
                                </label>
                                <ProductPicker 
                                  products={products}
                                  onSelect={(productId) => handleManualMatch(item, productId)}
                                  placeholder="Search catalog..."
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="py-6 px-4 text-center border-2 border-dashed border-stone-200 rounded-2xl">
                              <p className="text-sm text-stone-400 mb-4">No automatic match found</p>
                              
                              {item._isNewSystem && item.alternativeCandidates && item.alternativeCandidates.length > 0 && (
                                <div className="mb-6 space-y-2 text-left">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Alternative Matches</p>
                                  <div className="space-y-1">
                                    {item.alternativeCandidates
                                      .filter(c => !c.blocked)
                                      .slice(0, 3)
                                      .map((candidate) => {
                                        const candidateProduct = getProduct(candidate.productId);
                                        const candidatePrice = candidateProduct?.costPrice 
                                          ? { price: candidateProduct.costPrice, currency: 'USD', isCostPrice: true }
                                          : (candidateProduct ? getLatestPrice(candidateProduct.id) : null);
                                        
                                        return (
                                          <button
                                            key={candidate.productId}
                                            onClick={() => handleManualMatch(item, candidate.productId)}
                                            className="w-full text-left px-3 py-2 text-xs bg-stone-50 hover:bg-stone-100 border border-stone-100 rounded-xl transition-colors group"
                                          >
                                            <div className="flex justify-between items-start mb-0.5">
                                              <span className="text-stone-900 font-bold group-hover:text-stone-900 line-clamp-1">
                                                {candidate.name}
                                              </span>
                                              <span className="text-[9px] font-bold text-stone-400 ml-2 shrink-0">
                                                {Math.round(candidate.score * 100)}%
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[10px] text-stone-500">
                                              <span>{candidateProduct?.brand || 'No Brand'}</span>
                                              {candidatePrice && (
                                                <>
                                                  <span className="text-stone-300">・</span>
                                                  <span className="font-bold text-emerald-600">
                                                    {formatCurrency(candidatePrice.price, candidatePrice.currency)}
                                                    {candidatePrice && !('isCostPrice' in candidatePrice && candidatePrice.isCostPrice) && candidatePrice.currency !== 'USD' && exchangeRates[candidatePrice.currency] && (
                                                      <span className="ml-1 text-stone-400 font-normal">
                                                        (${ (candidatePrice.price / exchangeRates[candidatePrice.currency]).toFixed(2) })
                                                      </span>
                                                    )}
                                                  </span>
                                                </>
                                              )}
                                              {candidateProduct?.color && (
                                                <>
                                                  <span className="text-stone-300">・</span>
                                                  <span className="px-1 py-0.5 bg-stone-100 rounded text-[9px] font-bold text-stone-500 uppercase">
                                                    {candidateProduct.color}
                                                  </span>
                                                </>
                                              )}
                                            </div>
                                          </button>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}

                              <ProductPicker 
                                products={products}
                                onSelect={(productId) => handleManualMatch(item, productId)}
                                placeholder="Search catalog..."
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex gap-3 mt-8">
                          <button 
                            onClick={() => openCreateModal(item)}
                            disabled={saving || uploadStatus === 'finalized'}
                            className="flex-1 flex items-center justify-center gap-2 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-900 hover:text-white transition-all disabled:opacity-50"
                          >
                            <PlusCircle className="w-4 h-4" />
                            Create New
                          </button>
                          <button 
                            onClick={() => toggleExcludeItem(item.id)}
                            disabled={saving || uploadStatus === 'finalized'}
                            className="flex-1 flex items-center justify-center gap-2 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-100 transition-colors disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                            Exclude
                          </button>
                          <button 
                            onClick={() => handleApprove(item)}
                            disabled={!suggestedProduct || saving || uploadStatus === 'finalized'}
                            className={cn(
                              "flex-[2] flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all disabled:opacity-50",
                              isStaged 
                                ? "bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/20" 
                                : "bg-stone-900 text-white hover:bg-stone-800"
                            )}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {isStaged ? 'Confirm Match' : 'Approve Match'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {sortedProcessedItems.length > 0 && (
          <div className="space-y-4 pt-10">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-sm font-bold text-stone-400 uppercase tracking-widest">Processed</h3>
              {pendingItems.length === 0 && uploadStatus !== 'finalized' && (
                <button
                  onClick={() => pendingItems.length > 0 ? setShowFinalizeConfirm(true) : handleFinalize()}
                  disabled={saving}
                  className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {selectedItems.size > 0 ? `Add ${selectedItems.size} selected only to compare` : 'Add To Compare'}
                </button>
              )}
            </div>
            
            {excludedItems.size > 0 && (
              <div className="mt-10 space-y-4">
                <h3 className="text-sm font-bold text-stone-400 uppercase tracking-widest px-2">Excluded Items ({excludedItems.size})</h3>
                <div className="space-y-2">
                  {allItems.filter(i => excludedItems.has(i.id)).map(item => (
                    <div key={item.id} className="flex items-center justify-between p-4 bg-stone-50 border border-stone-100 rounded-2xl">
                      <div className="flex items-center gap-3">
                        <XCircle className="w-5 h-5 text-stone-400" />
                        <span className="text-sm font-medium text-stone-500">{item.rawName}</span>
                      </div>
                      <button 
                        onClick={() => toggleExcludeItem(item.id)}
                        className="text-xs font-bold text-stone-900 hover:underline"
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {sortedProcessedItems.map((item) => {
                const suggestedProduct = getProduct(item.suggestedProductId);
                const statusStyles = 
                  (item.status === 'approved' || item.status === 'manual') ? "bg-emerald-50 border-emerald-100 text-emerald-700" :
                  item.status === 'rejected' ? "bg-red-50 border-red-100 text-red-700" :
                  "bg-blue-50 border-blue-100 text-blue-700"; 

                return (
                  <div 
                    key={item.id}
                    className={cn("flex items-center justify-between p-4 rounded-2xl border transition-all", statusStyles)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                        {(item.status === 'approved' || item.status === 'manual') && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                        {item.status === 'rejected' && <XCircle className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="font-bold text-sm">
                          {highlightSearchText(item.rawName, searchQuery)}
                        </p>
                        <p className="text-[10px] font-medium opacity-70 uppercase tracking-wider">
                          {item.status === 'approved' ? `Matched to: ${suggestedProduct?.canonicalName || item.suggestedProductName}` : 
                           item.status === 'rejected' ? 'Rejected' : 
                           `Manually matched to: ${suggestedProduct?.canonicalName || item.suggestedProductName}`}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleUndo(item)}
                      disabled={saving || uploadStatus === 'finalized'}
                      className="px-4 py-1.5 bg-white/50 hover:bg-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      Undo
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showFinalizeConfirm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">Unresolved Items</h3>
              <p className="text-sm text-stone-500 mb-8">
                You have {pendingItems.length} items that haven't been approved or rejected. You can save this snapshot as "Needs Review" to continue later. It will not appear in comparisons until finalized.
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleSaveNeedsReview} 
                  disabled={saving}
                  className="w-full px-4 py-3 bg-amber-500 text-white rounded-2xl font-bold hover:bg-amber-600 transition-all disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save as Needs Review'}
                </button>
                <button 
                  onClick={() => setShowFinalizeConfirm(false)} 
                  disabled={saving}
                  className="w-full px-4 py-3 border border-stone-200 rounded-2xl font-bold hover:bg-stone-50 transition-all disabled:opacity-50"
                >
                  Go Back to Review
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isCreateModalOpen && itemToCreate && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full my-8"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-stone-900 flex items-center justify-center">
                    <PlusCircle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Create New Product</h3>
                    <p className="text-xs text-stone-500 uppercase tracking-widest">Review & Confirm Catalog Data</p>
                  </div>
                </div>
                <button onClick={() => setIsCreateModalOpen(false)} className="p-2 hover:bg-stone-100 rounded-full">
                  <XCircle className="w-6 h-6 text-stone-400" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Supplier Context */}
                <div className="bg-stone-50 rounded-2xl p-4 border border-stone-100">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="w-4 h-4 text-stone-400" />
                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Supplier Source</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-stone-400 uppercase font-bold">Supplier</p>
                      <p className="text-sm font-bold">{suppliers.find(s => s.id === quotation?.supplierId)?.name || 'Unknown'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-stone-400 uppercase font-bold">Extracted Price</p>
                      <p className="text-sm font-bold">
                        {formatCurrency(itemToCreate.price, itemToCreate.currency)}
                        {itemToCreate.currency !== 'USD' && exchangeRates[itemToCreate.currency] && (
                          <span className="ml-2 text-emerald-600">
                            (≈ ${ (itemToCreate.price / exchangeRates[itemToCreate.currency]).toFixed(2) })
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-[10px] text-stone-400 uppercase font-bold">Raw Supplier Item Name</p>
                      <p className="text-sm font-mono bg-white p-2 rounded border border-stone-100 mt-1">{itemToCreate.rawName}</p>
                    </div>
                  </div>
                </div>

                {/* Product Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                      <Tag className="w-3 h-3" /> Canonical Product Name
                    </label>
                    <input
                      type="text"
                      value={newProductData.canonicalName}
                      onChange={e => setNewProductData({...newProductData, canonicalName: e.target.value})}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none font-medium"
                      placeholder="e.g. iPhone 15 Pro Max 256GB"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                      <Box className="w-3 h-3" /> Brand
                    </label>
                    <input
                      type="text"
                      value={newProductData.brand}
                      onChange={e => setNewProductData({...newProductData, brand: e.target.value})}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                      placeholder="e.g. Apple"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                      <Layers className="w-3 h-3" /> Category
                    </label>
                    <input
                      type="text"
                      value={newProductData.category}
                      onChange={e => setNewProductData({...newProductData, category: e.target.value})}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                      placeholder="e.g. Smartphones"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                      <Tag className="w-3 h-3" /> Cost Price (Base Currency - USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newProductData.costPrice}
                      onChange={e => setNewProductData({...newProductData, costPrice: Number(e.target.value)})}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none font-bold text-emerald-600"
                      placeholder="0.00"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                      <Hash className="w-3 h-3" /> Internal Reference / SKU
                    </label>
                    <input
                      type="text"
                      value={newProductData.internalReference}
                      onChange={e => setNewProductData({...newProductData, internalReference: e.target.value})}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                      placeholder="Optional"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                      <Box className="w-3 h-3" /> Capacity
                    </label>
                    <input
                      type="text"
                      value={newProductData.capacity}
                      onChange={e => setNewProductData({...newProductData, capacity: e.target.value})}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                      placeholder="e.g. 256GB"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                      <Palette className="w-3 h-3" /> Color
                    </label>
                    <input
                      type="text"
                      value={newProductData.color}
                      onChange={e => setNewProductData({...newProductData, color: e.target.value})}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                      placeholder="e.g. Titanium Grey"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                      <GitBranch className="w-3 h-3" /> Version / Region
                    </label>
                    <input
                      type="text"
                      value={newProductData.version}
                      onChange={e => setNewProductData({...newProductData, version: e.target.value})}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                      placeholder="e.g. Middle East"
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-stone-100">
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={() => setIsCreateModalOpen(false)}
                    disabled={saving}
                    className="flex-1 px-4 py-3 border border-stone-200 rounded-2xl font-bold hover:bg-stone-50 transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateNewProductSubmit}
                    disabled={saving || !newProductData.canonicalName || !newProductData.brand || !newProductData.costPrice}
                    className="flex-[2] px-4 py-3 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />}
                    Create & Match Product
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {!newProductData.canonicalName && <p className="text-[10px] text-red-500">Name is required</p>}
                  {!newProductData.brand && <p className="text-[10px] text-red-500">Brand is required</p>}
                  {!newProductData.costPrice && <p className="text-[10px] text-red-500">Cost Price is required</p>}
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {totalItemsCount === 0 && !loading && (
          <div className="py-20 text-center space-y-4">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h3 className="text-2xl font-bold">No items to review</h3>
            <p className="text-stone-500">This quotation appears to be empty or already processed.</p>
            <button 
              onClick={() => navigate('/app')}
              className="bg-stone-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-800"
            >
              Back to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Review;
