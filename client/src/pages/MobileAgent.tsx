import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Send, Camera, ImageIcon, X, Loader2, LogOut } from 'lucide-react';
import { cn } from '../lib/utils';
import { api } from '../lib/api';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_TYPES = [...IMAGE_TYPES, 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].join(',');

const MAX_IMAGE_PX = 1600;
const IMAGE_QUALITY = 0.85;

function resizeImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(width, height));
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) { resolve(file); return; }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
      }, 'image/jpeg', IMAGE_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Shared with desktop AgentPanel
const STORAGE_KEY = 'reactor_agent_messages';
const MAX_STORED = 40;
const MAX_ATTACHMENTS = 5;

const RESOURCE_QUERY_KEYS: Record<string, string[]> = {
  sales:        ['sales', 'sale-filter-options', 'sales-summary', 'audit-log'],
  slabs:        ['inventory-slabs', 'card-name-search', 'card-copies', 'audit-log'],
  cards:        ['raw-overall', 'raw-inventory-grouped', 'raw-flat-filter-options', 'card-picker-grading', 'audit-log'],
  raw_purchases:['raw-overall', 'raw-inventory-grouped', 'audit-log'],
  grading:      ['grading-batches', 'grading-batch', 'grading-subs', 'grading-sub-detail', 'audit-log'],
  listings:     ['listings', 'listing-filter-options', 'audit-log'],
  trades:       ['trades', 'audit-log'],
  expenses:     ['expenses', 'audit-log'],
};

const SUGGESTIONS: { label: string; prompt: string }[] = [
  { label: '📦  Add a raw card purchase',        prompt: 'I want to log a new raw card purchase' },
  { label: '🏅  Add a graded card / slab',        prompt: 'I want to add a pre-graded card to inventory' },
  { label: '💰  Record a single sale',            prompt: 'I want to record a sale' },
  { label: '🎪  Record a card show bulk sale',    prompt: 'I want to record multiple card show sales at once' },
  { label: '📬  Submit cards to grading',         prompt: 'I want to submit cards to grading' },
  { label: '📬  Process a grading return',        prompt: 'I want to process cards returned from grading' },
  { label: '💸  Log an expense',                  prompt: 'I want to log an expense' },
  { label: '📋  Show inventory summary',          prompt: 'Show me a summary of my current inventory' },
  { label: '🎪  Show card show inventory',        prompt: 'Show me my card show inventory' },
  { label: '🔍  What\'s ready to sell?',          prompt: 'What cards are ready to sell?' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  imageUrls?: string[];
  timestamp?: string;
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Message[]).map(({ role, content }) => ({ role, content }));
  } catch { return []; }
}

function saveMessages(msgs: Message[]) {
  try {
    const toStore = msgs.slice(-MAX_STORED).map(({ role, content }) => ({ role, content }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch { /* ignore */ }
}

export function MobileAgent() {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    const toAdd = files.slice(0, remaining).filter(f => IMAGE_TYPES.includes(f.type));
    setAttachments(prev => [...prev, ...toAdd]);
    setPreviews(prev => [...prev, ...toAdd.map(f => URL.createObjectURL(f))]);
    e.target.value = '';
  }

  function removeAttachment(i: number) {
    URL.revokeObjectURL(previews[i]);
    setAttachments(prev => prev.filter((_, idx) => idx !== i));
    setPreviews(prev => prev.filter((_, idx) => idx !== i));
  }

  function clearAttachments(revoke = true) {
    if (revoke) previews.forEach(url => URL.revokeObjectURL(url));
    setAttachments([]);
    setPreviews([]);
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
  }

  function invalidateMutated(mutated: string[]) {
    const keys = new Set<string>();
    mutated.forEach(r => (RESOURCE_QUERY_KEYS[r] ?? []).forEach(k => keys.add(k)));
    keys.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || loading) return;
    setInput('');

    const imageUrls = previews.length > 0 ? [...previews] : undefined;
    const userContent = text || 'What is this?';
    const newMessages: Message[] = [...messages, {
      role: 'user',
      content: userContent,
      imageUrls,
      timestamp: new Date().toISOString(),
    }];
    setMessages(newMessages);
    clearAttachments(false);
    setLoading(true);

    try {
      const resized = await Promise.all(
        attachments.map(f => IMAGE_TYPES.includes(f.type) ? resizeImage(f) : Promise.resolve(f))
      );
      const form = new FormData();
      form.append('messages', JSON.stringify(newMessages.map(({ role, content }) => ({ role, content }))));
      resized.forEach(f => form.append('images', f));

      const { data } = await api.post('/agent/chat', form);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.data.reply,
        timestamp: new Date().toISOString(),
      }]);
      if (data.data.mutated?.length) invalidateMutated(data.data.mutated);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Try again.',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !loading;

  return (
    <div className="flex flex-col bg-zinc-950 text-zinc-100" style={{ height: '100svh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
            <Bot size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Reactor AI</p>
            <p className="text-xs text-zinc-500">Mobile · image upload &amp; agent ops</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-xs text-zinc-500 px-3 py-1.5 rounded-lg bg-zinc-800 active:bg-zinc-700">
              Clear
            </button>
          )}
          <button
            onClick={async () => { await api.post('/auth/logout').catch(() => {}); window.location.href = '/login'; }}
            className="w-9 h-9 rounded-lg bg-zinc-800 active:bg-zinc-700 flex items-center justify-center"
            title="Sign out"
          >
            <LogOut size={15} className="text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-5 pt-4">
            <div className="flex flex-col items-center gap-2 text-center px-4">
              <div className="w-14 h-14 rounded-full bg-indigo-600/20 flex items-center justify-center">
                <Bot size={24} className="text-indigo-400" />
              </div>
              <p className="text-base font-semibold text-zinc-200">Reactor AI — Mobile</p>
              <p className="text-sm text-zinc-500 leading-relaxed">
                Take a photo of a card and tell me what to do, or ask anything about your inventory.
              </p>
            </div>
            <div className="mx-2 rounded-xl bg-indigo-600/10 border border-indigo-600/30 px-4 py-3">
              <p className="text-xs font-semibold text-indigo-400 mb-1">Mobile version</p>
              <p className="text-xs text-zinc-400 leading-relaxed">This page is optimized for AI agent operations and image uploads from your phone. Use the camera or gallery buttons below to attach card photos, then describe what to do.</p>
            </div>
            <div className="space-y-2">
              {SUGGESTIONS.map(s => (
                <button key={s.label} onClick={() => { setInput(s.prompt); textRef.current?.focus(); }}
                  className="w-full text-left px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 active:bg-zinc-700">
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex flex-col gap-1', m.role === 'user' ? 'items-end' : 'items-start')}>
            <div className={cn(
              'max-w-[85%] rounded-2xl text-sm leading-relaxed overflow-hidden',
              m.role === 'user'
                ? 'bg-indigo-600 text-white rounded-br-sm'
                : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'
            )}>
              {m.imageUrls && m.imageUrls.length > 0 && (
                <div className={cn('grid gap-0.5', m.imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                  {m.imageUrls.map((url, idx) => (
                    <img key={idx} src={url} alt="" className="w-full max-h-64 object-cover" />
                  ))}
                </div>
              )}
              {(m.content && m.content !== 'What is this?') || !m.imageUrls?.length ? (
                <p className="px-4 py-3 whitespace-pre-wrap">{m.content}</p>
              ) : null}
            </div>
            {m.timestamp && (
              <span className="text-[10px] text-zinc-600 px-1">
                {new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 px-4 py-3 rounded-2xl rounded-bl-sm">
              <Loader2 size={16} className="animate-spin text-zinc-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Attachment previews */}
      {previews.length > 0 && (
        <div className="px-4 pb-2 flex items-center gap-2 overflow-x-auto shrink-0">
          {previews.map((url, i) => (
            <div key={i} className="relative shrink-0">
              <img src={url} alt="" className="h-16 w-16 object-cover rounded-xl border border-zinc-700" />
              <button onClick={() => removeAttachment(i)}
                className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-zinc-700 rounded-full flex items-center justify-center">
                <X size={11} className="text-zinc-300" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="shrink-0 px-3 pb-safe pt-2 pb-4 border-t border-zinc-800 bg-zinc-900">
        <div className="flex items-end gap-2">
          {/* Camera — opens camera directly */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment"
            className="hidden" onChange={onFileChange} />
          <button onClick={() => cameraRef.current?.click()}
            className="w-11 h-11 rounded-xl bg-zinc-800 active:bg-zinc-700 flex items-center justify-center shrink-0 border border-zinc-700">
            <Camera size={18} className="text-zinc-300" />
          </button>

          {/* Gallery */}
          <input ref={galleryRef} type="file" accept={ACCEPTED_TYPES} multiple
            className="hidden" onChange={onFileChange} />
          <button onClick={() => galleryRef.current?.click()}
            className="w-11 h-11 rounded-xl bg-zinc-800 active:bg-zinc-700 flex items-center justify-center shrink-0 border border-zinc-700">
            <ImageIcon size={18} className="text-zinc-300" />
          </button>

          <textarea
            ref={textRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={attachments.length > 0 ? 'Describe what to do…' : 'Message Reactor AI…'}
            className="flex-1 bg-zinc-800 text-zinc-100 text-sm rounded-xl px-4 py-2.5 resize-none outline-none placeholder:text-zinc-500 border border-zinc-700 focus:border-indigo-500 min-h-[44px] max-h-32"
          />

          <button onClick={send} disabled={!canSend}
            className="w-11 h-11 rounded-xl bg-indigo-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white flex items-center justify-center shrink-0 active:bg-indigo-500">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
