import { useEffect, type ReactNode } from 'react';
import { X, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Optional badge count rendered next to the launcher (e.g. number of active filters). */
  activeCount?: number;
  children: ReactNode;
  className?: string;
}

/**
 * Slide-in side drawer for filter pills at tablet width. Used on pages where
 * the header would otherwise cram 6+ filter pills + search + action button on
 * one row. At lg+ the drawer is not rendered — the caller renders the filter
 * pills inline as usual. Use FilterDrawerLauncher for the matching trigger
 * button (it sits in the header at <lg only).
 */
export function FilterDrawer({ open, onClose, title = 'Filters', children, className }: FilterDrawerProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      />
      {/* Drawer panel — slides in from the right */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-80 max-w-[calc(100vw-3rem)] bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col transition-transform lg:hidden',
          open ? 'translate-x-0' : 'translate-x-full',
          className,
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </>
  );
}

interface FilterDrawerLauncherProps {
  onClick: () => void;
  activeCount?: number;
  className?: string;
}

/** Compact "Filters" button shown in the header at <lg to open the drawer. */
export function FilterDrawerLauncher({ onClick, activeCount = 0, className }: FilterDrawerLauncherProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'lg:hidden inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-colors',
        activeCount > 0
          ? 'bg-indigo-600 text-white'
          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
        className,
      )}
      title="Filters"
    >
      <SlidersHorizontal size={12} />
      <span>Filters</span>
      {activeCount > 0 && (
        <span className="ml-0.5 text-[10px] bg-indigo-500/40 px-1 rounded">
          {activeCount}
        </span>
      )}
    </button>
  );
}
