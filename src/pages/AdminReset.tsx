import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  collection, 
  getDocs, 
  getDoc,
  writeBatch, 
  doc, 
  query, 
  limit,
  where
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../AuthContext';
import { COLLECTIONS } from '../services/firestoreCollections';
import { UserProfile } from '../types';
import { cn } from '../lib/utils';
import { 
  ShieldAlert, 
  Trash2, 
  RefreshCcw, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2,
  ArrowLeft,
  Plus,
  Search,
  User,
  Building2,
  AlertCircle,
  PlusCircle,
  Save,
  Check,
  XCircle,
  ChevronDown
} from 'lucide-react';

const ADMIN_EMAILS = ['sales@qartaj.co', 'nadeemdayoub@gmail.com'];

const AdminReset: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [isResetting, setIsResetting] = useState(false);
  const [softResetUser, setSoftResetUser] = useState<UserProfile | null>(null);
  const [confirmType, setConfirmType] = useState<'soft' | 'full' | null>(null);
  const [resetLogs, setResetLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Supplier Seeding State
  const [userSearchInput, setUserSearchInput] = useState('');
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [seedSuppliersList, setSeedSuppliersList] = useState<Array<{ 
    id: string;
    name: string; 
    currency: string; 
    country?: string; 
    notes?: string; 
    active: boolean 
  }>>([
    { id: '1', name: 'GBS', currency: 'USD', active: true },
    { id: '2', name: 'Canon Aws', currency: 'IQD', active: true },
    { id: '3', name: 'Trust Lexar', currency: 'USD', active: true },
    { id: '4', name: 'ASO Erbil', currency: 'USD', active: true },
    { id: '5', name: 'isam vision gulf', currency: 'USD', active: true },
    { id: '6', name: 'Keystone', currency: 'USD', active: true },
    { id: '7', name: 'Advance Media', currency: 'AED', active: true },
    { id: '8', name: 'AMGREAT HONG KONG LIMITED', currency: 'USD', active: true },
    { id: '9', name: 'Hollyland', currency: 'USD', active: true },
    { id: '10', name: 'Tamron', currency: 'USD', active: true },
    { id: '11', name: 'Thomsun', currency: 'AED', active: true },
    { id: '12', name: 'YOLOBOX', currency: 'USD', active: true },
    { id: '13', name: 'Ziusudra', currency: 'USD', active: true },
    { id: '14', name: 'الكاميرا الحديثة', currency: 'USD', active: true },
    { id: '15', name: 'somit-SHAOXING', currency: 'CNY', active: true },
    { id: '16', name: 'اسو كوسره ت ره زا', currency: 'USD', active: true },
    { id: '17', name: 'ulanzi-VIJIM LIMITED', currency: 'USD', active: true },
    { id: '18', name: 'AAB', currency: 'KWD', active: true }
  ]);
  const [previewData, setPreviewData] = useState<{ toAdd: string[]; toSkip: string[] } | null>(null);
  const [seedResults, setSeedResults] = useState<{ added: string[]; skipped: string[]; failed: string[] } | null>(null);

  const isGlobalAdmin = profile?.email && ADMIN_EMAILS.includes(profile.email);

  const log = (msg: string) => {
    console.log(`[AdminReset] ${msg}`);
    setResetLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const deleteCollection = async (collectionName: string, ownerUserId?: string) => {
    if (ownerUserId) {
      log(`Querying collection: ${collectionName} (Filtered by User: ${ownerUserId})...`);
    } else {
      log(`Querying collection: ${collectionName} (GLOBAL DELETE - NO FILTER)...`);
    }
    let deletedCount = 0;
    
    try {
      while (true) {
        let q = query(collection(db, collectionName), limit(500));
        
        if (ownerUserId) {
          q = query(collection(db, collectionName), where('ownerUserId', '==', ownerUserId), limit(500));
        }
        
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
          log(`Collection ${collectionName} is already empty.`);
          break;
        }

        log(`Found ${snapshot.size} documents in ${collectionName}. Committing batch delete...`);
        const batch = writeBatch(db);
        snapshot.docs.forEach((d) => {
          batch.delete(d.ref);
        });

        await batch.commit();
        deletedCount += snapshot.size;
        log(`Successfully deleted ${snapshot.size} documents from ${collectionName} (Running Total: ${deletedCount})`);
        
        if (snapshot.size < 500) break;
      }
    } catch (err: any) {
      log(`CRITICAL ERROR deleting ${collectionName}: ${err.message}`);
      throw err;
    }
    
    log(`Finished deletion of ${collectionName}. Total documents removed: ${deletedCount}`);
  };

  const executeReset = async (type: 'soft' | 'full') => {
    if (!isGlobalAdmin) {
      setError("Unauthorized. Only global admins can perform this action.");
      return;
    }

    if (type === 'soft' && !softResetUser) {
      setError("Please select a user for Soft Reset.");
      return;
    }

    setIsResetting(true);
    setConfirmType(null);
    setResetLogs([]);
    setError(null);
    setSuccess(false);

    log(`INITIALIZING ${type.toUpperCase()} RESET...`);

    try {
      const operationalCollections = [
        COLLECTIONS.SUPPLIERS,
        COLLECTIONS.CANONICAL_PRODUCTS,
        COLLECTIONS.PRODUCT_ALIASES,
        COLLECTIONS.SUPPLIER_UPLOADS,
        COLLECTIONS.UPLOAD_ITEMS_RAW,
        COLLECTIONS.MATCH_REVIEWS,
        COLLECTIONS.PRICE_ENTRIES,
        COLLECTIONS.MATCH_LEARNING,
        COLLECTIONS.REJECTED_MATCHES,
        COLLECTIONS.AUDIT_LOGS,
        COLLECTIONS.EXCHANGE_RATES,
        'products',
        'quotations',
        'quotation_items'
      ];

      const identityCollections = [
        COLLECTIONS.USERS
      ];

      // 1. Delete Operational Data
      for (const coll of operationalCollections) {
        const targetUid = type === 'soft' ? (softResetUser?.uid || softResetUser?.id) : undefined;
        await deleteCollection(coll, targetUid);
      }

      // 2. Delete Identity Data if Full Reset
      if (type === 'full') {
        log("PROCEEDING TO IDENTITY DATA DELETION...");
        for (const coll of identityCollections) {
          await deleteCollection(coll);
        }
        
        log("Clearing browser storage (localStorage/sessionStorage)...");
        localStorage.clear();
        sessionStorage.clear();
        
        log("Logging out of Firebase Auth...");
        await auth.signOut();
        log("FULL RESET COMPLETE. Redirecting to login in 3 seconds...");
        setTimeout(() => navigate('/login'), 3000);
      } else {
        log("SOFT RESET COMPLETE. Operational data cleared.");
      }

      setSuccess(true);
    } catch (err: any) {
      console.error("Reset error:", err);
      setError(err.message || "An error occurred during reset.");
      log(`RESET FAILED: ${err.message}`);
    } finally {
      setIsResetting(false);
    }
  };

  useEffect(() => {
    if (isGlobalAdmin) {
      fetchUsers();
    }
  }, [isGlobalAdmin]);

  const fetchUsers = async () => {
    try {
      const snap = await getDocs(query(collection(db, COLLECTIONS.USERS), limit(100)));
      setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));
    } catch (err) {
      console.error("Error fetching users:", err);
    }
  };

  const searchUser = async (input: string) => {
    if (!input) return;
    setIsSearching(true);
    setError(null);
    setSelectedUser(null);
    setPreviewData(null);
    setSeedResults(null);

    try {
      let userDoc: UserProfile | null = null;
      
      // Try UID first
      const uidQuery = query(collection(db, COLLECTIONS.USERS), where('uid', '==', input), limit(1));
      const uidSnap = await getDocs(uidQuery);
      
      if (!uidSnap.empty) {
        userDoc = { id: uidSnap.docs[0].id, ...uidSnap.docs[0].data() } as UserProfile;
      } else {
        // Try Email
        const emailQuery = query(collection(db, COLLECTIONS.USERS), where('email', '==', input), limit(1));
        const emailSnap = await getDocs(emailQuery);
        if (!emailSnap.empty) {
          userDoc = { id: emailSnap.docs[0].id, ...emailSnap.docs[0].data() } as UserProfile;
        }
      }

      if (userDoc) {
        setSelectedUser(userDoc);
      } else {
        setError("User not found by UID or Email.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const generatePreview = async () => {
    const targetUid = selectedUser?.uid || selectedUser?.id;
    if (!targetUid) return;
    setIsResetting(true);
    setPreviewData(null);
    
    try {
      // Fetch existing suppliers for this user
      const existingSnap = await getDocs(query(
        collection(db, COLLECTIONS.SUPPLIERS), 
        where('ownerUserId', '==', targetUid)
      ));
      
      const existingNames = new Set(existingSnap.docs.map(d => d.data().name.toLowerCase().trim()));
      
      const toAdd: string[] = [];
      const toSkip: string[] = [];
      
      seedSuppliersList.filter(s => s.active).forEach(s => {
        if (existingNames.has(s.name.toLowerCase().trim())) {
          toSkip.push(s.name);
        } else {
          toAdd.push(s.name);
        }
      });
      
      setPreviewData({ toAdd, toSkip });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsResetting(false);
    }
  };

  const executeSeed = async () => {
    const targetUid = selectedUser?.uid || selectedUser?.id;
    if (!targetUid || !previewData) return;
    
    setIsResetting(true);
    setSeedResults(null);
    setResetLogs([]);
    log(`STARTING SEED EXECUTION FOR USER: ${targetUid}`);

    const added: string[] = [];
    const skipped: string[] = [...previewData.toSkip];
    const failed: string[] = [];

    try {
      const batch = writeBatch(db);
      const activeSuppliers = seedSuppliersList.filter(s => s.active && previewData.toAdd.includes(s.name));

      for (const s of activeSuppliers) {
        try {
          const supplierRef = doc(collection(db, COLLECTIONS.SUPPLIERS));
          batch.set(supplierRef, {
            id: supplierRef.id,
            ownerUserId: targetUid,
            name: s.name,
            defaultCurrency: s.currency,
            country: s.country || null,
            notes: s.notes || null,
            isVerified: true,
            createdAt: new Date().toISOString()
          });
          added.push(s.name);
          log(`Queued: ${s.name}`);
        } catch (err) {
          failed.push(s.name);
          log(`Failed to queue: ${s.name}`);
        }
      }

      if (added.length > 0) {
        await batch.commit();
        log(`SUCCESS: Committed ${added.length} new suppliers.`);
      } else {
        log("No new suppliers to add.");
      }

      setSeedResults({ added, skipped, failed });
      setSuccess(true);
      setPreviewData(null);
    } catch (err: any) {
      log(`EXECUTION FAILED: ${err.message}`);
      setError(err.message);
    } finally {
      setIsResetting(false);
    }
  };

  if (!isGlobalAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-stone-900">Access Denied</h2>
        <p className="text-stone-500 mt-2">Only global administrators can access this utility.</p>
        <button 
          onClick={() => navigate('/app')}
          className="mt-6 px-6 py-2 bg-stone-900 text-white rounded-xl font-bold"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/app')}
            className="p-2 hover:bg-stone-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-stone-600" />
          </button>
          <div>
            <h2 className="text-3xl font-black text-stone-900">System Reset Utility</h2>
            <p className="text-stone-500 font-medium">Manage project data lifecycle and clean testing environments.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Soft Reset Card */}
        <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center">
            <RefreshCcw className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-stone-900">Soft Reset</h3>
            <p className="text-sm text-stone-500 mt-1">
              Wipes operational data for a specific user but preserves accounts and company structure.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase text-stone-400">Target User for Reset</label>
            <div className="relative">
              <select
                value={softResetUser?.uid || softResetUser?.id || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const user = allUsers.find(u => (u.uid === val || u.id === val));
                  setSoftResetUser(user || null);
                }}
                className="w-full pl-4 pr-10 py-3 bg-stone-50 border border-stone-100 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all text-sm"
              >
                <option value="">Select a user...</option>
                {allUsers.map(u => (
                  <option key={u.id} value={u.uid || u.id}>{u.displayName || u.email} ({u.email})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
            </div>
          </div>

          <ul className="text-xs space-y-2 text-stone-400 font-medium">
            <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Keeps Login Working</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Keeps Company Structure</li>
            <li className="flex items-center gap-2"><Trash2 className="w-3 h-3 text-red-400" /> Deletes User's Catalog Data</li>
            <li className="flex items-center gap-2"><Trash2 className="w-3 h-3 text-red-400" /> Deletes User's Upload History</li>
          </ul>
          <button
            onClick={() => setConfirmType('soft')}
            disabled={isResetting || !softResetUser}
            className="w-full py-4 bg-stone-100 text-stone-900 rounded-2xl font-bold hover:bg-stone-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isResetting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Perform Soft Reset"}
          </button>
        </div>

        {/* Full Reset Card */}
        <div className="bg-white p-8 rounded-3xl border border-red-100 shadow-sm space-y-6">
          <div className="w-12 h-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center">
            <Trash2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-stone-900">Full Reset</h3>
            <p className="text-sm text-stone-500 mt-1">
              Wipes EVERYTHING. Deletes all users, companies, and data. The project will be returned to a completely empty state.
            </p>
          </div>
          <div className="bg-red-50 p-4 rounded-2xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-xs text-red-700 leading-relaxed">
              <strong>WARNING:</strong> This action is irreversible. You will be logged out immediately and will need to re-register.
            </p>
          </div>
          <button
            onClick={() => setConfirmType('full')}
            disabled={isResetting}
            className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-red-200"
          >
            {isResetting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Perform Full Reset"}
          </button>
        </div>
      </div>

      {/* Seed Utility Card */}
      <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
              <PlusCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-stone-900">Supplier Seeding Utility</h3>
              <p className="text-sm text-stone-500 mt-1">Target a user and deploy a package of suppliers to their company.</p>
            </div>
          </div>
        </div>

        {/* 1. User Targeting */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-stone-900">
            <User className="w-4 h-4" />
            <h4 className="font-bold uppercase text-xs tracking-wider">1. Target User</h4>
          </div>
          
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase text-stone-400">Select User (Recent Users)</label>
            <div className="relative">
              <select
                value={selectedUser?.uid || selectedUser?.id || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const user = allUsers.find(u => (u.uid === val || u.id === val));
                  if (user) {
                    setSelectedUser(user);
                    setPreviewData(null);
                    setSeedResults(null);
                    setError(null);
                  }
                }}
                className="w-full pl-4 pr-10 py-3 bg-stone-50 border border-stone-100 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm"
              >
                <option value="">Select a user...</option>
                {allUsers.map(u => (
                  <option key={u.id} value={u.uid || u.id}>{u.displayName || u.email} ({u.email})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
            </div>
          </div>

          {selectedUser && (
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase text-blue-400">User Details</p>
                <p className="text-sm font-bold text-blue-900">{selectedUser.displayName || 'Unnamed User'}</p>
                <p className="text-xs text-blue-700">{selectedUser.email}</p>
                <p className="text-[10px] font-mono text-blue-500 mt-1">UID: {selectedUser.uid}</p>
              </div>
            </div>
          )}
        </div>

        {/* 2. Editable Supplier Package */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-stone-900">
              <Building2 className="w-4 h-4" />
              <h4 className="font-bold uppercase text-xs tracking-wider">2. Supplier Package</h4>
            </div>
            <button
              onClick={() => setSeedSuppliersList(prev => [...prev, { id: Date.now().toString(), name: '', currency: 'USD', active: true }])}
              className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
            >
              <Plus className="w-3 h-3" /> Add Supplier Row
            </button>
          </div>

          <div className="overflow-x-auto border border-stone-100 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="px-4 py-3 text-[10px] font-bold uppercase text-stone-400">Status</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase text-stone-400">Supplier Name</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase text-stone-400">Currency</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase text-stone-400">Country</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase text-stone-400">Notes</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase text-stone-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {seedSuppliersList.map((s, idx) => (
                  <tr key={s.id} className={cn("transition-colors", !s.active && "opacity-50 grayscale")}>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => {
                          const newList = [...seedSuppliersList];
                          newList[idx].active = !newList[idx].active;
                          setSeedSuppliersList(newList);
                        }}
                        className={cn(
                          "w-8 h-5 rounded-full relative transition-all",
                          s.active ? "bg-emerald-500" : "bg-stone-200"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                          s.active ? "left-4" : "left-1"
                        )} />
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={s.name}
                        onChange={(e) => {
                          const newList = [...seedSuppliersList];
                          newList[idx].name = e.target.value;
                          setSeedSuppliersList(newList);
                        }}
                        placeholder="Supplier name..."
                        className="w-full bg-transparent border-none focus:ring-0 text-sm font-bold text-stone-900"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={s.currency}
                        onChange={(e) => {
                          const newList = [...seedSuppliersList];
                          newList[idx].currency = e.target.value;
                          setSeedSuppliersList(newList);
                        }}
                        className="bg-transparent border-none focus:ring-0 text-xs font-medium text-stone-600"
                      >
                        <option value="USD">USD ($)</option>
                        <option value="IQD">IQD (ع.د)</option>
                        <option value="AED">AED (د.إ)</option>
                        <option value="KWD">KWD (د.ك)</option>
                        <option value="CNY">CNY (¥)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={s.country || ''}
                        onChange={(e) => {
                          const newList = [...seedSuppliersList];
                          newList[idx].country = e.target.value;
                          setSeedSuppliersList(newList);
                        }}
                        placeholder="Optional..."
                        className="w-full bg-transparent border-none focus:ring-0 text-xs text-stone-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={s.notes || ''}
                        onChange={(e) => {
                          const newList = [...seedSuppliersList];
                          newList[idx].notes = e.target.value;
                          setSeedSuppliersList(newList);
                        }}
                        placeholder="Optional..."
                        className="w-full bg-transparent border-none focus:ring-0 text-xs text-stone-500"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setSeedSuppliersList(prev => prev.filter(item => item.id !== s.id))}
                        className="p-1 text-stone-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Preview & Execution */}
        <div className="pt-4 border-t border-stone-100 flex flex-col gap-6">
          {!previewData && !seedResults && (
            <button
              onClick={generatePreview}
              disabled={!(selectedUser?.uid || selectedUser?.id) || isResetting}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-blue-200"
            >
              {isResetting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Generate Seed Preview"}
            </button>
          )}

          {previewData && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-6 bg-emerald-50 border border-emerald-100 rounded-3xl space-y-3">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <Check className="w-5 h-5" />
                    <h5 className="font-bold">Ready to Add ({previewData.toAdd.length})</h5>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {previewData.toAdd.map(name => (
                      <span key={name} className="px-3 py-1 bg-white border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded-lg">
                        {name}
                      </span>
                    ))}
                    {previewData.toAdd.length === 0 && <p className="text-xs text-emerald-600 italic">No new suppliers to add.</p>}
                  </div>
                </div>

                <div className="p-6 bg-amber-50 border border-amber-100 rounded-3xl space-y-3">
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertCircle className="w-5 h-5" />
                    <h5 className="font-bold">Already Exist ({previewData.toSkip.length})</h5>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {previewData.toSkip.map(name => (
                      <span key={name} className="px-3 py-1 bg-white border border-amber-200 text-amber-700 text-[10px] font-bold rounded-lg">
                        {name}
                      </span>
                    ))}
                    {previewData.toSkip.length === 0 && <p className="text-xs text-amber-600 italic">No duplicates found.</p>}
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setPreviewData(null)}
                  className="flex-1 py-4 border border-stone-200 text-stone-600 rounded-2xl font-bold hover:bg-stone-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={executeSeed}
                  disabled={previewData.toAdd.length === 0 || isResetting}
                  className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-200"
                >
                  {isResetting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> Execute Seed</>}
                </button>
              </div>
            </div>
          )}

          {seedResults && (
            <div className="p-8 bg-stone-900 rounded-3xl space-y-6 animate-in zoom-in-95">
              <div className="flex items-center justify-between">
                <h5 className="text-xl font-black text-white">Seed Execution Summary</h5>
                <button onClick={() => setSeedResults(null)} className="text-stone-500 hover:text-white">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                  <p className="text-[10px] font-bold uppercase text-emerald-500 tracking-widest">Added</p>
                  <p className="text-3xl font-black text-emerald-400">{seedResults.added.length}</p>
                </div>
                <div className="text-center p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20">
                  <p className="text-[10px] font-bold uppercase text-amber-500 tracking-widest">Skipped</p>
                  <p className="text-3xl font-black text-amber-400">{seedResults.skipped.length}</p>
                </div>
                <div className="text-center p-4 bg-red-500/10 rounded-2xl border border-red-500/20">
                  <p className="text-[10px] font-bold uppercase text-red-500 tracking-widest">Failed</p>
                  <p className="text-3xl font-black text-red-400">{seedResults.failed.length}</p>
                </div>
              </div>

              <div className="space-y-4">
                {seedResults.added.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase text-stone-500 tracking-widest">Successfully Added</p>
                    <div className="flex flex-wrap gap-2">
                      {seedResults.added.map(name => (
                        <span key={name} className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded border border-emerald-500/30">{name}</span>
                      ))}
                    </div>
                  </div>
                )}
                {seedResults.skipped.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase text-stone-500 tracking-widest">Skipped (Existing)</p>
                    <div className="flex flex-wrap gap-2">
                      {seedResults.skipped.map(name => (
                        <span key={name} className="px-2 py-1 bg-amber-500/20 text-amber-400 text-[10px] font-bold rounded border border-amber-500/30">{name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmType && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="flex items-center gap-4 text-amber-600">
              <AlertTriangle className="w-8 h-8" />
              <h3 className="text-xl font-bold">Confirm {confirmType === 'soft' ? 'Soft' : 'Full'} Reset</h3>
            </div>
            <p className="text-stone-600">
              {confirmType === 'soft' 
                ? "This will delete all operational data (suppliers, products, uploads, etc.) but keep user accounts and companies. This action cannot be undone."
                : "This will delete EVERYTHING including users, companies, and members. You will be logged out and the project will be completely empty. This action is irreversible."
              }
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmType(null)}
                className="flex-1 py-3 border border-stone-200 rounded-xl font-bold hover:bg-stone-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => executeReset(confirmType)}
                className={cn(
                  "flex-1 py-3 text-white rounded-xl font-bold transition-all",
                  confirmType === 'soft' ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"
                )}
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Logs */}
      {(resetLogs.length > 0 || isResetting) && (
        <div className="bg-stone-900 rounded-3xl p-6 font-mono text-xs text-stone-300 space-y-2 max-h-96 overflow-y-auto shadow-2xl">
          <div className="flex items-center justify-between border-b border-stone-800 pb-4 mb-4">
            <span className="text-stone-500 uppercase tracking-widest font-bold">Reset Execution Logs</span>
            {isResetting && <Loader2 className="w-4 h-4 animate-spin text-stone-500" />}
          </div>
          {resetLogs.map((log, i) => (
            <div key={i} className="py-0.5">{log}</div>
          ))}
          {success && (
            <div className="text-emerald-400 font-bold pt-4">✓ Reset operation completed successfully.</div>
          )}
          {error && (
            <div className="text-red-400 font-bold pt-4">✗ ERROR: {error}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminReset;
