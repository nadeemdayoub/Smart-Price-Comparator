import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  BookOpen, 
  Truck, 
  UploadCloud, 
  History,
  GitCompare,
  BarChart3, 
  LogOut, 
  Menu, 
  X,
  User,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { auth } from '../firebase';
import { cn } from '../lib/utils';

const Layout: React.FC = () => {
  const { profile } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const isSuperAdmin = profile?.role === 'super_admin';

  const handleLogout = async () => {
    await auth.signOut();
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/app' },
    { name: 'Product Catalog', icon: BookOpen, path: '/app/catalog' },
    { name: 'Unmapped Items', icon: ShieldAlert, path: '/app/unmapped' },
    { name: 'Suppliers', icon: Truck, path: '/app/suppliers' },
    { name: 'Upload Quotation', icon: UploadCloud, path: '/app/upload' },
    { name: 'Finalized Lists', icon: History, path: '/app/finalized-lists' },
    { name: 'Comparison', icon: GitCompare, path: '/app/comparison' },
    { name: 'Supplier Intelligence', icon: BarChart3, path: '/app/intelligence' },
    { name: 'Reports', icon: BarChart3, path: '/app/reports' },
    { name: 'Exchange Rates', icon: Settings, path: '/app/exchange-rates' },
  ];

  // Filter items based on roles
  const filteredNavItems = [...navItems];

  if (isSuperAdmin) {
    filteredNavItems.unshift(
      { name: 'Admin Dashboard', icon: LayoutDashboard, path: '/admin' },
      { name: 'Admin Users', icon: User, path: '/admin/users' }
    );
    filteredNavItems.push({ name: 'Admin Reset', icon: ShieldAlert, path: '/app/admin-reset' });
  }

  return (
    <div className="flex h-screen bg-stone-50 text-stone-900 font-sans">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-stone-200">
        <div className="p-6 border-b border-stone-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-stone-900">Smart Price</h1>
              <p className="text-[10px] text-stone-500 font-mono uppercase tracking-widest">Comparator</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => {
                const active = isActive;
                return cn(
                  "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all",
                  active 
                    ? "bg-amber-50 text-amber-700 shadow-sm border-l-4 border-l-amber-500" 
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                );
              }}
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn("w-4 h-4 mr-3", isActive ? "text-amber-600" : "text-stone-400")} />
                  {item.name}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-stone-100">
          <div className="flex items-center p-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center mr-3">
              <User className="w-4 h-4 text-stone-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{profile?.displayName || profile?.email}</p>
              <p className="text-xs text-stone-500 capitalize">{profile?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-3 py-2 text-sm font-medium text-stone-600 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-4 h-4 mr-3" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-stone-200 flex items-center justify-between px-4 z-50">
        <h1 className="text-lg font-bold">Smart Price</h1>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 bg-white z-40 pt-16">
          <nav className="p-4 space-y-2">
            {filteredNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center px-4 py-3 text-base font-medium rounded-lg",
                    isActive ? "bg-stone-900 text-white" : "text-stone-600"
                  )
                }
              >
                <item.icon className="w-5 h-5 mr-4" />
                {item.name}
              </NavLink>
            ))}
            <button
              onClick={handleLogout}
              className="flex items-center w-full px-4 py-3 text-base font-medium text-red-600"
            >
              <LogOut className="w-5 h-5 mr-4" />
              Sign Out
            </button>
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pt-16 md:pt-0">
        <div className="max-w-7xl mx-auto p-6 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
