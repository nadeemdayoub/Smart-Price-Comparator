import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp,
  orderBy,
  where
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { COLLECTIONS } from '../services/firestoreCollections';
import { cn } from '../lib/utils';
import { 
  Plus, 
  Trash2, 
  Save, 
  X, 
  Edit2, 
  RefreshCw, 
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';

interface ExchangeRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  updatedAt: any;
}

const ExchangeRates: React.FC = () => {
  const { profile } = useAuth();
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [supplierCurrencies, setSupplierCurrencies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Equation-based state for entry
  const [newRate, setNewRate] = useState({
    amountA: 1,
    currencyA: 'USD',
    amountB: 1,
    currencyB: ''
  });

  const [editRate, setEditRate] = useState({
    amountA: 1,
    currencyA: 'USD',
    amountB: 1,
    currencyB: ''
  });

  // Normalization Logic
  const getNormalizedRate = (eq: { amountA: number, currencyA: string, amountB: number, currencyB: string }) => {
    if (eq.amountA <= 0 || eq.amountB <= 0) return 0;
    if (eq.currencyA === 'USD') return eq.amountB / eq.amountA;
    if (eq.currencyB === 'USD') return eq.amountA / eq.amountB;
    return 0;
  };

  const getForeignCurrency = (eq: { currencyA: string, currencyB: string }) => {
    return eq.currencyA === 'USD' ? eq.currencyB : eq.currencyA;
  };

  const isValidEquation = (eq: { amountA: number, currencyA: string, amountB: number, currencyB: string }) => {
    const hasUSD = eq.currencyA === 'USD' || eq.currencyB === 'USD';
    const differentCurrencies = eq.currencyA !== eq.currencyB;
    const validAmounts = eq.amountA > 0 && eq.amountB > 0;
    const hasForeign = getForeignCurrency(eq).length >= 3;
    return hasUSD && differentCurrencies && validAmounts && hasForeign;
  };

  useEffect(() => {
    if (!profile?.uid) return;

    // 1. Fetch Exchange Rates
    const qRates = query(
      collection(db, COLLECTIONS.EXCHANGE_RATES),
      where('ownerUserId', '==', profile.uid)
    );

    const unsubscribeRates = onSnapshot(qRates, (snapshot) => {
      const ratesData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ExchangeRate));
      // Sort in memory to avoid composite index requirement
      ratesData.sort((a, b) => (a.toCurrency || '').localeCompare(b.toCurrency || ''));
      setRates(ratesData);
      setLoading(false);
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.EXCHANGE_RATES);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to load exchange rates."));
      }
      setLoading(false);
    });

    // 2. Fetch Supplier Currencies
    const qSuppliers = query(
      collection(db, COLLECTIONS.SUPPLIERS),
      where('ownerUserId', '==', profile.uid)
    );

    const unsubscribeSuppliers = onSnapshot(qSuppliers, (snapshot) => {
      const currencies = new Set<string>();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.defaultCurrency) {
          currencies.add(data.defaultCurrency.toUpperCase());
        }
      });
      setSupplierCurrencies(Array.from(currencies).sort());
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, COLLECTIONS.SUPPLIERS);
      } catch (e) {
        console.error("Error fetching supplier currencies:", getFirestoreErrorMessage(e));
      }
    });

    return () => {
      unsubscribeRates();
      unsubscribeSuppliers();
    };
  }, [profile?.uid]);

  // Merge rates and supplier currencies
  const mergedRates = useMemo(() => {
    const rateMap = new Map(rates.map(r => [r.toCurrency, r]));
    const allCodes = new Set([...rates.map(r => r.toCurrency), ...supplierCurrencies]);
    
    // Remove base currency from the list if it's USD
    allCodes.delete('USD');

    return Array.from(allCodes).sort().map(code => {
      const existing = rateMap.get(code);
      if (existing) return existing;
      return {
        id: `missing_${code}`,
        fromCurrency: 'USD',
        toCurrency: code,
        rate: 0, // 0 means not configured
        updatedAt: null
      } as ExchangeRate;
    });
  }, [rates, supplierCurrencies]);

  const handleSaveRate = async (eq: typeof newRate) => {
    if (!profile?.uid) return;
    
    if (!isValidEquation(eq)) {
      setError("Invalid equation. One side must be USD, and both amounts must be greater than 0.");
      return;
    }

    const normalizedRate = getNormalizedRate(eq);
    const foreignCurrency = getForeignCurrency(eq).toUpperCase();
    
    const docId = `${profile.uid}_${foreignCurrency}`;
    try {
      await setDoc(doc(db, COLLECTIONS.EXCHANGE_RATES, docId), {
        ownerUserId: profile.uid,
        fromCurrency: 'USD',
        toCurrency: foreignCurrency,
        rate: normalizedRate,
        updatedAt: serverTimestamp()
      });
      setIsAdding(false);
      setNewRate({ amountA: 1, currencyA: 'USD', amountB: 1, currencyB: '' });
      setError(null);
      setSuccess("Exchange rate added successfully.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, COLLECTIONS.EXCHANGE_RATES);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to save exchange rate."));
      }
    }
  };

  const handleDeleteRate = async (id: string) => {
    if (!profile?.uid) return;
    console.log(`[ExchangeRates] Attempting to delete rate with id: ${id}`);
    try {
      await deleteDoc(doc(db, COLLECTIONS.EXCHANGE_RATES, id));
      console.log(`[ExchangeRates] Successfully deleted rate: ${id}`);
      setSuccess("Exchange rate deleted successfully.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(`[ExchangeRates] Failed to delete rate: ${id}`, err);
      try {
        handleFirestoreError(err, OperationType.DELETE, COLLECTIONS.EXCHANGE_RATES);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to delete exchange rate."));
      }
    }
  };

  const handleStartEdit = (rate: ExchangeRate) => {
    setEditingId(rate.id);
    setEditRate({
      amountA: 1,
      currencyA: 'USD',
      amountB: rate.rate || 1,
      currencyB: rate.toCurrency
    });
  };

  const handleUpdateRate = async (idOrCode: string, eq: typeof editRate) => {
    if (!profile?.uid) return;
    
    if (!isValidEquation(eq)) {
      setError("Invalid equation. One side must be USD, and both amounts must be greater than 0.");
      return;
    }

    const normalizedRate = getNormalizedRate(eq);
    const foreignCurrency = getForeignCurrency(eq).toUpperCase();

    try {
      // If it's a code (from a missing rate), we use handleSaveRate logic
      if (idOrCode.length === 3 || idOrCode.length === 4 || idOrCode.startsWith('missing_')) {
        await handleSaveRate(eq);
      } else {
        const rateRef = doc(db, COLLECTIONS.EXCHANGE_RATES, idOrCode);
        await setDoc(rateRef, {
          rate: normalizedRate,
          toCurrency: foreignCurrency,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
      setEditingId(null);
      setError(null);
      setSuccess("Exchange rate updated successfully.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, COLLECTIONS.EXCHANGE_RATES);
      } catch (e) {
        setError(getFirestoreErrorMessage(e, "Failed to update exchange rate."));
      }
    }
  };

  if (loading) return <div className="py-20 text-center">Loading exchange rates...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Exchange Rates</h2>
          <p className="text-stone-500">Manage currency conversion rates for price normalization.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 bg-stone-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-stone-800 transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Rate
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-3 text-emerald-700">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{success}</p>
          <button onClick={() => setSuccess(null)} className="ml-auto text-emerald-400 hover:text-emerald-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm space-y-2">
          <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
            <Globe className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-stone-400 uppercase tracking-widest">Base Currency</p>
          <p className="text-2xl font-bold">USD</p>
        </div>
        <div className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm space-y-2">
          <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-stone-400 uppercase tracking-widest">Tracked Currencies</p>
          <p className="text-2xl font-bold">{mergedRates.length}</p>
        </div>
        <div className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm space-y-2">
          <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
            <RefreshCw className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-stone-400 uppercase tracking-widest">Last Update</p>
          <p className="text-lg font-bold">Manual</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-stone-50 border-b border-stone-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-stone-400">Currency</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-stone-400">
                Exchange Equation
                <span className="block text-[10px] font-normal lowercase tracking-normal text-stone-400 mt-1">
                  Enter rate as an equation (e.g. 1 USD = 1560 IQD or 3.25 USD = 1 KWD)
                </span>
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-stone-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            <AnimatePresence mode="popLayout">
              {isAdding && (
                <motion.tr 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-stone-50/50"
                >
                  <td className="px-6 py-4">
                    <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">New Rate</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <input 
                          type="number"
                          step="0.0001"
                          className="w-24 px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-sm font-mono"
                          value={newRate.amountA}
                          onChange={(e) => setNewRate({ ...newRate, amountA: Number(e.target.value) })}
                        />
                        <select 
                          className="px-2 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold"
                          value={newRate.currencyA}
                          onChange={(e) => setNewRate({ ...newRate, currencyA: e.target.value })}
                        >
                          <option value="USD">USD</option>
                          {supplierCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                          <option value="">Other...</option>
                        </select>
                        
                        <span className="font-bold text-stone-400">=</span>

                        <input 
                          type="number"
                          step="0.0001"
                          className="w-24 px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-sm font-mono"
                          value={newRate.amountB}
                          onChange={(e) => setNewRate({ ...newRate, amountB: Number(e.target.value) })}
                        />
                        {newRate.currencyB === '' && newRate.currencyA !== '' ? (
                           <input 
                            type="text"
                            placeholder="Code"
                            className="w-20 px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs uppercase font-bold"
                            onChange={(e) => setNewRate({ ...newRate, currencyB: e.target.value.toUpperCase() })}
                           />
                        ) : (
                          <select 
                            className="px-2 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold"
                            value={newRate.currencyB}
                            onChange={(e) => setNewRate({ ...newRate, currencyB: e.target.value })}
                          >
                            <option value="USD">USD</option>
                            {supplierCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                            <option value="">Other...</option>
                          </select>
                        )}
                      </div>

                      {isValidEquation(newRate) && (
                        <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Stored internally as: 1 USD = {getNormalizedRate(newRate).toFixed(6)} {getForeignCurrency(newRate)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button 
                      onClick={() => handleSaveRate(newRate)}
                      disabled={!isValidEquation(newRate)}
                      className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setIsAdding(false)}
                      className="p-2 text-stone-400 hover:bg-stone-100 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </motion.tr>
              )}
            </AnimatePresence>

            {mergedRates.map((rate) => (
              <tr key={rate.id} className={cn(
                "hover:bg-stone-50/50 transition-colors",
                rate.rate === 0 && "bg-amber-50/30"
              )}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-stone-900">{rate.toCurrency}</span>
                    {rate.rate === 0 && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase rounded-full">
                        Missing Rate
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  {editingId === rate.id ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <input 
                          type="number"
                          step="0.0001"
                          className="w-24 px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-sm font-mono"
                          value={editRate.amountA}
                          onChange={(e) => setEditRate({ ...editRate, amountA: Number(e.target.value) })}
                        />
                        <select 
                          className="px-2 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold"
                          value={editRate.currencyA}
                          onChange={(e) => setEditRate({ ...editRate, currencyA: e.target.value })}
                        >
                          <option value="USD">USD</option>
                          {supplierCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                          <option value={rate.toCurrency}>{rate.toCurrency}</option>
                        </select>
                        
                        <span className="font-bold text-stone-400">=</span>

                        <input 
                          type="number"
                          step="0.0001"
                          className="w-24 px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-sm font-mono"
                          value={editRate.amountB}
                          onChange={(e) => setEditRate({ ...editRate, amountB: Number(e.target.value) })}
                        />
                        <select 
                          className="px-2 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold"
                          value={editRate.currencyB}
                          onChange={(e) => setEditRate({ ...editRate, currencyB: e.target.value })}
                        >
                          <option value="USD">USD</option>
                          {supplierCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                          <option value={rate.toCurrency}>{rate.toCurrency}</option>
                        </select>
                      </div>

                      {isValidEquation(editRate) && (
                        <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Stored internally as: 1 USD = {getNormalizedRate(editRate).toFixed(6)} {getForeignCurrency(editRate)}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-stone-900">
                          {rate.rate > 1 ? (
                            `1 USD = ${rate.rate.toFixed(2)} ${rate.toCurrency}`
                          ) : (
                            `${(1 / rate.rate).toFixed(2)} USD = 1 ${rate.toCurrency}`
                          )}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-stone-400 uppercase tracking-tighter">
                        Internal: 1 USD = {rate.rate.toFixed(6)} {rate.toCurrency}
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-right space-x-2">
                  {editingId === rate.id ? (
                    <>
                      <button 
                        onClick={() => handleUpdateRate(rate.id, editRate)}
                        disabled={!isValidEquation(editRate)}
                        className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setEditingId(null)}
                        className="p-2 text-stone-400 hover:bg-stone-100 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={() => handleStartEdit(rate)}
                        className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
                        title="Edit Rate"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {!rate.id.startsWith('missing_') && (
                        <button 
                          onClick={() => handleDeleteRate(rate.id)}
                          className="p-2 text-stone-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete Rate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}

            {mergedRates.length === 0 && !isAdding && (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-stone-400 italic">
                  No exchange rates defined. Add one to start normalizing prices.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-6 bg-stone-900 text-white rounded-3xl space-y-4">
        <div className="flex items-center gap-3">
          <Globe className="w-6 h-6 text-stone-400" />
          <h3 className="text-xl font-bold">How it works</h3>
        </div>
        <div className="space-y-4">
          <p className="text-stone-400 text-sm leading-relaxed">
            Exchange rates are used to normalize supplier prices into your base currency (USD). 
            We store rates as <strong>"How many units of the foreign currency equal 1 USD"</strong>.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-stone-800/50 p-4 rounded-xl space-y-2">
              <p className="text-xs font-bold text-stone-300 uppercase tracking-widest">General Example:</p>
              <p className="text-sm text-stone-100 font-mono">
                If AED Rate = 3.67 (1 USD = 3.67 AED)
                <br />
                Then 1000 AED ÷ 3.67 = 272.48 USD
              </p>
            </div>

            <div className="bg-stone-800/50 p-4 rounded-xl space-y-2 border border-emerald-500/20">
              <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Iraqi Dinar (IQD) Example:</p>
              <p className="text-sm text-stone-100 font-mono">
                If IQD Rate = 1560 (1 USD = 1560 IQD)
                <br />
                Then 1,560,000 IQD ÷ 1560 = 1000 USD
              </p>
              <p className="text-[10px] text-stone-400 italic">
                Supplier list prices in IQD are converted to USD by dividing by this configured rate.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-500 uppercase tracking-widest pt-2">
          <TrendingUp className="w-3 h-3" />
          Formula: Supplier Price ÷ Rate = Base Currency Price (USD)
        </div>
      </div>
    </div>
  );
};

export default ExchangeRates;
