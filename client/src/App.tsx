import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { RawInventory } from './pages/RawInventory';
import { Grading } from './pages/Grading';
import { Listings } from './pages/Listings';
import { Sales } from './pages/Sales';
import { Trades } from './pages/Trades';
import { Reports } from './pages/Reports';
import { Import } from './pages/Import';
import { Overall } from './pages/Overall';
import { CardShow } from './pages/CardShow';
import { InventorySummary } from './pages/InventorySummary';
import { Intake } from './pages/Intake';
import { Inspection } from './pages/Inspection';
import { UngradedInventory } from './pages/UngradedInventory';
import { SubReturns } from './pages/SubReturns';
import { RawOverall } from './pages/RawOverall';
import LocationManager from './pages/LocationManager';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-600 text-sm">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout />;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoutes />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/overall" element={<Overall />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/intake" element={<Intake />} />
              <Route path="/inspection" element={<Inspection />} />
              <Route path="/raw-inventory" element={<RawInventory />} />
              <Route path="/raw-overall" element={<RawOverall />} />
              <Route path="/grading" element={<Grading />} />
              <Route path="/sub-returns" element={<SubReturns />} />
              <Route path="/ungraded" element={<UngradedInventory />} />
              <Route path="/card-show" element={<CardShow />} />
              <Route path="/listings" element={<Listings />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/trades" element={<Trades />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/import" element={<Import />} />
              <Route path="/parts" element={<InventorySummary />} />
              <Route path="/locations" element={<LocationManager />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="bottom-right" toastOptions={{ style: { background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46' } }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
