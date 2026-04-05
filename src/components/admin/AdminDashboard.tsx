import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Users, Upload, Camera, BarChart3, Clock, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { SystemStats } from '../../types';
import { adminService } from '../../services/adminService';
import { useAuth } from '../../AuthContext';

interface AdminDashboardProps {
  stats: SystemStats | null;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ stats }) => {
  const { profile } = useAuth();
  const [isClearing, setIsClearing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleClearData = async () => {
    if (!profile?.uid) return;
    setIsClearing(true);
    try {
      await adminService.clearAllQuotationData(profile.uid);
      alert('All quotation and supplier data has been cleared successfully.');
      setShowConfirm(false);
    } catch (error) {
      console.error('Failed to clear data:', error);
      alert('Failed to clear data. Check console for details.');
    } finally {
      setIsClearing(false);
    }
  };

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers || 0, icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Pending Users', value: stats?.pendingUsers || 0, icon: Clock, color: 'bg-amber-50 text-amber-600' },
    { label: 'Total Uploads', value: stats?.totalUploads || 0, icon: Upload, color: 'bg-indigo-50 text-indigo-600' },
    { label: 'Total Snapshots', value: stats?.totalSnapshots || 0, icon: Camera, color: 'bg-purple-50 text-purple-600' },
    { label: 'Total Comparisons', value: stats?.totalComparisons || 0, icon: BarChart3, color: 'bg-rose-50 text-rose-600' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Admin Dashboard</h1>
        <p className="text-slate-500">Overview of system-wide metrics and activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {statCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className={`p-4 rounded-xl ${card.color} group-hover:scale-110 transition-transform`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-500">{card.label}</span>
                  <span className="text-2xl font-bold text-slate-900">{card.value.toLocaleString()}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Recent Activity or other widgets can be added here */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-4">System Health</h2>
          <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg w-fit">
            <div className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
            <span className="text-sm font-medium">All systems operational</span>
          </div>
        </div>

        <div className="bg-white p-8 rounded-2xl border border-red-100 shadow-sm bg-red-50/30">
          <div className="flex items-center gap-3 mb-4 text-red-600">
            <AlertTriangle className="w-6 h-6" />
            <h2 className="text-xl font-bold">Danger Zone</h2>
          </div>
          <p className="text-sm text-slate-600 mb-6">
            Use these tools with extreme caution. Actions here are destructive and cannot be undone.
          </p>
          
          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-sm hover:shadow-md"
            >
              <Trash2 className="w-5 h-5" />
              Clear All Quotation Data
            </button>
          ) : (
            <div className="flex flex-col gap-4 p-4 bg-white border border-red-200 rounded-xl">
              <p className="text-sm font-bold text-red-900">Are you absolutely sure?</p>
              <p className="text-xs text-red-700">
                This will delete all Suppliers, Uploads, Reviews, Price Entries, and Learning data for your account.
              </p>
              <div className="flex gap-3">
                <button
                  disabled={isClearing}
                  onClick={handleClearData}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 disabled:opacity-50"
                >
                  {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Yes, Delete Everything
                </button>
                <button
                  disabled={isClearing}
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
