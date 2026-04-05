import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { auth } from './firebase';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import PendingApproval from './pages/PendingApproval';
import Catalog from './pages/Catalog';
import Suppliers from './pages/Suppliers';
import Upload from './pages/Upload';
import Review from './pages/Review';
import Reports from './pages/Reports';
import SupplierComparison from './pages/SupplierComparison';
import ExchangeRates from './pages/ExchangeRates';
import SupplierSnapshots from './pages/SupplierSnapshots';
import SnapshotDetails from './pages/SnapshotDetails';
import FinalizedLists from './pages/FinalizedLists';
import UnmappedItems from './pages/UnmappedItems';
import SupplierIntelligence from './pages/SupplierIntelligence';
import AdminReset from './pages/AdminReset';

import ErrorBoundary from './components/ErrorBoundary';

import { AdminPanel } from './pages/AdminPanel';

const ProtectedRoute: React.FC<{ 
  children: React.ReactNode; 
  adminOnly?: boolean;
}> = ({ children, adminOnly }) => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Admin bypass for status gate
  if (adminOnly) {
    if (profile?.role === 'super_admin') {
      return <>{children}</>;
    }
    return <Navigate to="/app" replace />;
  }

  // Status Gate Logic
  if (!profile) {
    // If user is logged in but has no profile document yet, 
    // treat as pending to be safe (unless they are the super admin virtual profile handled in AuthContext)
    return <Navigate to="/pending-approval" replace />;
  }

  if (profile.status === 'pending') {
    return <Navigate to="/pending-approval" replace />;
  }

  if (profile && profile.status === 'blocked') {
    return (
      <div className="flex items-center justify-center h-screen bg-stone-50 p-6 text-center">
        <div className="max-w-md p-10 bg-white rounded-3xl shadow-xl border border-red-100">
          <h1 className="text-2xl font-black text-red-600 mb-4">Account Blocked</h1>
          <p className="text-stone-500 mb-6">Your account has been suspended. Please contact support for more information.</p>
          <button 
            onClick={() => auth.signOut()}
            className="px-8 py-3 bg-stone-900 text-white rounded-xl font-bold"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/landing" replace />} />
            <Route path="/landing" element={<StaticLandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/pending-approval" element={
              <div className="bg-stone-50 min-h-screen">
                <PendingApproval />
              </div>
            } />
            <Route
              path="/admin/*"
              element={
                <ProtectedRoute adminOnly>
                  <AdminPanel />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="catalog" element={<Catalog />} />
              <Route path="suppliers" element={<Suppliers />} />
              <Route path="suppliers/:supplierId/snapshots" element={<SupplierSnapshots />} />
              <Route path="suppliers/:supplierId/snapshots/:uploadId" element={<SnapshotDetails />} />
              <Route path="finalized-lists" element={<FinalizedLists />} />
              <Route path="unmapped" element={<UnmappedItems />} />
              <Route path="upload" element={<Upload />} />
              <Route path="review/:quotationId" element={<Review />} />
              <Route path="comparison" element={<SupplierComparison />} />
              <Route path="intelligence" element={<SupplierIntelligence />} />
            <Route path="reports" element={<Reports />} />
            <Route path="exchange-rates" element={<ExchangeRates />} />
            <Route path="admin-reset" element={<AdminReset />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  </ErrorBoundary>
);
}

const StaticLandingPage: React.FC = () => {
  return (
    <iframe 
      src="/landing.html" 
      className="w-full h-screen border-none"
      title="Smart Price Comparator Landing"
      allow="fullscreen"
    />
  );
};
