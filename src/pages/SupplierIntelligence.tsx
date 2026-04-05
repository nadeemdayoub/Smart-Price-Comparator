import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { PriceEntry, Supplier, CanonicalProduct } from '../types';
import { COLLECTIONS } from '../services/firestoreCollections';
import { 
  TrendingUp, 
  Award, 
  BarChart3, 
  PieChart as PieChartIcon, 
  AlertTriangle, 
  Search, 
  Filter, 
  ArrowUpRight, 
  ArrowDownRight, 
  Target,
  Layers,
  DollarSign,
  Percent,
  CheckCircle2
} from 'lucide-react';
import { motion } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from 'recharts';
import { cn } from '../lib/utils';

interface SupplierStats {
  supplierId: string;
  supplierName: string;
  bestPriceCount: number;
  bestPriceRate: number;
  coverageCount: number;
  coverageRate: number;
  avgPrice: number;
  score: number;
}

interface ProductVariance {
  productId: string;
  productName: string;
  minPrice: number;
  maxPrice: number;
  diff: number;
  diffPercent: number;
}

interface CoverageGap {
  productId: string;
  productName: string;
  missingSuppliers: string[];
}

const SupplierIntelligence: React.FC = () => {
  const { profile } = useAuth();
  const [priceEntries, setPriceEntries] = useState<PriceEntry[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<CanonicalProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.uid) return;

    const qPrices = query(
      collection(db, COLLECTIONS.PRICE_ENTRIES),
      where('ownerUserId', '==', profile.uid),
      where('status', '==', 'finalized')
    );

    const qSuppliers = query(
      collection(db, COLLECTIONS.SUPPLIERS),
      where('ownerUserId', '==', profile.uid)
    );

    const qProducts = query(
      collection(db, COLLECTIONS.CANONICAL_PRODUCTS),
      where('ownerUserId', '==', profile.uid)
    );

    const unsubPrices = onSnapshot(qPrices, (snap) => {
      const entries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PriceEntry));
      // Sort in memory to avoid index requirement
      entries.sort((a, b) => {
        const dateA = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : new Date(a.createdAt as any).getTime();
        const dateB = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : new Date(b.createdAt as any).getTime();
        return dateB - dateA;
      });
      setPriceEntries(entries);
    });

    const unsubSuppliers = onSnapshot(qSuppliers, (snap) => {
      setSuppliers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier)));
    });

    const unsubProducts = onSnapshot(qProducts, (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanonicalProduct)));
      setLoading(false);
    });

    return () => {
      unsubPrices();
      unsubSuppliers();
      unsubProducts();
    };
  }, [profile?.uid]);

  // Data Aggregation Logic
  const analytics = useMemo(() => {
    if (priceEntries.length === 0 || suppliers.length === 0) return null;

    // Group by product to find best prices
    const productGroups: Record<string, PriceEntry[]> = {};
    priceEntries.forEach(entry => {
      if (!productGroups[entry.canonicalProductId]) {
        productGroups[entry.canonicalProductId] = [];
      }
      productGroups[entry.canonicalProductId].push(entry);
    });

    const totalProductsInComparison = Object.keys(productGroups).length;
    
    // Calculate best prices and variances
    const bestPrices: Record<string, number> = {};
    const variances: ProductVariance[] = [];
    const gaps: CoverageGap[] = [];

    Object.entries(productGroups).forEach(([productId, entries]) => {
      const prices = entries.map(e => e.priceInDefaultCurrency);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      bestPrices[productId] = min;

      const product = products.find(p => p.id === productId);
      const productName = product?.canonicalName || 'Unknown Product';

      if (entries.length > 1) {
        variances.push({
          productId,
          productName,
          minPrice: min,
          maxPrice: max,
          diff: max - min,
          diffPercent: ((max - min) / min) * 100
        });
      }

      const supplierIdsWithPrice = new Set(entries.map(e => e.supplierId));
      const missing = suppliers
        .filter(s => !supplierIdsWithPrice.has(s.id))
        .map(s => s.name);

      if (missing.length > 0) {
        gaps.push({
          productId,
          productName,
          missingSuppliers: missing
        });
      }
    });

    // Calculate supplier stats
    const supplierStats: Record<string, {
      bestPriceCount: number;
      totalPrices: number;
      sumPrice: number;
    }> = {};

    suppliers.forEach(s => {
      supplierStats[s.id] = { bestPriceCount: 0, totalPrices: 0, sumPrice: 0 };
    });

    priceEntries.forEach(entry => {
      const stats = supplierStats[entry.supplierId];
      if (stats) {
        stats.totalPrices++;
        stats.sumPrice += entry.priceInDefaultCurrency;
        if (entry.priceInDefaultCurrency === bestPrices[entry.canonicalProductId]) {
          stats.bestPriceCount++;
        }
      }
    });

    // Score Calculation Logic
    const statsList: SupplierStats[] = suppliers.map(s => {
      const stats = supplierStats[s.id];
      const avgPrice = stats.totalPrices > 0 ? stats.sumPrice / stats.totalPrices : 0;
      const bestPriceRate = totalProductsInComparison > 0 ? (stats.bestPriceCount / totalProductsInComparison) * 100 : 0;
      const coverageRate = totalProductsInComparison > 0 ? (stats.totalPrices / totalProductsInComparison) * 100 : 0;

      // Score formula: (best price wins * weight) + (coverage * weight) - (avg price deviation)
      // Weights: bestPriceRate (0.6), coverageRate (0.4)
      // Deviation: relative to global average
      const globalAvg = priceEntries.reduce((acc, curr) => acc + curr.priceInDefaultCurrency, 0) / priceEntries.length;
      const deviation = globalAvg > 0 ? ((avgPrice - globalAvg) / globalAvg) * 100 : 0;
      
      const score = (bestPriceRate * 0.6) + (coverageRate * 0.4) - (deviation * 0.1);

      return {
        supplierId: s.id,
        supplierName: s.name,
        bestPriceCount: stats.bestPriceCount,
        bestPriceRate,
        coverageCount: stats.totalPrices,
        coverageRate,
        avgPrice,
        score: Math.max(0, score)
      };
    }).sort((a, b) => b.score - a.score);

    // Savings Insight
    let totalPotentialSavings = 0;
    let totalCurrentCost = 0;

    Object.entries(productGroups).forEach(([productId, entries]) => {
      const min = bestPrices[productId];
      const avg = entries.reduce((acc, curr) => acc + curr.priceInDefaultCurrency, 0) / entries.length;
      totalPotentialSavings += (avg - min);
      totalCurrentCost += avg;
    });

    const avgSavingPercent = totalCurrentCost > 0 ? (totalPotentialSavings / totalCurrentCost) * 100 : 0;

    return {
      statsList,
      topSupplier: statsList[0],
      variances: variances.sort((a, b) => b.diffPercent - a.diffPercent).slice(0, 10),
      gaps: gaps.slice(0, 10),
      savings: {
        total: totalPotentialSavings,
        percent: avgSavingPercent
      }
    };
  }, [priceEntries, suppliers, products]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900"></div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="p-8 text-center">
        <AlertTriangle className="w-12 h-12 text-stone-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-stone-900">No Intelligence Data Yet</h2>
        <p className="text-stone-500">Complete some supplier comparisons and finalize reviews to see insights.</p>
      </div>
    );
  }

  const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-900">Supplier Intelligence</h1>
          <p className="text-stone-500">Data-driven insights into supplier performance and competitiveness.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-100">
          <TrendingUp className="w-4 h-4" />
          <span className="text-sm font-bold">Live Analysis</span>
        </div>
      </div>

      {/* Top Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Top Supplier Card */}
        {analytics.topSupplier && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-stone-900 text-white p-8 rounded-[2.5rem] relative overflow-hidden shadow-2xl"
          >
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                  <Award className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white/50 uppercase tracking-widest">Top Performer</p>
                  <h3 className="text-xl font-bold">{analytics.topSupplier.supplierName}</h3>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase mb-1">Win Rate</p>
                  <p className="text-2xl font-bold text-emerald-400">{analytics.topSupplier.bestPriceRate.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase mb-1">Coverage</p>
                  <p className="text-2xl font-bold">{analytics.topSupplier.coverageRate.toFixed(1)}%</p>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-white/10 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase mb-1">Avg Price (USD)</p>
                  <p className="text-lg font-bold">${analytics.topSupplier.avgPrice.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-white/40 uppercase mb-1">Score</p>
                  <p className="text-lg font-bold text-emerald-400">{analytics.topSupplier.score.toFixed(1)}</p>
                </div>
              </div>
            </div>
            <div className="absolute -right-8 -bottom-8 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl" />
          </motion.div>
        )}

        {/* Savings Insight Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                <Target className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">Potential Savings</p>
                <h3 className="text-xl font-bold text-stone-900">Optimization Goal</h3>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">Total Potential Savings</p>
                <p className="text-4xl font-bold text-stone-900">${(analytics.savings.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold flex items-center gap-1">
                  <ArrowDownRight className="w-3 h-3" />
                  {analytics.savings.percent.toFixed(1)}% Avg Saving
                </div>
                <span className="text-xs text-stone-400">vs. average market price</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Quick Charts Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm"
        >
          <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4">Market Share (Wins)</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics.statsList.map(s => ({ name: s.supplierName, value: s.bestPriceCount }))}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {analytics.statsList.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Ranking Table */}
      <div className="bg-white rounded-[2.5rem] border border-stone-200 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-stone-100 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-stone-900">Supplier Ranking</h3>
            <p className="text-sm text-stone-500">Ranked by price competitiveness and coverage.</p>
          </div>
          <BarChart3 className="w-6 h-6 text-stone-300" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50/50">
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Supplier</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400 text-center">Best Price Count</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400 text-center">Best Price %</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400 text-center">Coverage %</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400 text-center">Avg Price (USD)</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {analytics.statsList.map((stat, idx) => (
                <tr key={stat.supplierId} className="hover:bg-stone-50/50 transition-colors">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-xs font-bold text-stone-500">
                        {idx + 1}
                      </div>
                      <span className="font-bold text-stone-900">{stat.supplierName}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center font-medium text-stone-600">{stat.bestPriceCount}</td>
                  <td className="px-8 py-6 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-bold text-stone-900">{stat.bestPriceRate.toFixed(1)}%</span>
                      <div className="w-20 h-1 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${stat.bestPriceRate}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-bold text-stone-900">{stat.coverageRate.toFixed(1)}%</span>
                      <div className="w-20 h-1 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${stat.coverageRate}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center font-mono text-stone-600">${stat.avgPrice.toFixed(2)}</td>
                  <td className="px-8 py-6 text-right">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-sm font-bold",
                      idx === 0 ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-600"
                    )}>
                      {stat.score.toFixed(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Price Variance Insights */}
        <div className="bg-white rounded-[2.5rem] border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-stone-100 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-stone-900">Price Variance</h3>
              <p className="text-sm text-stone-500">Products with highest price difference across suppliers.</p>
            </div>
            <Layers className="w-6 h-6 text-stone-300" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-stone-50/50">
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400">Product</th>
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400 text-center">Lowest</th>
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400 text-center">Highest</th>
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-stone-400 text-right">Diff %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {analytics.variances.map(v => (
                  <tr key={v.productId} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-8 py-4">
                      <span className="text-sm font-bold text-stone-900 line-clamp-1">{v.productName}</span>
                    </td>
                    <td className="px-8 py-4 text-center font-mono text-emerald-600 text-sm">${v.minPrice.toFixed(2)}</td>
                    <td className="px-8 py-4 text-center font-mono text-red-600 text-sm">${v.maxPrice.toFixed(2)}</td>
                    <td className="px-8 py-4 text-right">
                      <span className="text-xs font-bold text-stone-900">+{v.diffPercent.toFixed(1)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Coverage Gaps */}
        <div className="bg-white rounded-[2.5rem] border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-stone-100 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-stone-900">Coverage Gaps</h3>
              <p className="text-sm text-stone-500">Products missing prices from some suppliers.</p>
            </div>
            <AlertTriangle className="w-6 h-6 text-stone-300" />
          </div>
          <div className="p-8 space-y-4">
            {analytics.gaps.map(gap => (
              <div key={gap.productId} className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-stone-900">{gap.productName}</span>
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold uppercase">Missing {gap.missingSuppliers.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {gap.missingSuppliers.map(s => (
                    <span key={s} className="text-[10px] font-medium text-stone-400 bg-white px-2 py-1 rounded border border-stone-100">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {analytics.gaps.length === 0 && (
              <div className="text-center py-12">
                <CheckCircle2 className="w-12 h-12 text-emerald-200 mx-auto mb-4" />
                <p className="text-stone-400 font-medium">Full coverage across all products!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierIntelligence;
