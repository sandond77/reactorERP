import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, ChevronRight, MapPin, Loader2,
  Package, Star,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LocationCardType = 'graded' | 'raw' | 'both';

export interface Location {
  id: string;
  parent_id: string | null;
  name: string;
  card_type: LocationCardType;
  is_card_show: boolean;
  is_container: boolean;
  notes: string | null;
  created_at: string;
  total_count: number;
  graded_count: number;
  raw_count: number;
}

interface LocationNode extends Location {
  children: LocationNode[];
  depth: number;
}

interface LocationCard {
  id: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  purchase_type: string;
  condition: string | null;
  status: string;
  quantity: number;
  company: string | null;
  grade_label: string | null;
  cert_number: string | null;
  raw_label: string | null;
  purchase_cost: number;
  currency: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CARD_TYPE_LABELS: Record<LocationCardType, string> = {
  graded: 'Graded only',
  raw: 'Raw only',
  both: 'Graded & Raw',
};

const CARD_TYPE_COLORS: Record<LocationCardType, string> = {
  graded: 'text-yellow-400 bg-yellow-400/10',
  raw: 'text-blue-400 bg-blue-400/10',
  both: 'text-zinc-300 bg-zinc-700/50',
};

function buildTree(locations: Location[]): LocationNode[] {
  const map = new Map<string, LocationNode>();
  for (const loc of locations) {
    map.set(loc.id, { ...loc, children: [], depth: 0 });
  }
  const roots: LocationNode[] = [];
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Set depths
  function setDepth(node: LocationNode, d: number) {
    node.depth = d;
    for (const child of node.children) setDepth(child, d + 1);
  }
  for (const root of roots) setDepth(root, 0);
  // Sort children by name
  function sortChildren(node: LocationNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) sortChildren(child);
  }
  roots.sort((a, b) => a.name.localeCompare(b.name));
  for (const root of roots) sortChildren(root);
  return roots;
}

// ── Location Form ─────────────────────────────────────────────────────────────

interface LocationFormProps {
  initial?: Partial<Location>;
  parentLocation?: Location | null;
  depth: number;
  onSave: (data: { name: string; card_type: LocationCardType; is_card_show: boolean; is_container: boolean; notes: string; parent_id?: string | null }) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}

function LocationForm({ initial, parentLocation, depth, onSave, onCancel, loading }: LocationFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [cardType, setCardType] = useState<LocationCardType>(initial?.card_type ?? parentLocation?.card_type ?? 'both');
  const [isContainer, setIsContainer] = useState(initial?.is_container ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const levelLabels = ['Location', 'Sub-Location', 'Sub-Sub-Location', 'Level 4', 'Level 5'];
  const levelLabel = levelLabels[depth] ?? 'Location';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave({
      name: name.trim(),
      card_type: cardType,
      is_card_show: false,
      is_container: isContainer,
      notes,
      parent_id: parentLocation?.id ?? initial?.parent_id ?? null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {parentLocation && (
        <div className="rounded-lg bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
          Adding under: <span className="text-zinc-200 font-medium">{parentLocation.name}</span>
        </div>
      )}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">{levelLabel} Name</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Shelf 1, Bin 123" autoFocus />
      </div>
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Card Type</label>
        <Select value={cardType} onChange={e => setCardType(e.target.value as LocationCardType)}>
          <option value="both">Graded &amp; Raw</option>
          <option value="graded">Graded only</option>
          <option value="raw">Raw only</option>
        </Select>
      </div>
      {depth < 4 && (
        <label className="flex items-start gap-3 cursor-pointer select-none group">
          <input
            type="checkbox"
            checked={isContainer}
            onChange={e => setIsContainer(e.target.checked)}
            className="mt-0.5 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
          />
          <div>
            <p className="text-sm text-zinc-200 group-hover:text-zinc-100 transition-colors">Container only</p>
            <p className="text-xs text-zinc-500 mt-0.5">Cards can only be assigned to sub-locations, not directly here</p>
          </div>
        </label>
      )}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Notes <span className="text-zinc-600">(optional)</span></label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Description or notes" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={loading || !name.trim()}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          {initial?.id ? 'Save Changes' : `Create ${levelLabel}`}
        </Button>
      </div>
    </form>
  );
}

// ── Location Node Row ─────────────────────────────────────────────────────────

interface LocationNodeRowProps {
  node: LocationNode;
  allLocations: Location[];
  onEdit: (loc: Location) => void;
  onDelete: (loc: Location) => void;
  onAddChild: (parent: Location) => void;
}

function LocationNodeRow({ node, allLocations, onEdit, onDelete, onAddChild }: LocationNodeRowProps) {
  const [expanded, setExpanded] = useState(false);

  const hasChildrenOrCards = node.children.length > 0 || node.total_count > 0;
  const indent = node.depth * 24;
  const canAddChild = node.depth < 4;

  const { data: cardsData, isFetching } = useQuery<{ data: LocationCard[] }>({
    queryKey: ['location-cards', node.id],
    queryFn: () => api.get(`/locations/${node.id}/cards`).then(r => r.data),
    enabled: expanded && node.total_count > 0,
  });
  const cards = cardsData?.data ?? [];

  return (
    <>
      {/* Location row */}
      <tr className="border-b border-zinc-800/60 hover:bg-zinc-800/20 transition-colors group">
        <td className="py-3 w-6" style={{ paddingLeft: `${8 + indent}px` }}>
          {hasChildrenOrCards ? (
            <button onClick={() => setExpanded(e => !e)} className="text-zinc-600 hover:text-zinc-400">
              <ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="w-[13px] block" />
          )}
        </td>

        {/* Name + summary — spans ID/Cert + Card Name + Set cols */}
        <td colSpan={3} className={`px-3 py-3 ${hasChildrenOrCards ? 'cursor-pointer' : ''}`}
          onClick={() => hasChildrenOrCards && setExpanded(e => !e)}>
          <div className="flex items-center gap-2">
            {node.depth === 1 && <span className="text-zinc-600 select-none text-xs">└</span>}
            {node.depth === 2 && <span className="text-zinc-600 select-none text-xs">└─└</span>}
            {node.depth === 3 && <span className="text-zinc-700 select-none text-xs">└─└─└</span>}
            {node.depth === 4 && <span className="text-zinc-700 select-none text-xs">└─└─└─└</span>}
            <span className={
              node.depth === 0 ? 'font-semibold text-zinc-100' :
              node.depth === 1 ? 'font-medium text-zinc-300' :
              node.depth === 2 ? 'text-zinc-400 text-[13px]' :
              node.depth === 3 ? 'text-zinc-500 text-[13px] italic' :
              'text-zinc-600 text-[12px] italic'
            }>
              {node.name}
            </span>
            {node.total_count > 0 && (
              <span className="text-xs text-zinc-600">
                {node.total_count} card{node.total_count !== 1 ? 's' : ''}
                {node.graded_count > 0 && node.raw_count > 0 && (
                  <span className="ml-1">
                    (<span className="text-yellow-400/60">{node.graded_count}G</span>
                    {' · '}
                    <span className="text-blue-400/60">{node.raw_count}R</span>)
                  </span>
                )}
              </span>
            )}
          </div>
          {node.notes && <p className="text-xs text-zinc-600 mt-0.5 ml-4">{node.notes}</p>}
        </td>

        {/* Type */}
        <td className="px-3 py-3">
          <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${CARD_TYPE_COLORS[node.card_type]}`}>
            {CARD_TYPE_LABELS[node.card_type]}
          </span>
        </td>

        {/* Actions */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {canAddChild && (
              <button onClick={() => onAddChild(node)}
                className="p-1.5 rounded text-zinc-500 hover:text-indigo-400 hover:bg-indigo-400/10 transition-colors"
                title="Add sub-location">
                <Plus size={13} />
              </button>
            )}
            <button onClick={() => onEdit(node)}
              className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
              <Pencil size={13} />
            </button>
            <button onClick={() => onDelete(node)}
              className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded: card sub-rows + children */}
      {expanded && (
        <>
          {/* Card rows */}
          {isFetching ? (
            <tr className="border-b border-zinc-800/30">
              <td colSpan={5} style={{ paddingLeft: `${32 + indent}px` }} className="py-2">
                <div className="flex items-center gap-2 text-zinc-600 text-xs">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </div>
              </td>
            </tr>
          ) : cards.map(card => {
            const isGraded = card.purchase_type === 'pre_graded';
            const idCol = isGraded ? card.cert_number ?? '—' : card.raw_label ?? '—';
            return (
              <tr key={card.id} className="border-b border-zinc-800/30 bg-zinc-900/20 hover:bg-zinc-800/20 transition-colors">
                <td style={{ paddingLeft: `${32 + indent}px` }} className="py-2 pr-2">
                  {isGraded
                    ? <Star size={11} className="text-yellow-400/60" />
                    : <Package size={11} className="text-blue-400/60" />
                  }
                </td>
                {/* ID / Cert */}
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-zinc-400">{idCol}</span>
                </td>
                {/* Card name */}
                <td className="px-3 py-2 text-sm text-zinc-200 max-w-[220px] truncate">
                  {card.card_name ?? '—'}
                </td>
                {/* Set name */}
                <td className="px-3 py-2 text-xs text-zinc-400 max-w-[160px] truncate">
                  {card.set_name ?? '—'}
                </td>
                {/* Card # + qty */}
                <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
                  {card.card_number ?? '—'}
                  {card.quantity > 1 && <span className="ml-2 text-zinc-400">×{card.quantity}</span>}
                </td>
              </tr>
            );
          })}

          {/* Child location rows */}
          {node.children.map(child => (
            <LocationNodeRow
              key={child.id}
              node={child}
              allLocations={allLocations}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LocationManager() {
  const queryClient = useQueryClient();

  // Modal state: null = closed, { depth, parent } = open for create, { loc } = open for edit
  const [createModal, setCreateModal] = useState<{ parent: Location | null } | null>(null);
  const [editingLoc, setEditingLoc] = useState<Location | null>(null);
  const [deletingLoc, setDeletingLoc] = useState<Location | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const { data, isLoading } = useQuery<{ data: Location[] }>({
    queryKey: ['locations'],
    queryFn: () => api.get('/locations').then(r => r.data),
  });
  const locations = data?.data ?? [];
  const tree = buildTree(locations);

  const totalCards = locations.reduce((s, l) => s + l.total_count, 0);
  const rootCount = locations.filter(l => !l.parent_id).length;

  async function handleCreate(input: { name: string; card_type: LocationCardType; is_card_show: boolean; notes: string; parent_id?: string | null }) {
    setFormLoading(true);
    try {
      await api.post('/locations', input);
      toast.success('Location created');
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setCreateModal(null);
    } catch {
      toast.error('Failed to create location');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleEdit(input: { name: string; card_type: LocationCardType; is_card_show: boolean; notes: string }) {
    if (!editingLoc) return;
    setFormLoading(true);
    try {
      await api.patch(`/locations/${editingLoc.id}`, input);
      toast.success('Location updated');
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setEditingLoc(null);
    } catch {
      toast.error('Failed to update location');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete() {
    if (!deletingLoc) return;
    setFormLoading(true);
    try {
      await api.delete(`/locations/${deletingLoc.id}`);
      toast.success('Location deleted');
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setDeletingLoc(null);
      setDeleteConfirm('');
    } catch {
      toast.error('Failed to delete location');
    } finally {
      setFormLoading(false);
    }
  }

  // Compute depth for a location by walking up the flat list
  function getDepth(loc: Location): number {
    let depth = 0;
    let current = loc;
    while (current.parent_id) {
      const parent = locations.find(l => l.id === current.parent_id);
      if (!parent) break;
      depth++;
      current = parent;
    }
    return depth;
  }

  const createDepth = createModal ? (createModal.parent ? getDepth(createModal.parent) + 1 : 0) : 0;

  // Count children + cards that would be deleted
  function countDescendants(locId: string): number {
    const children = locations.filter(l => l.parent_id === locId);
    return children.reduce((sum, c) => sum + 1 + countDescendants(c.id), 0);
  }
  const descendantCount = deletingLoc ? countDescendants(deletingLoc.id) : 0;
  const affectedCards = deletingLoc
    ? locations
        .filter(l => l.id === deletingLoc.id || isDescendant(l, deletingLoc.id, locations))
        .reduce((s, l) => s + l.total_count, 0)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Location Manager</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {rootCount} location{rootCount !== 1 ? 's' : ''} · {totalCards} card{totalCards !== 1 ? 's' : ''} assigned
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateModal({ parent: null })}>
          <Plus size={14} /> Add Location
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-zinc-600">
            <MapPin size={32} strokeWidth={1} />
            <p className="text-sm">No locations set up yet</p>
            <Button size="sm" variant="ghost" onClick={() => setCreateModal({ parent: null })}>Create your first location</Button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="w-6" />
                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">ID / Cert</th>
                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Card Name</th>
                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Set</th>
                <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Card #</th>
              </tr>
            </thead>
            <tbody>
              {tree.map(node => (
                <LocationNodeRow
                  key={node.id}
                  node={node}
                  allLocations={locations}
                  onEdit={setEditingLoc}
                  onDelete={setDeletingLoc}
                  onAddChild={(parent) => setCreateModal({ parent })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      <Modal
        open={!!createModal}
        onClose={() => setCreateModal(null)}
        title={['Add Location', 'Add Sub-Location', 'Add Sub-Sub-Location', 'Add Level 4', 'Add Level 5'][createDepth] ?? 'Add Location'}
      >
        {createModal && (
          <LocationForm
            parentLocation={createModal.parent}
            depth={createDepth}
            onSave={handleCreate}
            onCancel={() => setCreateModal(null)}
            loading={formLoading}
          />
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editingLoc} onClose={() => setEditingLoc(null)} title="Edit Location">
        {editingLoc && (
          <LocationForm
            initial={editingLoc}
            depth={getDepth(editingLoc)}
            onSave={handleEdit}
            onCancel={() => setEditingLoc(null)}
            loading={formLoading}
          />
        )}
      </Modal>

      {/* Delete Confirm */}
      <Modal
        open={!!deletingLoc}
        onClose={() => { setDeletingLoc(null); setDeleteConfirm(''); }}
        title="Delete Location"
      >
        {deletingLoc && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              You are about to delete <span className="font-medium text-zinc-100">"{deletingLoc.name}"</span>.
            </p>
            {(descendantCount > 0 || affectedCards > 0) && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300 space-y-1">
                {descendantCount > 0 && (
                  <p><span className="font-medium">{descendantCount} sub-location{descendantCount !== 1 ? 's' : ''}</span> will also be permanently deleted.</p>
                )}
                {affectedCards > 0 && (
                  <p><span className="font-medium">{affectedCards} card{affectedCards !== 1 ? 's' : ''}</span> will be unassigned (cards themselves won't be deleted).</p>
                )}
              </div>
            )}
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">
                Type <span className="font-mono font-bold text-red-400">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                autoFocus
                className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-red-500 transition-colors font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setDeletingLoc(null); setDeleteConfirm(''); }}>Cancel</Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-500 text-white border-red-600 disabled:opacity-40"
                onClick={handleDelete}
                disabled={formLoading || deleteConfirm !== 'DELETE'}
              >
                {formLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function isDescendant(loc: Location, ancestorId: string, all: Location[]): boolean {
  if (!loc.parent_id) return false;
  if (loc.parent_id === ancestorId) return true;
  const parent = all.find(l => l.id === loc.parent_id);
  return parent ? isDescendant(parent, ancestorId, all) : false;
}
