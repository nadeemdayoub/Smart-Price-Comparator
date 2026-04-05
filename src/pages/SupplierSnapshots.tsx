import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, Timestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { Supplier, SupplierUpload } from '../types';
import { History, Calendar, FileText, ChevronRight, ArrowLeft, Loader2, AlertCircle, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { COLLECTIONS } from '../services/firestoreCollections';
import { cn, formatSnapshotDate } from '../lib/utils';
import { matchesSearch, highlightSearchText } from '../lib/search';
import { safeToDate } from '../lib/firestore-utils';

const SupplierSnapshots: React.FC = () => {
  const { supplierId } = useParams<{ supplierId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [snapshots, setSnapshots] = useState<SupplierUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!profile?.uid || !supplierId) return;

    setLoading(true);
    
    // 1. Fetch Supplier Info (one-time)
    const fetchSupplier = async () => {
      try {
        const supplierDoc = await getDoc(doc(db, 'suppliers', supplierId));
        if (supplierDoc.exists()) {
          setSupplier({ id: supplierDoc.id, ...supplierDoc.data() } as Supplier);
        }
      } catch (err) {
        console.error("Error fetching supplier:", err);
      }
    };
    fetchSupplier();

    // 2. Listen for Snapshots
    const q = query(
      collection(db, COLLECTIONS.SUPPLIER_UPLOADS),
      where('ownerUserId', '==', profile.uid),
      where('status', 'in', ['finalized', 'ready_for_review', 'needs_review', 'abandoned', 'draft'])
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as SupplierUpload))
        .filter(u => u.supplierId === supplierId);
      
      // Sort by date descending
      items.sort((a, b) => {
        const dateA = safeToDate(a.finalizedAt)?.getTime() || safeToDate(a.createdAt)?.getTime() || 0;
        const dateB = safeToDate(b.finalizedAt)?.getTime() || safeToDate(b.createdAt)?.getTime() || 0;
        return dateB - dateA;
      });
      setSnapshots(items);
      setLoading(false);
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.SUPPLIER_UPLOADS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to load snapshots."));
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile?.uid, supplierId]);

  const filteredSnapshots = useMemo(() => {
    if (!searchQuery.trim()) return snapshots;
    return snapshots.filter(s => 
      matchesSearch(s.fileName || '', searchQuery)
    );
  }, [snapshots, searchQuery]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 text-stone-300 animate-spin" />
        <p className="text-stone-400 font-bold animate-pulse">Loading snapshots...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate('/app/suppliers')}
          className="p-2 hover:bg-stone-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-stone-600" />
        </button>
        <div>
          <h2 className="text-2xl font-bold">{supplier?.name} Snapshots</h2>
          <p className="text-stone-500">Manage historical price lists and snapshots ({snapshots.length} total)</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          placeholder="Search snapshots by file name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {snapshots.length === 0 ? (
          <div className="py-20 text-center space-y-4 bg-white rounded-3xl border border-stone-200">
            <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
              <FileText className="w-8 h-8 text-stone-200" />
            </div>
            <p className="text-stone-400 font-medium">No snapshots found for this supplier.</p>
          </div>
        ) : filteredSnapshots.length === 0 ? (
          <div className="py-20 text-center space-y-4 bg-white rounded-3xl border border-stone-200">
            <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
              <Search className="w-8 h-8 text-stone-200" />
            </div>
            <p className="text-stone-400 font-medium">No snapshots match your search.</p>
          </div>
        ) : (
          filteredSnapshots.map(s => (
            <Link
              key={s.id}
              to={['ready_for_review', 'needs_review', 'draft'].includes(s.status || '') 
                ? `/app/review/${s.id}` 
                : `/app/suppliers/${supplierId}/snapshots/${s.id}`}
              className="flex items-center justify-between p-6 bg-white border border-stone-200 rounded-3xl hover:border-stone-900 hover:shadow-xl transition-all group"
            >
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 rounded-2xl bg-stone-50 flex items-center justify-center group-hover:bg-stone-900 group-hover:text-white transition-colors">
                  <Calendar className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-lg font-black text-stone-900">
                    {formatSnapshotDate(s)}
                  </p>
                  <p className="text-sm text-stone-500">
                    {highlightSearchText(s.fileName || '', searchQuery)}
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="px-2 py-0.5 bg-stone-100 text-stone-600 rounded text-[10px] font-bold uppercase tracking-wider">
                      {s.totalRows} Items
                    </span>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                      s.status === 'finalized' ? "bg-emerald-100 text-emerald-700" :
                      s.status === 'ready_for_review' ? "bg-blue-100 text-blue-700" :
                      s.status === 'needs_review' ? "bg-amber-100 text-amber-700" :
                      s.status === 'abandoned' ? "bg-red-100 text-red-700" :
                      "bg-stone-100 text-stone-700"
                    )}>
                      {s.status?.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </div>
              <ChevronRight className="w-6 h-6 text-stone-300 group-hover:text-stone-900 transition-colors" />
            </Link>
          ))
        )}
      </div>
    </div>
  );
};

export default SupplierSnapshots;
