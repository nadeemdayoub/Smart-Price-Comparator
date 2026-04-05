import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { Product, Supplier, SupplierUpload } from '../types';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { COLLECTIONS } from '../services/firestoreCollections';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Package, 
  Truck, 
  Calendar, 
  AlertCircle, 
  ArrowRight,
  Info,
  CheckCircle2,
  XCircle,
  BarChart3,
  Loader2,
  GitCompare,
  Search
} from 'lucide-react';
import { motion } from 'motion/react';
import { formatCurrency, normalizeDate } from '../lib/utils';
import { format } from 'date-fns';
import { matchesSearch, highlightSearchText } from '../lib/search';

interface PriceEntry {
  id: string;
  companyId: string;
  canonicalProductId: string;
  supplierId: string;
  price: number;
  currency: string;
  priceInDefaultCurrency: number;
  uploadId: string;
  effectiveDate: Timestamp;
  createdAt: Timestamp;
}

const Reports: React.FC = () => {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [priceEntries, setPriceEntries] = useState<PriceEntry[]>([]);
  const [finalizedUploads, setFinalizedUploads] = useState<SupplierUpload[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!profile?.uid) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [productsSnap, suppliersSnap, pricesSnap, uploadsSnap] = await Promise.all([
          getDocs(query(collection(db, COLLECTIONS.CANONICAL_PRODUCTS), where('ownerUserId', '==', profile.uid))),
          getDocs(query(collection(db, COLLECTIONS.SUPPLIERS), where('ownerUserId', '==', profile.uid))),
          getDocs(query(collection(db, COLLECTIONS.PRICE_ENTRIES), where('ownerUserId', '==', profile.uid))),
          getDocs(query(
            collection(db, COLLECTIONS.SUPPLIER_UPLOADS), 
            where('ownerUserId', '==', profile.uid),
            where('status', '==', 'finalized')
          ))
        ]);

        setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
        setSuppliers(suppliersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier)));
        setPriceEntries(pricesSnap.docs.map(d => ({ id: d.id, ...d.data() } as PriceEntry)));
        setFinalizedUploads(uploadsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierUpload)));
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, COLLECTIONS.PRICE_ENTRIES);
        } catch (e) {
          setError(getFirestoreErrorMessage(e, "Failed to load report data."));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [profile?.uid]);

  // A. Best Supplier per Product & E. Price Variance
  const productAnalysis = useMemo(() => {
    return products.map(product => {
      const productPrices = priceEntries.filter(p => p.canonicalProductId === product.id);
      if (productPrices.length === 0) return { product, prices: [], best: null, variance: null };

      const sorted = [...productPrices].sort((a, b) => a.priceInDefaultCurrency - b.priceInDefaultCurrency);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const avg = productPrices.reduce((sum, p) => sum + p.priceInDefaultCurrency, 0) / productPrices.length;

      return {
        product,
        prices: productPrices,
        best,
        worst,
        avg,
        variance: worst.priceInDefaultCurrency - best.priceInDefaultCurrency,
        variancePercent: ((worst.priceInDefaultCurrency - best.priceInDefaultCurrency) / best.priceInDefaultCurrency) * 100
      };
    });
  }, [products, priceEntries]);

  // B. Savings Analysis
  const savingsAnalysis = useMemo(() => {
    let totalPotentialSavings = 0;
    productAnalysis.forEach(analysis => {
      if (analysis.best && analysis.prices.length > 1) {
        // Potential savings = (Average Price - Best Price) * 1 (assuming 1 unit for simplicity)
        // Or more realistically: (Max Price - Best Price)
        totalPotentialSavings += (analysis.avg - analysis.best.priceInDefaultCurrency);
      }
    });
    return { totalPotentialSavings };
  }, [productAnalysis]);

  // C. Supplier Coverage
  const supplierCoverage = useMemo(() => {
    return suppliers.map(supplier => {
      const coveredProducts = new Set(priceEntries.filter(p => p.supplierId === supplier.id).map(p => p.canonicalProductId));
      const coveragePercent = products.length > 0 ? (coveredProducts.size / products.length) * 100 : 0;
      return {
        supplier,
        count: coveredProducts.size,
        percent: coveragePercent
      };
    }).sort((a, b) => b.percent - a.percent);
  }, [suppliers, products, priceEntries]);

  // D. Missing Price Data
  const missingPrices = useMemo(() => {
    return productAnalysis.filter(a => a.prices.length === 0);
  }, [productAnalysis]);

  const filteredProductAnalysis = useMemo(() => {
    if (!searchQuery.trim()) return productAnalysis;
    return productAnalysis.filter(a => 
      matchesSearch(a.product.name, searchQuery) ||
      matchesSearch(a.product.brand || '', searchQuery) ||
      matchesSearch(a.product.category || '', searchQuery)
    );
  }, [productAnalysis, searchQuery]);

  const filteredMissingPrices = useMemo(() => {
    if (!searchQuery.trim()) return missingPrices;
    return missingPrices.filter(a => 
      matchesSearch(a.product.name, searchQuery) ||
      matchesSearch(a.product.brand || '', searchQuery)
    );
  }, [missingPrices, searchQuery]);

  // F. Market Trend (Grouped by month/date)
  const marketTrendData = useMemo(() => {
    const grouped: Record<string, { date: Date, total: number, count: number }> = {};
    
    priceEntries.forEach(p => {
      const date = normalizeDate(p.effectiveDate) || normalizeDate(p.createdAt);
      if (!date) return;
      const key = format(date, 'MMM yyyy');
      if (!grouped[key]) {
        grouped[key] = { date, total: 0, count: 0 };
      }
      grouped[key].total += p.priceInDefaultCurrency;
      grouped[key].count += 1;
    });

    return Object.entries(grouped)
      .map(([name, data]) => ({
        name,
        avgPrice: data.total / data.count,
        timestamp: data.date.getTime()
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [priceEntries]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 text-stone-300 animate-spin" />
        <p className="text-stone-400 font-bold animate-pulse">Analyzing price data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Price Intelligence Reports</h2>
          <p className="text-stone-500">Actionable insights from your finalized supplier snapshots</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900/5 transition-all"
          />
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4">
            <DollarSign className="w-5 h-5" />
          </div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Potential Savings</p>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(savingsAnalysis.totalPotentialSavings)}</p>
          <p className="text-[10px] text-stone-400 mt-2 italic">Based on best vs average pricing</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
          <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4">
            <Package className="w-5 h-5" />
          </div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Catalog Coverage</p>
          <p className="text-2xl font-bold text-blue-600">
            {Math.round(((products.length - missingPrices.length) / products.length) * 100)}%
          </p>
          <p className="text-[10px] text-stone-400 mt-2 italic">{products.length - missingPrices.length} of {products.length} products priced</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
          <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center mb-4">
            <Truck className="w-5 h-5" />
          </div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Active Suppliers</p>
          <p className="text-2xl font-bold text-amber-600">{suppliers.length}</p>
          <p className="text-[10px] text-stone-400 mt-2 italic">With finalized snapshots</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
          <div className="w-10 h-10 bg-stone-900 text-white rounded-xl flex items-center justify-center mb-4">
            <BarChart3 className="w-5 h-5" />
          </div>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Total Snapshots</p>
          <p className="text-2xl font-bold text-stone-900">{finalizedUploads.length}</p>
          <p className="text-[10px] text-stone-400 mt-2 italic">Historical price lists</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Market Trend Chart */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <h3 className="font-bold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-stone-900" />
              Average Market Price Trend
            </h3>
          </div>
          <div className="h-72 w-full">
            {marketTrendData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={marketTrendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#888' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#888' }} 
                    tickFormatter={(v) => `$${v}`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [formatCurrency(value), 'Avg Price']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="avgPrice" 
                    stroke="#1c1917" 
                    strokeWidth={4} 
                    dot={{ r: 6, fill: '#1c1917', strokeWidth: 2, stroke: '#fff' }} 
                    activeDot={{ r: 8 }} 
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-stone-400 italic">
                Not enough historical data to show trends.
              </div>
            )}
          </div>
        </div>

        {/* Supplier Coverage List */}
        <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
          <h3 className="font-bold flex items-center gap-2 mb-6">
            <Truck className="w-5 h-5 text-stone-900" />
            Supplier Coverage
          </h3>
          <div className="space-y-6">
            {supplierCoverage.map((item) => (
              <div key={item.supplier.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-stone-900">{item.supplier.name}</span>
                  <span className="text-xs font-black text-stone-400">{Math.round(item.percent)}%</span>
                </div>
                <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${item.percent}%` }}
                    className="bg-stone-900 h-full rounded-full"
                  />
                </div>
                <p className="text-[10px] text-stone-400 uppercase tracking-widest">
                  {item.count} of {products.length} products
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Best Supplier per Product Table */}
        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-stone-100">
            <h3 className="font-bold">Best Supplier per Product</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-stone-50 text-stone-500 text-[10px] font-bold uppercase tracking-widest">
                  <th className="px-6 py-4">Product</th>
                  <th className="px-6 py-4">Best Supplier</th>
                  <th className="px-6 py-4">Best Price</th>
                  <th className="px-6 py-4 text-right">Potential Saving</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredProductAnalysis.filter(a => a.best).slice(0, 10).map((analysis, i) => (
                  <tr key={i} className="hover:bg-stone-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-stone-900 truncate max-w-[150px]" title={analysis.product.name}>
                        {highlightSearchText(analysis.product.name, searchQuery)}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs text-stone-600">
                        <Truck className="w-3 h-3" />
                        {suppliers.find(s => s.id === analysis.best?.supplierId)?.name || 'Unknown'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-bold text-emerald-600">
                        {formatCurrency(analysis.best?.price || 0, analysis.best?.currency)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {analysis.prices.length > 1 ? (
                        <span className="text-xs font-bold text-emerald-600">
                          -{formatCurrency(analysis.avg - (analysis.best?.priceInDefaultCurrency || 0))}
                        </span>
                      ) : (
                        <span className="text-[10px] text-stone-400 italic">Single quote</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Missing Price Data & Price Variance */}
        <div className="space-y-8">
          <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <h3 className="font-bold text-red-600 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Missing Price Data
              </h3>
              <span className="px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded uppercase">
                {missingPrices.length} Products
              </span>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              <table className="w-full text-left">
                <tbody className="divide-y divide-stone-100">
                  {filteredMissingPrices.length === 0 ? (
                    <tr>
                      <td className="px-6 py-8 text-center text-stone-400 italic text-sm">
                        {searchQuery ? "No missing prices match your search." : "All products have at least one price."}
                      </td>
                    </tr>
                  ) : (
                    filteredMissingPrices.map((analysis, i) => (
                      <tr key={i}>
                        <td className="px-6 py-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-stone-600">
                              {highlightSearchText(analysis.product.name, searchQuery)}
                            </span>
                            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">No Quotes</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-stone-100">
              <h3 className="font-bold flex items-center gap-2">
                <GitCompare className="w-5 h-5 text-stone-900" />
                Highest Price Variance
              </h3>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-stone-50 text-stone-500 text-[10px] font-bold uppercase tracking-widest">
                    <th className="px-6 py-3">Product</th>
                    <th className="px-6 py-3">Min</th>
                    <th className="px-6 py-3">Max</th>
                    <th className="px-6 py-3 text-right">Diff %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredProductAnalysis
                    .filter(a => a.prices.length > 1)
                    .sort((a, b) => (b.variancePercent || 0) - (a.variancePercent || 0))
                    .slice(0, 5)
                    .map((analysis, i) => (
                      <tr key={i} className="hover:bg-stone-50 transition-colors">
                        <td className="px-6 py-3">
                          <span className="text-xs font-bold text-stone-900">
                            {highlightSearchText(analysis.product.name, searchQuery)}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-xs text-emerald-600 font-bold">
                          {formatCurrency(analysis.best?.priceInDefaultCurrency || 0)}
                        </td>
                        <td className="px-6 py-3 text-xs text-red-600 font-bold">
                          {formatCurrency(analysis.worst?.priceInDefaultCurrency || 0)}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-xs font-black text-amber-600">
                            +{Math.round(analysis.variancePercent || 0)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
