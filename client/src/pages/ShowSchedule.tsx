import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { cn } from '../lib/utils';

interface CardShow {
  id: string;
  name: string;
  location: string | null;
  show_date: string;
  end_date: string | null;
  num_days: number;
  num_tables: number | null;
  notes: string | null;
  created_at: string;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function fmtDateRange(show: CardShow) {
  if (show.num_days > 1 && show.end_date) {
    return `${fmtDate(show.show_date)} – ${fmtDate(show.end_date)}`;
  }
  return fmtDate(show.show_date);
}

const today = new Date().toISOString().split('T')[0];

function isCurrent(show: CardShow) {
  return show.show_date <= today && (show.end_date ? show.end_date >= today : show.show_date === today);
}

function isUpcoming(show: CardShow) {
  return show.show_date > today;
}

// ── Form ──────────────────────────────────────────────────────────────────────

interface FormData {
  name: string; location: string; show_date: string; end_date: string;
  num_days: number; num_tables: string; notes: string;
}

interface ShowFormProps {
  initial?: Partial<CardShow>;
  onSave: (data: FormData) => void;
  onCancel: () => void;
  saving: boolean;
}

const dateInput = 'w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]';
const stepperBtn = 'w-7 h-full flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors text-base leading-none select-none';

function computeEndDate(startDate: string, days: number): string {
  if (!startDate || days <= 1) return '';
  const d = new Date(startDate + 'T00:00:00');
  d.setDate(d.getDate() + days - 1);
  return d.toISOString().split('T')[0];
}

function ShowForm({ initial, onSave, onCancel, saving }: ShowFormProps) {
  const [name, setName]           = useState(initial?.name ?? '');
  const [location, setLocation]   = useState(initial?.location ?? '');
  const [numDays, setNumDays]     = useState(initial?.num_days ?? 1);
  const [showDate, setShowDate]   = useState(initial?.show_date?.slice(0, 10) ?? '');
  const [endDate, setEndDate]     = useState(initial?.end_date?.slice(0, 10) ?? '');
  const [numTables, setNumTables] = useState(initial?.num_tables != null ? String(Number(initial.num_tables)) : '1');
  const [notes, setNotes]         = useState(initial?.notes ?? '');

  const multiDay = numDays > 1;

  function handleNumDays(val: number) {
    const days = Math.max(1, val);
    setNumDays(days);
    setEndDate(computeEndDate(showDate, days));
  }

  function handleStartDate(val: string) {
    setShowDate(val);
    setEndDate(computeEndDate(val, numDays));
  }

  return (
    <div className="space-y-3">
      <Input label="Show Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Collect-A-Con" autoFocus />
      <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Fort Worth Convention Center" />

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide"># of Days</label>
          <div className="flex rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden h-9">
            <button type="button" className={stepperBtn} onClick={() => handleNumDays(numDays - 1)}>−</button>
            <input
              type="number" min="1" step="1"
              value={numDays}
              onChange={(e) => handleNumDays(parseInt(e.target.value) || 1)}
              className="flex-1 bg-transparent text-sm text-zinc-100 text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button type="button" className={stepperBtn} onClick={() => handleNumDays(numDays + 1)}>+</button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide"># of Tables</label>
          <input
            type="number" min="0.5" step="0.5"
            value={numTables}
            onChange={(e) => setNumTables(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>

      {multiDay ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Start Date</label>
            <input type="date" value={showDate} onChange={(e) => handleStartDate(e.target.value)} className={dateInput} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">End Date</label>
            <input type="date" value={endDate} readOnly className={dateInput + ' opacity-60 cursor-not-allowed'} tabIndex={-1} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Date</label>
          <input type="date" value={showDate} onChange={(e) => handleStartDate(e.target.value)} className={dateInput} />
        </div>
      )}

      <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        <Button
          type="button"
          disabled={saving || !name || !showDate || (multiDay && !endDate)}
          onClick={() => onSave({ name, location, show_date: showDate, end_date: endDate, num_days: numDays, num_tables: numTables.toString(), notes })}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ShowSchedule() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd]       = useState(false);
  const [editing, setEditing]       = useState<CardShow | null>(null);
  const [deleting, setDeleting]     = useState<CardShow | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archiveRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<{ data: CardShow[] }>({
    queryKey: ['card-shows'],
    queryFn: () => api.get('/card-shows').then((r) => r.data),
  });

  const shows = data?.data ?? [];

  function toPayload(d: FormData) {
    return {
      name: d.name,
      location: d.location || null,
      show_date: d.show_date,
      end_date: d.num_days > 1 ? (d.end_date || null) : null,
      num_days: d.num_days,
      num_tables: d.num_tables ? parseFloat(d.num_tables) : null,
      notes: d.notes || null,
    };
  }

  const createMut = useMutation({
    mutationFn: (d: FormData) => api.post('/card-shows', toPayload(d)).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['card-shows'] }); setShowAdd(false); toast.success('Show added'); },
    onError: () => toast.error('Failed to add show'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...d }: FormData & { id: string }) => api.patch(`/card-shows/${id}`, toPayload(d)).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['card-shows'] }); setEditing(null); toast.success('Show updated'); },
    onError: () => toast.error('Failed to update show'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/card-shows/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['card-shows'] }); setDeleting(null); toast.success('Show deleted'); },
    onError: () => toast.error('Failed to delete show'),
  });

  const current   = shows.filter((s) => isCurrent(s));
  const upcoming  = shows.filter((s) => isUpcoming(s));
  const past      = shows.filter((s) => !isCurrent(s) && !isUpcoming(s));
  const recentPast   = past.slice(0, 5);
  const archivedPast = past.slice(5);

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Show Schedule</h1>
        <Button onClick={() => setShowAdd(true)}><Plus size={14} /> Add Show</Button>
      </div>

      {isLoading ? (
        <div className="text-zinc-500 text-sm py-8">Loading…</div>
      ) : shows.length === 0 ? (
        <Card><p className="text-sm text-zinc-500 text-center py-8">No shows yet. Add your first card show.</p></Card>
      ) : (
        <>
          {current.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest">Today</p>
              {current.map((show) => (
                <ShowRow key={show.id} show={show} onEdit={() => setEditing(show)} onDelete={() => setDeleting(show)} current />
              ))}
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Upcoming</p>
              {upcoming.map((show) => (
                <ShowRow key={show.id} show={show} onEdit={() => setEditing(show)} onDelete={() => setDeleting(show)} />
              ))}
            </div>
          )}
          {past.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Past</p>
              {recentPast.map((show) => (
                <ShowRow key={show.id} show={show} onEdit={() => setEditing(show)} onDelete={() => setDeleting(show)} />
              ))}
              {archivedPast.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setArchiveOpen((o) => !o)}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1"
                  >
                    <ChevronDown size={13} className={`transition-transform ${archiveOpen ? 'rotate-180' : ''}`} />
                    Archived ({archivedPast.length})
                  </button>
                  <div
                    ref={archiveRef}
                    className="overflow-hidden transition-all duration-200"
                    style={{ maxHeight: archiveOpen ? '9999px' : 0 }}
                  >
                    <div className="space-y-2 pt-1">
                      {archivedPast.map((show) => (
                        <ShowRow key={show.id} show={show} onEdit={() => setEditing(show)} onDelete={() => setDeleting(show)} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Modal open={showAdd} title="Add Card Show" onClose={() => setShowAdd(false)}>
        <ShowForm onSave={(d) => createMut.mutate(d)} onCancel={() => setShowAdd(false)} saving={createMut.isPending} />
      </Modal>

      <Modal open={!!editing} title="Edit Card Show" onClose={() => setEditing(null)}>
        {editing && (
          <ShowForm
            initial={editing}
            onSave={(d) => updateMut.mutate({ id: editing.id, ...d })}
            onCancel={() => setEditing(null)}
            saving={updateMut.isPending}
          />
        )}
      </Modal>

      <Modal open={!!deleting} title="Delete Show" onClose={() => setDeleting(null)}>
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Delete <span className="font-semibold text-zinc-100">{deleting.name}</span>? Sales linked to this show will lose the association but won't be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(deleting.id)}>
                {deleteMut.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function ShowRow({ show, onEdit, onDelete, current }: { show: CardShow; onEdit: () => void; onDelete: () => void; current?: boolean }) {
  const upcoming = isUpcoming(show);
  return (
    <Card className="flex items-center gap-4">
      <div className={cn('w-1 self-stretch rounded-full shrink-0', current ? 'bg-emerald-500' : upcoming ? 'bg-indigo-500' : 'bg-zinc-700')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-zinc-100">{show.name}</p>
          {current && <span className="text-[10px] bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded px-1.5 py-0.5 font-medium">Today</span>}
          {upcoming && <span className="text-[10px] bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 rounded px-1.5 py-0.5 font-medium">Upcoming</span>}
          {show.num_days > 1 && <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 rounded px-1.5 py-0.5">{show.num_days} days</span>}
          {show.num_tables != null && <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 rounded px-1.5 py-0.5">{Number(show.num_tables)} {Number(show.num_tables) === 1 ? 'table' : 'tables'}</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-500">
          <span>{fmtDateRange(show)}</span>
          {show.location && <span>· {show.location}</span>}
          {show.notes && <span>· {show.notes}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onEdit} className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
          <Pencil size={13} />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
    </Card>
  );
}
