import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, Star, TrendingUp, ListOrdered, BarChart3, Upload, Zap, LayoutGrid, Layers } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/overall', icon: LayoutGrid, label: 'Overall' },
  { to: '/inventory', icon: Package, label: 'Inventory' },
  { to: '/parts', icon: Layers, label: 'Parts' },
  { to: '/grading', icon: Star, label: 'Grading' },
  { to: '/listings', icon: ListOrdered, label: 'Listings' },
  { to: '/sales', icon: TrendingUp, label: 'Sales' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
  { to: '/import', icon: Upload, label: 'Import' },
];

export function Sidebar() {
  const { user } = useAuth();

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-zinc-950 border-r border-zinc-800 min-h-screen">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-zinc-800">
        <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
          <Zap size={14} className="text-white" />
        </div>
        <span className="text-sm font-bold text-zinc-100 tracking-wide">REACTOR</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-indigo-600/20 text-indigo-400 font-medium'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      {user && (
        <div className="px-3 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs text-white font-medium">
                {(user.display_name ?? user.email)[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">{user.display_name ?? user.email}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
