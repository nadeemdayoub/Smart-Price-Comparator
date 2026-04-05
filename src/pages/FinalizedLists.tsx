import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { Supplier, SupplierUpload } from '../types';
import { 
  History, 
  Calendar, 
  FileText, 
  ChevronRight, 
  Loader2, 
  AlertCircle, 
  Search, 
  Filter,
  ArrowRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { COLLECTIONS } from '../services/firestoreCollections';
import { safeToDate } from '../lib/firestore-utils';
import { matchesSearch, highlightSearchText } from '../lib/search';
import { formatSnapshotDate } from '../lib/utils';

const FinalizedLists: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [snapshots, setSnapshots] = useState<SupplierUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (!profile?.uid) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // 1. Fetch Suppliers for filtering and display
        const suppliersQuery = query(
          collection(db, COLLECTIONS.SUPPLIERS),
          where('ownerUserId', '==', profile.uid)
        );
        const suppliersSnap = await getDocs(suppliersQuery);
        const suppliersList = suppliersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier));
        setSuppliers(suppliersList);

        // 2. Fetch All Finalized Snapshots
        const snapshotsQuery = query(
          collection(db, COLLECTIONS.SUPPLIER_UPLOADS),
          where('ownerUserId', '==', profile.uid),
          where('status', '==', 'finalized')
        );
        const snap = await getDocs(snapshotsQuery);
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierUpload));
        
        // Sort in memory to avoid composite index requirement
        items.sort((a, b) => {
          const dateA = safeToDate(a.finalizedAt)?.getTime() || 0;
          const dateB = safeToDate(b.finalizedAt)?.getTime() || 0;
          return dateB - dateA;
        });

        setSnapshots(items);
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, COLLECTIONS.SUPPLIER_UPLOADS);
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to load finalized lists."));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [profile?.uid]);

  const filteredSnapshots = snapshots.filter(s => {
    const matchesSupplier = supplierFilter === 'all' || s.supplierId === supplierFilter;
    const matchesKeyword = matchesSearch(s.fileName, searchQuery);
    
    let matchesDate = true;
    if (dateFilter) {
      try {
        const date = safeToDate(s.finalizedAt);
        if (!date) {
          matchesDate = false;
        } else {
          const snapshotDate = date.toISOString().split('T')[0];
          matchesDate = snapshotDate === dateFilter;
        }
      } catch (e) {
        matchesDate = false;
      }
    }

    return matchesSupplier && matchesKeyword && matchesDate;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 text-stone-300 animate-spin" />
        <p className="text-stone-400 font-bold animate-pulse">Loading finalized lists...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Finalized Lists</h2>
          <p className="text-stone-500">History of all approved supplier snapshots</p>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-stone-400 mb-2">
          <Filter className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">Filters</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search by file name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 transition-colors"
            />
          </div>
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 transition-colors"
          >
            <option value="all">All Suppliers</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-900 transition-colors"
          />
        </div>
      </div>

      {/* Lists Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSnapshots.length === 0 ? (
          <div className="col-span-full py-20 text-center space-y-4 bg-white rounded-3xl border border-stone-200">
            <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
              <FileText className="w-8 h-8 text-stone-200" />
            </div>
            <p className="text-stone-400 font-medium">No finalized lists found matching your filters.</p>
          </div>
        ) : (
          filteredSnapshots.map((s, index) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm hover:shadow-xl transition-all group flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:bg-stone-900 group-hover:text-white transition-colors">
                  <FileText className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full uppercase">
                  Finalized
                </span>
              </div>
              
              <div className="flex-1 space-y-1 mb-6">
                <h3 className="font-bold text-stone-900 truncate" title={s.fileName}>
                  {highlightSearchText(s.fileName, searchQuery)}
                </h3>
                <p className="text-sm text-stone-500">
                  {suppliers.find(sup => sup.id === s.supplierId)?.name || 'Unknown Supplier'}
                </p>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-stone-50">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-tighter">Finalized Date</p>
                  <div className="flex items-center gap-1.5 text-xs text-stone-600">
                    <Calendar className="w-3 h-3" />
                    {formatSnapshotDate(s)}
                  </div>
                </div>
                
                <button
                  onClick={() => navigate(`/app/suppliers/${s.supplierId}/snapshots/${s.id}`)}
                  className="flex items-center gap-2 text-sm font-bold text-stone-900 group-hover:gap-3 transition-all"
                >
                  View Snapshot
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};

export default FinalizedLists;
