import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import toast from 'react-hot-toast';

export function JoinOrg() {
  const { token } = useParams<{ token: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!user) {
    // Redirect to login, then come back
    sessionStorage.setItem('postLoginRedirect', `/join/${token}`);
    navigate('/login');
    return null;
  }

  async function handleAccept() {
    setAccepting(true);
    try {
      await api.post('/org/invites/accept', { token });
      toast.success('You have joined the organization!');
      navigate('/team');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Failed to accept invite');
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center space-y-5">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 flex items-center justify-center mx-auto">
          <Users size={24} className="text-indigo-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Join team</h1>
          <p className="text-sm text-zinc-400 mt-1">You've been invited to join an organization on Reactor.</p>
        </div>
        <div className="pt-1">
          <p className="text-xs text-zinc-500 mb-4">Signed in as <span className="text-zinc-300">{user.email}</span></p>
          <Button onClick={handleAccept} disabled={accepting} className="w-full">
            {accepting ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
            Accept invite
          </Button>
        </div>
      </div>
    </div>
  );
}
