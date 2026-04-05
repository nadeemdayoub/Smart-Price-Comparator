import React from 'react';
import { motion } from 'motion/react';
import { UserProfile } from '../../types';
import { CheckCircle, XCircle, Trash2, Shield } from 'lucide-react';

interface UsersTableProps {
  users: UserProfile[];
  onActivate: (userId: string) => void;
  onBlock: (userId: string) => void;
  onDelete: (userId: string) => void;
  onRoleChange: (userId: string, role: string) => void;
}

export const UsersTable: React.FC<UsersTableProps> = ({ users, onActivate, onBlock, onDelete, onRoleChange }) => {
  const roles = [
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'user', label: 'User' }
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">User Management</h2>
        <span className="text-sm font-medium text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200">
          {users.length} Total Users
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
              <th className="px-6 py-4 border-b border-slate-100">User</th>
              <th className="px-6 py-4 border-b border-slate-100">Role</th>
              <th className="px-6 py-4 border-b border-slate-100">Status</th>
              <th className="px-6 py-4 border-b border-slate-100">Metrics</th>
              <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user, index) => (
              <motion.tr
                key={user.uid}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="hover:bg-slate-50/50 transition-colors group"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold border border-indigo-100">
                      {user.displayName?.[0] || user.email[0].toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-slate-900">{user.displayName || 'Unnamed User'}</span>
                      <span className="text-xs text-slate-500">{user.email}</span>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {user.role === 'super_admin' && <Shield className="w-4 h-4 text-indigo-500" />}
                    <select
                      value={user.role}
                      onChange={(e) => onRoleChange(user.uid, e.target.value)}
                      className="text-sm bg-transparent border-none focus:ring-0 text-slate-600 font-medium cursor-pointer hover:text-indigo-600 transition-colors capitalize p-0"
                    >
                      {roles.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    user.status === 'active' 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                      : user.status === 'pending'
                      ? 'bg-amber-50 text-amber-700 border-amber-100'
                      : 'bg-rose-50 text-rose-700 border-rose-100'
                  }`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1 text-[10px] text-slate-500">
                    <span>Uploads: {user.metrics?.totalUploads || 0}</span>
                    <span>Snapshots: {user.metrics?.totalSnapshots || 0}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {user.status !== 'active' && (
                      <button
                        onClick={() => onActivate(user.uid)}
                        className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Activate"
                      >
                        <CheckCircle className="w-5 h-5" />
                      </button>
                    )}
                    {user.status !== 'blocked' && (
                      <button
                        onClick={() => onBlock(user.uid)}
                        className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                        title="Block"
                      >
                        <XCircle className="w-5 h-5" />
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(user.uid)}
                      className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
