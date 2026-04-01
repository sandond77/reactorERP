import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Star, TrendingUp, ListOrdered,
  BarChart3, Upload, Zap, LayoutGrid, ShoppingBag, ClipboardList,
  ChevronDown, PackageSearch, ScanSearch, Layers, GalleryVerticalEnd, PackageCheck, ArrowRightLeft, MapPin, TableProperties, Receipt,
  ScrollText, ShieldCheck, FolderClock, Tag, Settings2, LogOut,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';

const RAW_ROUTES = ['/intake', '/inspection', '/raw-overall', '/ungraded', '/grading', '/sub-returns'];
const RAW_NAV = [
  { to: '/raw-overall',   icon: TableProperties,     label: 'Raw Overall' },
  { to: '/intake',        icon: ClipboardList,       label: 'Purchases' },
  { to: '/inspection',    icon: ScanSearch,          label: 'Inspection' },
  { to: '/ungraded',      icon: GalleryVerticalEnd,  label: 'To Be Submitted' },
  { to: '/grading',       icon: Star,                label: 'Grading' },
  { to: '/sub-returns',   icon: PackageCheck,        label: 'Sub Returns' },
];

const SELLING_ROUTES = ['/listings', '/sales', '/trades'];
const SELLING_NAV = [
  { to: '/listings', icon: ListOrdered,    label: 'Listings' },
  { to: '/sales',    icon: TrendingUp,     label: 'Sales' },
  { to: '/trades',   icon: ArrowRightLeft, label: 'Trades' },
];

const MANAGE_ROUTES = ['/parts', '/locations'];
const MANAGE_NAV = [
  { to: '/parts',     icon: Layers, label: 'Parts' },
  { to: '/locations', icon: MapPin, label: 'Locations' },
];


function NavItem({ to, icon: Icon, label, indent = false }: {
  to: string; icon: React.ElementType; label: string; indent?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 py-2 rounded-lg text-sm transition-colors',
          indent ? 'pl-8 pr-3' : 'px-3',
          isActive
            ? 'bg-indigo-600/20 text-indigo-400 font-medium'
            : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
        )
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  );
}

function NavFolder({ icon: Icon, label, routes, children, defaultOpen = false }: {
  icon: React.ElementType; label: string; routes: string[]; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const location = useLocation();
  const active = routes.some((r) => location.pathname.startsWith(r));
  const [open, setOpen] = useState(active || defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
          active ? 'text-indigo-400 font-medium' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
        )}
      >
        <Icon size={16} />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={13} className={cn('transition-transform text-zinc-500', open ? 'rotate-180' : '')} />
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await api.post('/auth/logout').catch(() => {});
    navigate('/login');
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-zinc-950 border-r border-zinc-800 h-screen overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-zinc-800">
        <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
          <Zap size={14} className="text-white" />
        </div>
        <span className="text-sm font-bold text-zinc-100 tracking-wide">REACTOR</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 flex flex-col">
        <div className="space-y-0.5">
          <NavItem to="/"        icon={LayoutDashboard} label="Dashboard" />
          <NavItem to="/overall" icon={LayoutGrid}      label="Graded/Slabs" />

          <NavFolder icon={PackageSearch} label="Raw Cards" routes={RAW_ROUTES}>
            {RAW_NAV.map(({ to, icon, label }) => (
              <NavItem key={to} to={to} icon={icon} label={label} indent />
            ))}
          </NavFolder>

          <NavFolder icon={Tag} label="Selling" routes={SELLING_ROUTES}>
            {SELLING_NAV.map(({ to, icon, label }) => (
              <NavItem key={to} to={to} icon={icon} label={label} indent />
            ))}
          </NavFolder>

          <NavItem to="/card-show" icon={ShoppingBag} label="Card Show" />
          <NavItem to="/expenses"  icon={Receipt}     label="Expenses" />

          <NavItem to="/reports" icon={BarChart3} label="Reports" />

          <NavFolder icon={Settings2} label="Manage" routes={MANAGE_ROUTES}>
            {MANAGE_NAV.map(({ to, icon, label }) => (
              <NavItem key={to} to={to} icon={icon} label={label} indent />
            ))}
          </NavFolder>

          <NavFolder icon={FolderClock} label="Audit" routes={['/audit']}>
            <NavItem to="/audit/log"      icon={ScrollText}   label="Audit Log" indent />
            <NavItem to="/audit/auditing" icon={ShieldCheck}  label="Inventory Audit" indent />
          </NavFolder>

          <NavItem to="/import" icon={Upload} label="Import" />
        </div>

        <button
          onClick={handleLogout}
          className="mt-auto w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors"
        >
          <LogOut size={16} />
          Log out
        </button>
      </nav>

      {/* User */}
      {user && (
        <div className="px-3 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-2 px-0.5">
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
