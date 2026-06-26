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
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <Outlet />
      </main>
      {/* Floating menu button — only visible at tablet width when the sidebar
          is hidden. Mirrors the AI Agent button on the right so the two share
          a consistent floating-launcher pattern. */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="lg:hidden fixed bottom-5 left-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
        title="Open menu"
      >
        <Menu size={15} />
        <span>Menu</span>
      </button>
      <AgentPanel />
    </div>
  );
}
