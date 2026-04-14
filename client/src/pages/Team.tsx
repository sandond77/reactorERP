import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Link, Mail, Trash2, Copy, Check, UserMinus, Pencil, LogIn } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

interface OrgSettings {
  id: string;
  name: string;
  max_members: number;
  role: 'owner' | 'member';
  created_at: string;
}

interface Member {
  id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Invite {
  id: string;
  email: string | null;
  token: string;
  expires_at: string;
  created_at: string;
}

function Avatar({ member }: { member: Member }) {
  const name = member.display_name ?? member.email;
  return member.avatar_url ? (
    <img src={member.avatar_url} alt="" className="w-8 h-8 rounded-full" />
  ) : (
    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm text-white font-medium">
      {name[0].toUpperCase()}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
      title="Copy link"
    >
      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
    </button>
  );
}

export function Team() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  const [joinWarning, setJoinWarning] = useState<{ message: string; token: string } | null>(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveConfirmText, setLeaveConfirmText] = useState('');

  const { data: org } = useQuery<OrgSettings>({
    queryKey: ['org'],
    queryFn: () => api.get('/org').then((r) => r.data),
  });

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['org-members'],
    queryFn: () => api.get('/org/members').then((r) => r.data),
  });

  const { data: invites = [] } = useQuery<Invite[]>({
    queryKey: ['org-invites'],
    queryFn: () => api.get('/org/invites').then((r) => r.data),
    enabled: org?.role === 'owner',
  });

  const createInviteMut = useMutation({
    mutationFn: (email?: string) =>
      api.post('/org/invites', email ? { email } : {}).then((r) => r.data as Invite),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-invites'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to create invite'),
  });

  const deleteInviteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/org/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-invites'] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to delete invite'),
  });

  const removeMemberMut = useMutation({
    mutationFn: (userId: string) => api.delete(`/org/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-members'] });
      setRemovingMember(null);
      toast.success('Member removed');
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to remove member'),
  });

  const leaveMut = useMutation({
    mutationFn: () => api.post('/org/leave'),
    onSuccess: () => {
      toast.success('You have left the team');
      qc.invalidateQueries({ queryKey: ['org'] });
      qc.invalidateQueries({ queryKey: ['org-members'] });
      setShowLeaveModal(false);
      setLeaveConfirmText('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to leave team'),
  });

  const renameMut = useMutation({
    mutationFn: (name: string) => api.patch('/org/name', { name }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org'] });
      setShowRenameModal(false);
      toast.success('Organization renamed');
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to rename'),
  });

  const isOwner = org?.role === 'owner';
  const inviteLink = (token: string) => `${window.location.origin}/join/${token}`;

  const [joinLink, setJoinLink] = useState('');
  const joinMut = useMutation({
    mutationFn: ({ token, force }: { token: string; force?: boolean }) =>
      api.post('/org/invites/accept', { token, force }).then((r) => r.data),
    onSuccess: (data, { token }) => {
      if (data.warning) {
        setJoinWarning({ message: data.message, token });
        return;
      }
      toast.success('Joined team!');
      qc.invalidateQueries({ queryKey: ['org'] });
      qc.invalidateQueries({ queryKey: ['org-members'] });
      setJoinLink('');
      setJoinWarning(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to join team'),
  });

  function handleJoin() {
    const raw = joinLink.trim();
    const token = raw.includes('/join/') ? raw.split('/join/')[1].split('?')[0] : raw;
    if (!token) return;
    joinMut.mutate({ token });
  }

  function handleCreateInvite() {
    createInviteMut.mutate(inviteEmail.trim() || undefined);
  }

  function openRename() {
    setNewOrgName(org?.name ?? '');
    setShowRenameModal(true);
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Team</h1>
          {org && (
            <p className="text-sm text-zinc-400 mt-0.5">
              {org.name}
              {isOwner && (
                <button
                  onClick={openRename}
                  className="ml-2 text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1"
                  title="Rename organization"
                >
                  <Pencil size={12} />
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isOwner && (
            <Button size="sm" variant="outline" onClick={() => setShowLeaveModal(true)} className="text-red-400 border-red-400/30 hover:bg-red-400/10">
              Leave team
            </Button>
          )}
          {isOwner && (
            <Button size="sm" onClick={() => setShowInviteModal(true)}>
              <Users size={14} className="mr-1.5" />
              Invite member
            </Button>
          )}
        </div>
      </div>

      {/* Members */}
      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
          Members {org && `(${members.length} / ${org.max_members})`}
        </h2>
        <div className="space-y-1">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <Avatar member={m} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-100 truncate">
                  {m.display_name ?? m.email}
                  {m.user_id === user?.id && (
                    <span className="ml-1.5 text-xs text-zinc-500">(you)</span>
                  )}
                </p>
                <p className="text-xs text-zinc-500 truncate">{m.email}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                m.role === 'owner'
                  ? 'bg-indigo-600/20 text-indigo-400'
                  : 'bg-zinc-800 text-zinc-400'
              }`}>
                {m.role === 'owner' ? 'Owner' : 'Member'}
              </span>
              {isOwner && m.role === 'member' && (
                <button
                  onClick={() => setRemovingMember(m)}
                  className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                  title="Remove member"
                >
                  <UserMinus size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Join a team — hidden if already in a shared org */}
      {members.length <= 1 && <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Join a team</h2>
        <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800 space-y-3">
          <p className="text-sm text-zinc-400">Have an invite link? Paste it below to join an existing team.</p>
          <div className="flex gap-2">
            <Input
              value={joinLink}
              onChange={(e) => setJoinLink(e.target.value)}
              placeholder="Paste invite link or token"
              className="flex-1"
            />
            <Button size="sm" onClick={handleJoin} disabled={!joinLink.trim() || joinMut.isPending}>
              <LogIn size={13} className="mr-1.5" />
              Join
            </Button>
          </div>
        </div>
      </section>}

      {/* Pending invites (owner only) */}
      {isOwner && invites.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Pending Invites</h2>
          <div className="space-y-1">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
              >
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
                  {inv.email ? <Mail size={14} className="text-zinc-400" /> : <Link size={14} className="text-zinc-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-300 truncate">
                    {inv.email ?? 'Link invite'}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <CopyButton text={inviteLink(inv.token)} />
                <button
                  onClick={() => deleteInviteMut.mutate(inv.id)}
                  className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                  title="Delete invite"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Invite modal */}
      <Modal
        open={showInviteModal}
        onClose={() => { setShowInviteModal(false); setInviteEmail(''); createInviteMut.reset(); }}
        title="Invite team member"
      >
        <div className="space-y-4">
          {!createInviteMut.data ? (
            <>
              <p className="text-sm text-zinc-400">
                This generates a shareable invite link. No email is sent — you copy and send the link yourself.
              </p>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Label (optional)</label>
                <Input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="e.g. teammate@example.com"
                  type="email"
                />
                <p className="text-xs text-zinc-500 mt-1">Just a label to identify who the invite is for. Not used to send anything.</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowInviteModal(false); setInviteEmail(''); createInviteMut.reset(); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleCreateInvite} disabled={createInviteMut.isPending}>
                  <Link size={13} className="mr-1.5" />Generate invite link
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-400">
                Copy this link and send it to your teammate. Anyone with this link can join your team.
              </p>
              <div className="p-3 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center gap-2">
                <p className="flex-1 text-xs text-zinc-300 truncate font-mono">
                  {inviteLink(createInviteMut.data.token)}
                </p>
                <CopyButton text={inviteLink(createInviteMut.data.token)} />
              </div>
              <p className="text-xs text-zinc-500">Expires in 48 hours. You can revoke it from the pending invites list.</p>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => { setShowInviteModal(false); setInviteEmail(''); createInviteMut.reset(); }}>
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Leave team modal */}
      <Modal
        open={showLeaveModal}
        onClose={() => { setShowLeaveModal(false); setLeaveConfirmText(''); }}
        title="Leave team"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
            You will lose access to all shared inventory immediately. Your account will revert to a solo organization.
          </p>
          <p className="text-sm text-zinc-400">
            Type <span className="font-mono font-bold text-zinc-100">LEAVE</span> to confirm.
          </p>
          <Input
            value={leaveConfirmText}
            onChange={(e) => setLeaveConfirmText(e.target.value)}
            placeholder="Type LEAVE to confirm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowLeaveModal(false); setLeaveConfirmText(''); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-500 text-white border-red-600"
              onClick={() => leaveMut.mutate()}
              disabled={leaveConfirmText !== 'LEAVE' || leaveMut.isPending}
            >
              Leave team
            </Button>
          </div>
        </div>
      </Modal>

      {/* Remove member confirmation modal */}
      <Modal
        open={!!removingMember}
        onClose={() => setRemovingMember(null)}
        title="Remove member"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
            Remove <span className="font-medium text-zinc-100">{removingMember?.display_name ?? removingMember?.email}</span> from the team?
            They will lose access immediately and their account will revert to a solo organization.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setRemovingMember(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-500 text-white border-red-600"
              onClick={() => removingMember && removeMemberMut.mutate(removingMember.user_id)}
              disabled={removeMemberMut.isPending}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>

      {/* Join warning modal — shown when user has existing data */}
      <Modal
        open={!!joinWarning}
        onClose={() => setJoinWarning(null)}
        title="Existing data warning"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">{joinWarning?.message}</p>
          <p className="text-xs text-zinc-500">
            Your existing data stays in the database but will be inaccessible while you're part of another team.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setJoinWarning(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-500 text-white border-red-600"
              onClick={() => joinWarning && joinMut.mutate({ token: joinWarning.token, force: true })}
              disabled={joinMut.isPending}
            >
              Join anyway
            </Button>
          </div>
        </div>
      </Modal>

      {/* Rename modal */}
      <Modal
        open={showRenameModal}
        onClose={() => setShowRenameModal(false)}
        title="Rename organization"
      >
        <div className="space-y-4">
          <Input
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            placeholder="Organization name"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowRenameModal(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => renameMut.mutate(newOrgName.trim())}
              disabled={!newOrgName.trim() || renameMut.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
