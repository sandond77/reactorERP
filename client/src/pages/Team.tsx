import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Link, Mail, Trash2, Copy, Check, UserMinus, Pencil, LogIn, DatabaseZap, Download, ChevronLeft, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

// ─── Migration Wizard ─────────────────────────────────────────────────────────

type MigrationType = 'graded' | 'raw_purchase';

interface FieldSpec {
  name: string;
  required: boolean;
  description: string;
  example: string;
  accepted?: string;
}

const MIGRATION_FIELDS: Record<MigrationType, FieldSpec[]> = {
  graded: [
    { name: 'card_name',     required: true,  description: 'Full card name',                         example: '2002 Pokemon Japanese McDonald\'s 014 Slowpoke-Holo' },
    { name: 'cert_number',   required: true,  description: 'Grading company certificate number',     example: '64156386' },
    { name: 'grade',         required: true,  description: 'Grade — include company prefix so we can detect the grader automatically', example: 'GEM MINT 10  ·  PSA 9  ·  BGS 9.5  ·  CGC 10 Gem Mint', accepted: 'Supported prefixes: PSA, BGS, CGC, SGC, HGA, ACE, ARS. If no prefix, add a separate company column.' },
    { name: 'company',       required: false, description: 'Grading company — only needed if not already in your grade column', example: 'PSA', accepted: 'PSA, BGS, CGC, SGC, HGA, ACE, ARS, OTHER' },
    { name: 'set_name',      required: false, description: 'Set or expansion name',                  example: 'Base Set' },
    { name: 'card_number',   required: false, description: 'Card number within the set',             example: '4/102' },
    { name: 'purchase_cost', required: false, description: 'What you paid for the raw card (USD)',   example: '250.00', accepted: 'Decimal number. Defaults to 0 if omitted.' },
    { name: 'grading_cost',  required: false, description: 'What you paid to get it graded (USD)',   example: '25.00',  accepted: 'Decimal number. Defaults to 0 if omitted.' },
    { name: 'currency',      required: false, description: 'Currency code',                          example: 'USD', accepted: 'USD, CAD, EUR, GBP, JPY, AUD. Defaults to USD.' },
    { name: 'purchased_at',  required: false, description: 'Date you bought the card',              example: '2024-01-15', accepted: 'YYYY-MM-DD format.' },
    { name: 'order_number',  required: false, description: 'Order or invoice reference',             example: 'ORD-001' },
    { name: 'notes',         required: false, description: 'Any additional notes',                   example: 'Bought at card show' },
    { name: 'sold_at',       required: false, description: 'Date sold — if present, card is marked sold and a sale record is created', example: '2024-06-20', accepted: 'YYYY-MM-DD format. Leave blank if not sold.' },
    { name: 'sale_price',    required: false, description: 'Gross sale price (before fees)',          example: '319.00', accepted: 'Used with sold_at. Decimal number.' },
    { name: 'after_fees',    required: false, description: 'Net after platform fees — platform fees are back-calculated as sale_price minus after_fees', example: '293.48' },
    { name: 'shipping_cost', required: false, description: 'Shipping cost charged to buyer',         example: '5.00' },
    { name: 'platform',      required: false, description: 'Where the card was sold or listed',      example: 'ebay', accepted: 'ebay, tcgplayer, facebook, instagram, local, card_show, other. Defaults to other.' },
    { name: 'is_listed',     required: false, description: 'Whether the card is currently listed for sale — creates an active listing record', example: 'Yes', accepted: 'Yes/No or True/False. Only used if sold_at is blank.' },
    { name: 'list_price',    required: false, description: 'Current asking price if listed',         example: '350.00' },
    { name: 'listing_url',   required: false, description: 'URL or ID of the listing',              example: 'https://ebay.com/itm/123456' },
    { name: 'listed_at',     required: false, description: 'Date the card was listed',              example: '2024-05-01', accepted: 'YYYY-MM-DD format.' },
  ],
  raw_purchase: [
    { name: 'card_name',     required: true,  description: 'Full card name',                         example: 'Pikachu' },
    { name: 'condition',     required: false, description: 'Card condition',                         example: 'NM', accepted: 'NM, LP, MP, HP, DMG. Defaults to null if omitted — set during inspection.' },
    { name: 'quantity',      required: false, description: 'Number of copies',                       example: '1', accepted: 'Integer. Defaults to 1 if omitted.' },
    { name: 'cost',          required: false, description: 'Cost per card (USD)',                    example: '15.00', accepted: 'Decimal number. Defaults to 0 if omitted.' },
    { name: 'type',          required: false, description: 'Purchase type',                          example: 'raw', accepted: 'raw (default) or bulk' },
    { name: 'set_name',      required: false, description: 'Set or expansion name',                  example: 'Base Set' },
    { name: 'card_number',   required: false, description: 'Card number within the set',             example: '58/102' },
    { name: 'currency',      required: false, description: 'Currency code',                          example: 'USD', accepted: 'USD, CAD, EUR, GBP, JPY, AUD. Defaults to USD.' },
    { name: 'order_number',  required: false, description: 'Order reference — rows sharing an order number are grouped into one purchase lot', example: 'ORD-123' },
    { name: 'source',        required: false, description: 'Where you bought it',                    example: 'eBay' },
    { name: 'purchased_at',  required: false, description: 'Date you bought the card',              example: '2024-03-01', accepted: 'YYYY-MM-DD format.' },
    { name: 'language',      required: false, description: 'Card language',                          example: 'EN', accepted: 'EN, JP, DE, FR, IT, ES, PT, KO, ZH. Defaults to EN.' },
    { name: 'notes',         required: false, description: 'Any additional notes',                   example: 'Bought in bulk lot' },
  ],
};

async function downloadTemplate(type: MigrationType) {
  const res = await api.get(`/import/template/${type}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const MIGRATION_KEY = (type: MigrationType) => `reactor_migration_guide_done_${type}`;

function MigrationWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'pick' | 'fields' | 'ready'>('pick');
  const [type, setType] = useState<MigrationType>('graded');
  const [showRerunWarning, setShowRerunWarning] = useState(false);

  function handlePickType(t: MigrationType) {
    setType(t);
    if (localStorage.getItem(MIGRATION_KEY(t))) {
      setShowRerunWarning(true);
    } else {
      setStep('fields');
    }
  }

  function proceedAnyway() {
    setShowRerunWarning(false);
    setStep('fields');
  }

  function handleDownload() {
    downloadTemplate(type);
    localStorage.setItem(MIGRATION_KEY(type), new Date().toISOString());
    setStep('ready');
  }

  const fields = MIGRATION_FIELDS[type];
  const required = fields.filter((f) => f.required);
  const optional = fields.filter((f) => !f.required);
  const typeLabel = type === 'graded' ? 'Graded Cards' : 'Raw Purchases';

  return (
    <div className="space-y-4">
      {/* Step: Pick type */}
      {step === 'pick' && (
        <>
          <p className="text-sm text-zinc-400">
            This wizard shows you exactly what columns your spreadsheet needs before you import. You'll get a template to match your data against.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handlePickType('graded')}
              className="p-4 rounded-lg border border-zinc-700 hover:border-indigo-500 hover:bg-indigo-500/5 text-left transition-colors group"
            >
              <p className="text-sm font-medium text-zinc-100 group-hover:text-indigo-300">Graded Slabs</p>
              <p className="text-xs text-zinc-500 mt-1">PSA, BGS, CGC, SGC and other graded cards</p>
            </button>
            <button
              onClick={() => handlePickType('raw_purchase')}
              className="p-4 rounded-lg border border-zinc-700 hover:border-indigo-500 hover:bg-indigo-500/5 text-left transition-colors group"
            >
              <p className="text-sm font-medium text-zinc-100 group-hover:text-indigo-300">Raw Purchases</p>
              <p className="text-xs text-zinc-500 mt-1">Ungraded cards bought individually or in bulk</p>
            </button>
          </div>
          {showRerunWarning && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex gap-2">
              <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-xs text-amber-300">You've run this migration before. Running it again will add duplicate records if you import the same data.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowRerunWarning(false)}>Cancel</Button>
                  <Button size="sm" onClick={proceedAnyway}>Continue anyway</Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Step: Field requirements */}
      {step === 'fields' && (
        <>
          <div className="flex items-center gap-2">
            <button onClick={() => setStep('pick')} className="text-zinc-500 hover:text-zinc-300">
              <ChevronLeft size={16} />
            </button>
            <p className="text-sm font-medium text-zinc-100">{typeLabel} — Column Reference</p>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">Required columns</p>
              <div className="space-y-2">
                {required.map((f) => (
                  <div key={f.name} className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-xs font-mono text-indigo-300">{f.name}</code>
                      <span className="text-xs text-red-400 font-medium">required</span>
                    </div>
                    <p className="text-xs text-zinc-400">{f.description}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">Example: <span className="text-zinc-400">{f.example}</span></p>
                    {f.accepted && <p className="text-xs text-zinc-500 mt-0.5">{f.accepted}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Optional columns</p>
              <div className="space-y-2">
                {optional.map((f) => (
                  <div key={f.name} className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-xs font-mono text-zinc-400">{f.name}</code>
                    </div>
                    <p className="text-xs text-zinc-500">{f.description}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">Example: <span className="text-zinc-500">{f.example}</span></p>
                    {f.accepted && <p className="text-xs text-zinc-600 mt-0.5">{f.accepted}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-between items-center">
            <p className="text-xs text-zinc-500">Make sure your spreadsheet has at least the required columns, then download our template to match your data against it.</p>
            <Button size="sm" onClick={handleDownload} className="shrink-0 ml-4">
              <Download size={13} className="mr-1.5" />
              Download template
            </Button>
          </div>
        </>
      )}

      {/* Step: Ready to import */}
      {step === 'ready' && (
        <>
          <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Check size={16} className="text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-300">Template downloaded. Match your spreadsheet columns to ours, then head to the Import page to upload.</p>
          </div>
          <p className="text-xs text-zinc-500">
            On the Import page, upload your file — AI will detect the type and pre-fill the column mapping. Review it before confirming.
          </p>
          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={() => setStep('fields')}>
              <ChevronLeft size={13} className="mr-1" />
              Back to fields
            </Button>
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </>
      )}
    </div>
  );
}

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
  name: string | null;
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
  const [inviteName, setInviteName] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  const [joinWarning, setJoinWarning] = useState<{ message: string; token: string } | null>(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveConfirmText, setLeaveConfirmText] = useState('');
  const [showMigrationModal, setShowMigrationModal] = useState(false);

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
    mutationFn: ({ email, name }: { email?: string; name?: string } = {}) =>
      api.post('/org/invites', { ...(email && { email }), ...(name && { name }) }).then((r) => r.data as Invite),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-invites'] });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to create invite'),
  });

  const deleteInviteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/org/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-invites'] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to delete invite'),
  });

  const removeMemberMut = useMutation({
    mutationFn: (userId: string) => api.delete(`/org/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-members'] });
      setRemovingMember(null);
      toast.success('Member removed');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to leave team'),
  });

  const renameMut = useMutation({
    mutationFn: (name: string) => api.patch('/org/name', { name }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org'] });
      setShowRenameModal(false);
      toast.success('Organization renamed');
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to join team'),
  });

  function handleJoin() {
    const raw = joinLink.trim();
    const token = raw.includes('/join/') ? raw.split('/join/')[1].split('?')[0] : raw;
    if (!token) return;
    joinMut.mutate({ token });
  }

  function handleCreateInvite() {
    createInviteMut.mutate({ email: inviteEmail.trim() || undefined, name: inviteName.trim() || undefined });
  }

  function openRename() {
    setNewOrgName(org?.name ?? '');
    setShowRenameModal(true);
  }

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Team</h1>
          {org && (
            <div className="flex items-center gap-1.5 mt-1">
              <p className="text-sm text-zinc-400">{org.name}</p>
              {isOwner && (
                <button
                  onClick={openRename}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                  title="Rename organization"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          )}
        </div>
        {isOwner && (
          <Button size="sm" onClick={() => setShowInviteModal(true)}>
            <Users size={14} className="mr-1.5" />
            Invite member
          </Button>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-6 items-start">
        {/* Left — Members table (2/3 width) */}
        <div className="col-span-2 space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Members {org && <span className="text-zinc-600">({members.length} / {org.max_members})</span>}
              </h2>
            </div>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="py-2.5 px-4 text-left text-xs text-zinc-500 font-medium">Member</th>
                    <th className="py-2.5 px-4 text-left text-xs text-zinc-500 font-medium">Email</th>
                    <th className="py-2.5 px-4 text-left text-xs text-zinc-500 font-medium">Role</th>
                    <th className="py-2.5 px-4 text-left text-xs text-zinc-500 font-medium">Joined</th>
                    <th className="py-2.5 px-4 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {members.map((m) => (
                    <tr key={m.id} className="bg-zinc-900 hover:bg-zinc-800/40 transition-colors group">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <Avatar member={m} />
                          <span className="text-sm font-medium text-zinc-100">
                            {m.display_name ?? m.email.split('@')[0]}
                            {m.user_id === user?.id && <span className="ml-1.5 text-xs text-zinc-500 font-normal">(you)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-zinc-400">{m.email}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          m.role === 'owner' ? 'bg-indigo-600/20 text-indigo-400' : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          {m.role === 'owner' ? 'Owner' : 'Member'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-zinc-500">
                        {new Date(m.joined_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="py-3 px-4">
                        {isOwner && m.role === 'member' && (
                          <button
                            onClick={() => setRemovingMember(m)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-all"
                            title="Remove member"
                          >
                            <UserMinus size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Pending invites */}
          {isOwner && invites.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Pending Invites</h2>
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/60">
                      <th className="py-2.5 px-4 text-left text-xs text-zinc-500 font-medium">Label</th>
                      <th className="py-2.5 px-4 text-left text-xs text-zinc-500 font-medium">Expires</th>
                      <th className="py-2.5 px-4 w-20" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {invites.map((inv) => (
                      <tr key={inv.id} className="bg-zinc-900 hover:bg-zinc-800/40 transition-colors group">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            {inv.email ? <Mail size={13} className="text-zinc-500 shrink-0" /> : <Link size={13} className="text-zinc-500 shrink-0" />}
                            <div>
                              {inv.name && <p className="text-sm text-zinc-200">{inv.name}</p>}
                              <p className={inv.name ? 'text-xs text-zinc-500' : 'text-sm text-zinc-300'}>{inv.email ?? 'Link invite'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-zinc-500">
                          {new Date(inv.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <CopyButton text={inviteLink(inv.token)} />
                            <button
                              onClick={() => deleteInviteMut.mutate(inv.id)}
                              className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                              title="Delete invite"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* Right — Actions panel (1/3 width) */}
        <div className="col-span-1 space-y-4">
          {/* Org info */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Organization</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Name</span>
                <span className="text-zinc-200">{org?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Members</span>
                <span className="text-zinc-200">{members.length} / {org?.max_members ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Your role</span>
                <span className={isOwner ? 'text-indigo-400' : 'text-zinc-400'}>{isOwner ? 'Owner' : 'Member'}</span>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-2">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Actions</h3>
            {isOwner && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
              >
                <Users size={14} className="text-indigo-400 shrink-0" />
                Invite member
              </button>
            )}
            <button
              onClick={() => setShowMigrationModal(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            >
              <DatabaseZap size={14} className="text-indigo-400 shrink-0" />
              Migration Guide
            </button>
            {isOwner && (
              <button
                onClick={openRename}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
              >
                <Pencil size={14} className="text-zinc-500 shrink-0" />
                Rename organization
              </button>
            )}
            {!isOwner && members.length > 1 && (
              <button
                onClick={() => setShowLeaveModal(true)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <UserMinus size={14} className="shrink-0" />
                Leave team
              </button>
            )}
          </div>

          {/* Join a team */}
          {members.length <= 1 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Join a team</h3>
              <p className="text-xs text-zinc-500">Have an invite link? Paste it below to join an existing team.</p>
              <Input
                value={joinLink}
                onChange={(e) => setJoinLink(e.target.value)}
                placeholder="Paste invite link or token"
              />
              <Button size="sm" className="w-full" onClick={handleJoin} disabled={!joinLink.trim() || joinMut.isPending}>
                <LogIn size={13} className="mr-1.5" />
                Join team
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Invite modal */}
      <Modal
        open={showInviteModal}
        onClose={() => { setShowInviteModal(false); setInviteEmail(''); setInviteName(''); createInviteMut.reset(); }}
        title="Invite team member"
      >
        <div className="space-y-4">
          {!createInviteMut.data ? (
            <>
              <p className="text-sm text-zinc-400">
                This generates a shareable invite link. No email is sent — you copy and send the link yourself.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Name <span className="text-zinc-600">(optional)</span></label>
                  <Input
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="e.g. John"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Email <span className="text-zinc-600">(optional)</span></label>
                  <Input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="e.g. john@example.com"
                    type="email"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowInviteModal(false); setInviteEmail(''); setInviteName(''); createInviteMut.reset(); }}>
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

      {/* Migration wizard modal */}
      <Modal
        open={showMigrationModal}
        onClose={() => setShowMigrationModal(false)}
        title="Migration Guide"
      >
        <MigrationWizard onClose={() => setShowMigrationModal(false)} />
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
