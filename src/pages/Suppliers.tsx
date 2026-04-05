import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, onSnapshot, addDoc, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { Supplier } from '../types';
import { Plus, Search, Edit2, Trash2, Truck, Globe, Mail, X, AlertCircle, Loader2, History } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { COLLECTIONS } from '../services/firestoreCollections';
import { PriceEntry, SupplierUpload, CanonicalProduct, MatchReview } from '../types';
import { cn } from '../lib/utils';
import { Timestamp } from 'firebase/firestore';
import { useMemo } from 'react';
import { matchesSearch, highlightSearchText } from '../lib/search';

const Suppliers: React.FC = () => {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!profile?.uid) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, COLLECTIONS.SUPPLIERS),
      where('ownerUserId', '==', profile.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
      setSuppliers(items);
      setLoading(false);
      setError(null);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, COLLECTIONS.SUPPLIERS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to sync suppliers."));
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile?.uid]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      defaultCurrency: formData.get('defaultCurrency') as string,
      contactInfo: formData.get('contactInfo') as string,
      ownerUserId: profile?.uid || user?.uid,
      updatedAt: serverTimestamp(),
    };

    if (!data.ownerUserId) {
      setError("User not authenticated. Please log in again.");
      return;
    }

    try {
      if (editingSupplier) {
        await updateDoc(doc(db, COLLECTIONS.SUPPLIERS, editingSupplier.id), data);
      } else {
        await addDoc(collection(db, COLLECTIONS.SUPPLIERS), {
          ...data,
          createdAt: serverTimestamp(),
        });
      }
      setIsModalOpen(false);
      setEditingSupplier(null);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, COLLECTIONS.SUPPLIERS);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to save supplier."));
      }
    }
  };

  const handleDelete = (id: string) => {
    setDeletingSupplierId(id);
  };

  const confirmDelete = async () => {
    if (!deletingSupplierId) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteDoc(doc(db, COLLECTIONS.SUPPLIERS, deletingSupplierId));
      setDeletingSupplierId(null);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `${COLLECTIONS.SUPPLIERS}/${deletingSupplierId}`);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to delete supplier."));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const openHistory = (supplier: Supplier) => {
    navigate(`/app/suppliers/${supplier.id}/snapshots`);
  };

  const filteredSuppliers = useMemo(() => {
    if (!searchQuery.trim()) return suppliers;
    return suppliers.filter(s => 
      matchesSearch(s.name, searchQuery) ||
      matchesSearch(s.contactInfo || '', searchQuery)
    );
  }, [suppliers, searchQuery]);

  return (
    <div className="space-y-6">
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Suppliers</h2>
          <p className="text-stone-500">Manage your vendor relationships and currencies.</p>
        </div>
        <button
          onClick={() => {
            setEditingSupplier(null);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-xl font-medium hover:bg-stone-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Supplier
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          placeholder="Search suppliers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-12 text-center text-stone-400">Loading suppliers...</div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="col-span-full py-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center">
                <Truck className="w-6 h-6 text-stone-400" />
              </div>
              {searchQuery ? (
                <>
                  <p className="text-stone-600 font-medium">No suppliers match "{searchQuery}"</p>
                  <p className="text-stone-400 text-sm">Try a different search term</p>
                </>
              ) : (
                <>
                  <p className="text-stone-600 font-medium">No suppliers added yet</p>
                  <p className="text-stone-400 text-sm">Add your first supplier to get started</p>
                </>
              )}
            </div>
          </div>
        ) : (
          filteredSuppliers.map((supplier) => (
            <motion.div
              key={supplier.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center">
                  <Truck className="w-6 h-6 text-stone-600" />
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => {
                      setEditingSupplier(supplier);
                      setIsModalOpen(true);
                    }}
                    className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-lg"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(supplier.id)}
                    className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <h3 className="text-lg font-bold">
                {highlightSearchText(supplier.name, searchQuery)}
              </h3>
              <div className="mt-4 space-y-2">
                <div className="flex items-center text-sm text-stone-500">
                  <Globe className="w-4 h-4 mr-2" />
                  Default Currency: <span className="font-bold text-stone-900 ml-1">{supplier.defaultCurrency}</span>
                </div>
                {supplier.contactInfo && (
                  <div className="flex items-center text-sm text-stone-500">
                    <Mail className="w-4 h-4 mr-2" />
                    {supplier.contactInfo}
                  </div>
                )}
              </div>
              
              <div className="mt-6 pt-6 border-t border-stone-100 flex justify-between items-center text-xs">
                <span className="text-stone-400">Latest Quotation: {supplier.createdAt ? new Date(supplier.createdAt?.seconds * 1000).toLocaleDateString() : 'None'}</span>
                <button 
                  onClick={() => openHistory(supplier)}
                  className="text-stone-900 font-bold hover:underline flex items-center gap-1"
                >
                  <History className="w-3 h-3" />
                  View History
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <h3 className="text-lg font-bold">{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-stone-400 hover:text-stone-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Supplier Name</label>
                <input
                  name="name"
                  required
                  defaultValue={editingSupplier?.name}
                  placeholder="e.g. Global Tech Distribution"
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Default Currency</label>
                <input
                  name="defaultCurrency"
                  required
                  defaultValue={editingSupplier?.defaultCurrency || 'USD'}
                  placeholder="e.g. USD, EUR, or British Pound"
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase">Contact Info</label>
                <textarea
                  name="contactInfo"
                  defaultValue={editingSupplier?.contactInfo}
                  placeholder="Email, phone or address..."
                  className="w-full px-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-stone-900/5 outline-none h-24 resize-none"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-stone-200 rounded-xl font-medium hover:bg-stone-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-stone-900 text-white rounded-xl font-medium hover:bg-stone-800"
                >
                  {editingSupplier ? 'Save Changes' : 'Create Supplier'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingSupplierId && (
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
                <h3 className="text-xl font-bold text-stone-900">Delete Supplier?</h3>
                <p className="text-stone-500">
                  Are you sure you want to delete <span className="font-bold text-stone-900">{suppliers.find(s => s.id === deletingSupplierId)?.name}</span>? This action cannot be undone.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setDeletingSupplierId(null)}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-50 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="flex-1 bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Yes, Delete'
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Suppliers;
