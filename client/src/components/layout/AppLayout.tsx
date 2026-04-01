import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { AgentPanel } from './AgentPanel';

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <Outlet />
      </main>
      <AgentPanel />
    </div>
  );
}
