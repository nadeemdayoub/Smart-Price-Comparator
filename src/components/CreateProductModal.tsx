import React, { useState } from 'react';
import { collection, doc, writeBatch, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { MatchReview, CanonicalProduct, PriceEntry, AuditLog, ProductAlias, ExchangeRate } from '../types';
import { X, Loader2, Package, CheckCircle2, AlertCircle, RefreshCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { COLLECTIONS } from '../services/firestoreCollections';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { normalizeProductName, generateSearchTokens, createSensitiveSignature } from '../utils/productNormalization';
import { sanitizeFirestoreData } from '../lib/firestore-utils';
import { query, where, getDocs } from 'firebase/firestore';
import { syncPriceEntry } from '../services/pricingService';

interface CreateProductModalProps {
  review: MatchReview;
  onClose: () => void;
  onSuccess: (productId: string) => void;
}

const CreateProductModal: React.FC<CreateProductModalProps> = ({ review, onClose, onSuccess }) => {
  const { profile } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useAsLearning, setUseAsLearning] = useState(true);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);

  React.useEffect(() => {
    if (!profile?.uid) return;
    const fetchRates = async () => {
      try {
        const ratesSnap = await getDocs(query(
          collection(db, COLLECTIONS.EXCHANGE_RATES),
          where('ownerUserId', '==', profile.uid)
        ));
        setExchangeRates(ratesSnap.docs.map(d => ({ id: d.id, ...d.data() } as ExchangeRate)));
      } catch (err) {
        console.error("Error fetching rates in modal:", err);
      }
    };
    fetchRates();
  }, [profile?.uid]);

  const [formData, setFormData] = useState(() => {
    const rawName = review.rawName;
    const firstWord = rawName.split(' ')[0];
    // Simple heuristic: if first word is capitalized, it might be a brand
    const inferredBrand = /^[A-Z][a-zA-Z0-9]+$/.test(firstWord) ? firstWord : '';
    
    return {
      name: rawName,
      brand: inferredBrand,
      category: '',
      sku: review.rawCode || '',
      internalReference: review.rawCode || '',
      capacity: '',
      color: '',
      version: ''
    };
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid) return;

    setIsSaving(true);
    setError(null);

    try {
      const batch = writeBatch(db);
      
      // 1. Create New Canonical Product
      const productRef = doc(collection(db, COLLECTIONS.CANONICAL_PRODUCTS));
      const normalizedName = normalizeProductName(formData.name);
      
      const newProduct: Partial<CanonicalProduct> = {
        ownerUserId: review.ownerUserId,
        canonicalName: formData.name,
        normalizedName,
        brand: formData.brand,
        category: formData.category,
        internalReference: formData.internalReference,
        capacity: formData.capacity,
        color: formData.color,
        version: formData.version,
        costPrice: review.rawPrice, // Set initial cost price from supplier
        searchTokens: generateSearchTokens(normalizedName),
        sensitiveSignature: createSensitiveSignature({
          brand: formData.brand,
          capacity: formData.capacity,
          color: formData.color,
          version: formData.version
        }),
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      batch.set(productRef, sanitizeFirestoreData(newProduct));

      // 2. Update MatchReview
      const reviewRef = doc(db, COLLECTIONS.MATCH_REVIEWS, review.id);
      const reviewUpdate: Partial<MatchReview> = {
        ownerUserId: review.ownerUserId,
        finalProductId: productRef.id,
        reviewStatus: 'approved',
        finalAction: 'create_new_product',
        reviewedAt: Timestamp.now(),
        reviewedBy: profile.uid
      };
      batch.update(reviewRef, sanitizeFirestoreData(reviewUpdate));

      // 3. Create Price Entry (using unified service)
      syncPriceEntry(batch, {
        reviewId: review.id,
        ownerUserId: review.ownerUserId,
        uploadId: review.uploadId!,
        supplierId: review.supplierId!,
        productId: productRef.id,
        price: review.rawPrice,
        currency: review.rawCurrency,
        rates: exchangeRates,
        status: 'approved'
      });

      // 4. Optional: Learning / Alias
      if (useAsLearning) {
        const aliasRef = doc(collection(db, COLLECTIONS.PRODUCT_ALIASES));
        const newAlias: Partial<ProductAlias> = {
          ownerUserId: review.ownerUserId,
          productId: productRef.id,
          aliasText: review.rawName,
          normalizedAlias: normalizedName,
          sourceType: 'manual',
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
          isActive: true,
          status: 'active'
        };
        batch.set(aliasRef, sanitizeFirestoreData(newAlias));
      }

      // 5. Audit Log
      const auditRef = doc(collection(db, COLLECTIONS.AUDIT_LOGS));
      const auditEntry: Partial<AuditLog> = {
        ownerUserId: review.ownerUserId,
        userId: profile.uid,
        actionType: 'create_product_from_unmapped',
        entityType: 'canonical_product',
        entityId: productRef.id,
        description: `Created product "${formData.name}" from unmapped item "${review.rawName}"`,
        meta: {
          uploadId: review.uploadId,
          supplierId: review.supplierId,
          originalRawName: review.rawName,
          previousStatus: review.reviewStatus,
          newStatus: 'approved'
        },
        createdAt: serverTimestamp()
      };
      batch.set(auditRef, sanitizeFirestoreData(auditEntry));

      // Commit the batch and wait for it to finish
      await batch.commit();
      
      onSuccess(productRef.id);
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.CREATE, COLLECTIONS.CANONICAL_PRODUCTS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to create and link product."));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="p-6 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Create & Link Product</h3>
              <p className="text-xs text-stone-500">Create catalog entry from supplier item.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100 mb-4">
            <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Supplier Item</p>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-stone-900">{review.rawName}</p>
                {review.rawCode && <p className="text-xs text-stone-500 font-mono mt-1">{review.rawCode}</p>}
              </div>
              <div className="text-right">
                <p className="font-bold text-stone-900">{(review.rawPrice || 0).toLocaleString()} {review.rawCurrency}</p>
                <p className="text-[10px] text-stone-400 font-bold uppercase">Original Price</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-stone-500 uppercase">Product Name</label>
              <input
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Brand</label>
                <input
                  value={formData.brand}
                  onChange={e => setFormData(prev => ({ ...prev, brand: e.target.value }))}
                  placeholder="e.g. Apple"
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Category</label>
                <input
                  value={formData.category}
                  onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))}
                  placeholder="e.g. Laptops"
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-stone-500 uppercase">Internal Reference (SKU)</label>
              <input
                value={formData.internalReference}
                onChange={e => setFormData(prev => ({ ...prev, internalReference: e.target.value }))}
                className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none font-mono"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Capacity</label>
                <input
                  value={formData.capacity}
                  onChange={e => setFormData(prev => ({ ...prev, capacity: e.target.value }))}
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Color</label>
                <input
                  value={formData.color}
                  onChange={e => setFormData(prev => ({ ...prev, color: e.target.value }))}
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Version</label>
                <input
                  value={formData.version}
                  onChange={e => setFormData(prev => ({ ...prev, version: e.target.value }))}
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                />
              </div>
            </div>

            <label className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl cursor-pointer hover:bg-stone-100 transition-colors">
              <input 
                type="checkbox"
                checked={useAsLearning}
                onChange={e => setUseAsLearning(e.target.checked)}
                className="w-4 h-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-stone-600 font-medium">Use this as a future match / alias learning</span>
            </label>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-stone-200 rounded-2xl font-bold hover:bg-stone-50 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-4 py-3 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Create & Match
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default CreateProductModal;
