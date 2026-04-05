import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminLayout } from '../components/admin/AdminLayout';
import { AdminDashboard } from '../components/admin/AdminDashboard';
import { UsersTable } from '../components/admin/UsersTable';
import { adminService } from '../services/adminService';
import { UserProfile, SystemStats } from '../types';
import { useAuth } from '../AuthContext';
import { AnimatePresence } from 'framer-motion';
import { getFirestoreErrorMessage } from '../services/firestoreErrorHandler';
import { AlertCircle, X } from 'lucide-react';

export const AdminPanel: React.FC = () => {
  const { profile, loading: authLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SystemStats>({
    totalUsers: 0,
    pendingUsers: 0,
    totalUploads: 0,
    totalSnapshots: 0,
    totalComparisons: 0,
    updatedAt: new Date().toISOString()
  });
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !profile || profile.role !== 'super_admin') return;

    const unsubUsers = adminService.subscribeToUsers((userList) => {
      setUsers(userList);
      setStats(prev => ({
        ...prev,
        totalUsers: userList.length,
        pendingUsers: userList.filter(u => u.status === 'pending').length
      }));
    });

    const unsubUploads = adminService.subscribeToUploads((count) => {
      setStats(prev => ({ ...prev, totalUploads: count }));
    });

    const unsubPriceEntries = adminService.subscribeToPriceEntries((count) => {
      setStats(prev => ({ ...prev, totalSnapshots: count }));
    });

    const unsubMatchReviews = adminService.subscribeToMatchReviews((count) => {
      setStats(prev => ({ ...prev, totalComparisons: count }));
    });

    setLoading(false);

    return () => {
      unsubUsers();
      unsubUploads();
      unsubPriceEntries();
      unsubMatchReviews();
    };
  }, [authLoading, profile]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // Security check: Only super_admin can access
  if (!profile || profile.role !== 'super_admin') {
    return <Navigate to="/app" replace />;
  }

  const handleActivateUser = async (userId: string) => {
    try {
      await adminService.updateUserStatus(userId, 'active');
    } catch (e) {
      setError(getFirestoreErrorMessage(e, "Failed to activate user."));
    }
  };

  const handleBlockUser = async (userId: string) => {
    try {
      await adminService.updateUserStatus(userId, 'blocked');
    } catch (e) {
      setError(getFirestoreErrorMessage(e, "Failed to block user."));
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await adminService.updateUserRole(userId, role);
    } catch (e) {
      setError(getFirestoreErrorMessage(e, "Failed to change user role."));
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      // window.confirm is unreliable in iframes, executing directly for admin
      await adminService.deleteUser(userId);
    } catch (e) {
      setError(getFirestoreErrorMessage(e, "Failed to delete user."));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <AdminLayout>
      <AnimatePresence>
        {error && (
          <div className="mb-6 bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-900">Admin Error</p>
              <p className="text-xs text-red-700 mt-1">{error}</p>
            </div>
            <button 
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </AnimatePresence>
      <Routes>
        <Route index element={<AdminDashboard stats={stats} />} />
        <Route 
          path="users" 
          element={
            <UsersTable 
              users={users} 
              onActivate={handleActivateUser} 
              onBlock={handleBlockUser} 
              onDelete={handleDeleteUser} 
              onRoleChange={handleRoleChange}
            />
          } 
        />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminLayout>
  );
};
