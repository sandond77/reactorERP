import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AgentPanel } from './AgentPanel';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative pl-12 lg:pl-0">
        {/* Hamburger — only visible at tablet width when the sidebar is hidden.
            Sits in absolute position over the page header; small enough to not
            collide with most header content. */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden absolute top-3 left-3 z-30 p-2 rounded-lg bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          title="Open menu"
        >
          <Menu size={16} />
        </button>
        <Outlet />
      </main>
      <AgentPanel />
    </div>
  );
}
