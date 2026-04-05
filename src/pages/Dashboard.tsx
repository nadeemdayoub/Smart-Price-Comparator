import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  Legend,
  Cell
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  Package, 
  Database, 
  Users, 
  Percent,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { COLLECTIONS } from '../services/firestoreCollections';
import { loadCanonicalProducts } from '../services/matchingDataService';
import { analyzeProductPrices, PriceAnalytics, SupplierPriceRank } from '../services/priceIntelligenceService';
import { handleFirestoreError, OperationType, getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { CanonicalProduct, Supplier } from '../types';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface DashboardData {
  products: CanonicalProduct[];
  suppliers: Record<string, Supplier>;
  analytics: Record<string, PriceAnalytics>;
  loading: boolean;
  error: string | null;
}

const Dashboard: React.FC = () => {
  const { profile } = useAuth();
  const [data, setData] = useState<DashboardData>({
    products: [],
    suppliers: {},
    analytics: {},
    loading: true,
    error: null
  });

  useEffect(() => {
    if (!profile?.uid) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    const fetchDashboardData = async () => {
      try {
        setData(prev => ({ ...prev, loading: true, error: null }));

        // 1. Load Products and Suppliers in parallel
        const supplierQuery = query(
          collection(db, COLLECTIONS.SUPPLIERS), 
          where('ownerUserId', '==', profile.uid)
        );

        const [products, suppliersSnap] = await Promise.all([
          loadCanonicalProducts(profile.uid),
          getDocs(supplierQuery)
        ]);

        const suppliersMap: Record<string, Supplier> = {};
        suppliersSnap.docs.forEach(doc => {
          suppliersMap[doc.id] = { id: doc.id, ...doc.data() } as Supplier;
        });

        // 2. Load Analytics for each product in parallel - LIMIT TO TOP 50
        const analysisSubset = products.slice(0, 50);
        const analyticsPromises = analysisSubset.map(product => 
          analyzeProductPrices({ ownerUserId: profile.uid, productId: product.id })
            .then(res => ({ productId: product.id, res }))
        );

        const analyticsResults = await Promise.all(analyticsPromises);
        const analyticsMap: Record<string, PriceAnalytics> = {};
        analyticsResults.forEach(({ productId, res }) => {
          analyticsMap[productId] = res;
        });

        setData({
          products,
          suppliers: suppliersMap,
          analytics: analyticsMap,
          loading: false,
          error: null
        });
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, 'dashboard_data');
        } catch (e) {
          setData(prev => ({ 
            ...prev, 
            loading: false, 
            error: getFirestoreErrorMessage(e, 'Failed to load dashboard intelligence.')
          }));
        }
      }
    };

    fetchDashboardData();
  }, [profile?.uid]);

  // SECTION 1: Global Stats
  const stats = useMemo(() => {
    const totalProducts = data.products.length;
    let totalSamples = 0;
    const uniqueSuppliers = new Set<string>();
    let totalChangePercent = 0;
    let changeCount = 0;

    Object.values(data.analytics).forEach((a: PriceAnalytics) => {
      totalSamples += a.totalSamples;
      a.supplierRanking.forEach((r: SupplierPriceRank) => uniqueSuppliers.add(r.supplierId));
      if (a.lastPriceChange) {
        totalChangePercent += a.lastPriceChange.percent;
        changeCount++;
      }
    });

    return {
      totalProducts,
      totalSamples,
      suppliersCompared: uniqueSuppliers.size,
      avgPriceChange: changeCount > 0 ? totalChangePercent / changeCount : 0
    };
  }, [data.analytics, data.products]);

  // SECTION 2: Best Supplier Ranking
  const bestSuppliers = useMemo(() => {
    return data.products.map(p => {
      const a = data.analytics[p.id];
      if (!a || !a.bestPrice) return null;

      const diffPercent = a.averagePrice > 0 
        ? ((a.bestPrice.price - a.averagePrice) / a.averagePrice) * 100 
        : 0;

      return {
        productId: p.id,
        productName: p.canonicalName,
        bestSupplier: data.suppliers[a.bestPrice.supplierId]?.name || 'Unknown',
        bestPrice: a.bestPrice.price,
        avgPrice: a.averagePrice,
        diffPercent
      };
    }).filter(Boolean).sort((a, b) => (a?.diffPercent || 0) - (b?.diffPercent || 0));
  }, [data.analytics, data.products, data.suppliers]);

  // SECTION 3: Recent Price Changes
  const recentChanges = useMemo(() => {
    return data.products.map(p => {
      const a = data.analytics[p.id];
      if (!a || !a.lastPriceChange || !a.bestPrice) return null;

      return {
        productName: p.canonicalName,
        supplierName: data.suppliers[a.bestPrice.supplierId]?.name || 'Unknown',
        oldPrice: a.lastPriceChange.oldPrice,
        newPrice: a.lastPriceChange.newPrice,
        percent: a.lastPriceChange.percent,
        date: a.lastPriceChange.effectiveDate
      };
    }).filter(Boolean).sort((a, b) => (b?.date.getTime() || 0) - (a?.date.getTime() || 0));
  }, [data.analytics, data.products, data.suppliers]);

  // SECTION 4: Supplier Leaderboard
  const supplierLeaderboard = useMemo(() => {
    const supplierStats: Record<string, { totalAvg: number; count: number; samples: number }> = {};

    Object.values(data.analytics).forEach((a: PriceAnalytics) => {
      a.supplierRanking.forEach((r: SupplierPriceRank) => {
        if (!supplierStats[r.supplierId]) {
          supplierStats[r.supplierId] = { totalAvg: 0, count: 0, samples: 0 };
        }
        supplierStats[r.supplierId].totalAvg += r.avgPrice;
        supplierStats[r.supplierId].count += 1;
        supplierStats[r.supplierId].samples += r.sampleCount;
      });
    });

    return Object.entries(supplierStats).map(([id, stats]) => ({
      id,
      name: data.suppliers[id]?.name || 'Unknown',
      avgPrice: stats.totalAvg / stats.count,
      samples: stats.samples
    })).sort((a, b) => a.avgPrice - b.avgPrice);
  }, [data.analytics, data.suppliers]);

  // SECTION 5: Charts Data
  const priceDistributionData = useMemo(() => {
    return supplierLeaderboard.slice(0, 10).map(s => ({
      name: s.name,
      avgPrice: s.avgPrice
    }));
  }, [supplierLeaderboard]);

  const timelineData = useMemo(() => {
    // Flatten all price changes and group by date
    const changes: Record<string, { date: string; total: number; count: number }> = {};
    
    recentChanges.forEach(c => {
      if (!c) return;
      const dateStr = c.date.toLocaleDateString();
      if (!changes[dateStr]) {
        changes[dateStr] = { date: dateStr, total: 0, count: 0 };
      }
      changes[dateStr].total += c.percent;
      changes[dateStr].count += 1;
    });

    return Object.values(changes).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [recentChanges]);

  if (data.loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Loader2 className="w-12 h-12 text-stone-900 animate-spin" />
        <p className="text-stone-500 font-medium">Analyzing market intelligence...</p>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center px-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-600" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold">Something went wrong</h3>
          <p className="text-stone-500 max-w-md">{data.error}</p>
        </div>
      </div>
    );
  }

  if (data.products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 text-center px-4">
        <div className="w-20 h-20 bg-stone-100 rounded-3xl flex items-center justify-center">
          <Package className="w-10 h-10 text-stone-400" />
        </div>
        <div className="space-y-2">
          <h3 className="text-2xl font-bold">No Products Found</h3>
          <p className="text-stone-500 max-w-md">
            Upload your first quotation to start building your price intelligence dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 py-8 px-4">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-heading-section">Price Intelligence</h1>
          <p className="text-stone-500 mt-1">Real-time market analysis and supplier competitiveness.</p>
        </div>
        <div className="text-sm font-medium text-stone-400 bg-stone-100 px-3 py-1 rounded-full">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </header>

      {/* SECTION 1: Global Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Products', value: stats.totalProducts, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Price Samples', value: stats.totalSamples, icon: Database, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Suppliers Compared', value: stats.suppliersCompared, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Avg Price Change', value: `${(stats.avgPriceChange || 0).toFixed(1)}%`, icon: Percent, color: stats.avgPriceChange >= 0 ? 'text-red-600' : 'text-emerald-600', bg: stats.avgPriceChange >= 0 ? 'bg-red-50' : 'bg-emerald-50' },
        ].map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div className={cn("p-3 rounded-xl", stat.bg)}>
                <stat.icon className={cn("w-6 h-6", stat.color)} />
              </div>
              {stat.label === 'Avg Price Change' && (
                <div className={cn("flex items-center text-xs font-semibold", stat.color)}>
                  {stats.avgPriceChange >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                </div>
              )}
            </div>
            <div className="mt-4">
              <p className="text-label">{stat.label}</p>
              <p className="text-2xl font-bold mt-1 font-variant-numeric tabular-nums">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* SECTION 2: Best Supplier Ranking */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-heading-card">Best Supplier Opportunities</h3>
            <span className="text-label">Top Savings</span>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-stone-50 border-b border-stone-100">
                  <tr>
                    <th className="px-6 py-4 text-label">Product</th>
                    <th className="px-6 py-4 text-label">Best Supplier</th>
                    <th className="px-6 py-4 text-label">Best Price</th>
                    <th className="px-6 py-4 text-label">Market Avg</th>
                    <th className="px-6 py-4 text-label">Diff %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {bestSuppliers.slice(0, 8).map((item, i) => (
                    <tr key={item?.productId} className="hover:bg-stone-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-stone-900">{item?.productName}</td>
                      <td className="px-6 py-4 text-stone-600">{item?.bestSupplier}</td>
                      <td className="px-6 py-4 font-bold text-stone-900 font-variant-numeric tabular-nums">${item?.bestPrice.toFixed(2)}</td>
                      <td className="px-6 py-4 text-stone-500 font-variant-numeric tabular-nums">${item?.avgPrice.toFixed(2)}</td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-xs font-semibold",
                          (item?.diffPercent || 0) < 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                        )}>
                          {(item?.diffPercent || 0).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* SECTION 4: Supplier Leaderboard */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-heading-card">Supplier Leaderboard</h3>
            <span className="text-label">Competitiveness</span>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-6">
            {supplierLeaderboard.slice(0, 5).map((supplier, i) => (
              <div key={supplier.id} className="flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center text-xs font-semibold text-stone-500 group-hover:bg-amber-500 group-hover:text-white transition-colors">
                    {i + 1}
                  </div>
                  <div>
                    <p className="font-semibold text-stone-900">{supplier.name}</p>
                    <p className="text-xs text-stone-500">{supplier.samples} samples collected</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-stone-900 font-variant-numeric tabular-nums">${supplier.avgPrice.toFixed(2)}</p>
                  <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Avg Price</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 5: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm space-y-6">
          <div>
            <h3 className="text-heading-card">Price Distribution</h3>
            <p className="text-sm text-stone-500 leading-relaxed">Average price comparison across top suppliers.</p>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priceDistributionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#78716c', fontSize: 12 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#78716c', fontSize: 12 }}
                />
                <Tooltip 
                  cursor={{ fill: '#f5f5f4' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="avgPrice" radius={[6, 6, 0, 0]}>
                  {priceDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? '#1c1917' : '#d6d3d1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-2xl border border-stone-200 shadow-sm space-y-6">
          <div>
            <h3 className="text-heading-card">Price Change Timeline</h3>
            <p className="text-sm text-stone-500 leading-relaxed">Aggregated market price fluctuations over time.</p>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#78716c', fontSize: 12 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#78716c', fontSize: 12 }}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="total" 
                  stroke="#1c1917" 
                  strokeWidth={3} 
                  dot={{ r: 4, fill: '#1c1917', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* SECTION 3: Recent Price Changes */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-heading-card">Recent Market Movements</h3>
          <span className="text-label">Price Alerts</span>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 border-b border-stone-100">
                <tr>
                  <th className="px-6 py-4 font-bold text-stone-700">Product</th>
                  <th className="px-6 py-4 font-bold text-stone-700">Supplier</th>
                  <th className="px-6 py-4 font-bold text-stone-700">Old Price</th>
                  <th className="px-6 py-4 font-bold text-stone-700">New Price</th>
                  <th className="px-6 py-4 font-bold text-stone-700">Change %</th>
                  <th className="px-6 py-4 font-bold text-stone-700">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {recentChanges.slice(0, 10).map((change, i) => (
                  <tr key={i} className="hover:bg-stone-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-stone-900">{change?.productName}</td>
                      <td className="px-6 py-4 text-stone-600">{change?.supplierName}</td>
                      <td className="px-6 py-4 text-stone-400 font-variant-numeric tabular-nums">${change?.oldPrice.toFixed(2)}</td>
                      <td className="px-6 py-4 font-bold text-stone-900 font-variant-numeric tabular-nums">${change?.newPrice.toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <div className={cn(
                        "flex items-center gap-1 font-bold",
                        (change?.percent || 0) > 0 ? "text-red-600" : "text-emerald-600"
                      )}>
                        {(change?.percent || 0) > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {Math.abs(change?.percent || 0).toFixed(1)}%
                      </div>
                    </td>
                    <td className="px-6 py-4 text-stone-500">{change?.date.toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
