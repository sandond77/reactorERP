import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Send, X, Loader2, Paperclip } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';

// Maps server resource names → React Query key prefixes to invalidate
const RESOURCE_QUERY_KEYS: Record<string, string[]> = {
  sales:        ['sales', 'sale-filter-options', 'sales-summary'],
  slabs:        ['inventory-slabs', 'card-name-search', 'card-copies'],
  cards:        ['raw-overall', 'raw-inventory-grouped', 'raw-flat-filter-options', 'card-picker-grading'],
  raw_purchases:['raw-overall', 'raw-inventory-grouped'],
  grading:      ['grading-batches', 'grading-batch', 'grading-subs', 'grading-sub-detail'],
  expenses:     ['expenses'],
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  imageUrls?: string[];
}

const SUGGESTIONS = [
  'What is my inventory summary?',
  'Add a raw card purchase',
  'Record a sale',
  'Submit cards to grading',
  'Log an expense',
  'Show cards ready for sale',
];

const MAX_ATTACHMENTS = 5;
const STORAGE_KEY = 'reactor_agent_messages';
const MAX_STORED = 40;

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Message[];
    // Strip imageUrls — blob URLs don't survive page refresh
    return parsed.map(({ role, content }) => ({ role, content }));
  } catch { return []; }
}

function saveMessages(msgs: Message[]) {
  try {
    // Only persist role+content (no imageUrls), keep last MAX_STORED
    const toStore = msgs.slice(-MAX_STORED).map(({ role, content }) => ({ role, content }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch { /* storage full — ignore */ }
}

export function AgentPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  function clearChat() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    const toAdd = files.slice(0, remaining);
    setAttachments(prev => [...prev, ...toAdd]);
    setPreviews(prev => [...prev, ...toAdd.map(f => URL.createObjectURL(f))]);
    e.target.value = '';
  }

  function removeAttachment(i: number) {
    setPreviews(prev => { URL.revokeObjectURL(prev[i]); return prev.filter((_, idx) => idx !== i); });
    setAttachments(prev => prev.filter((_, idx) => idx !== i));
  }

  function clearAttachments(revoke = true) {
    if (revoke) previews.forEach(URL.revokeObjectURL);
    setAttachments([]);
    setPreviews([]);
    if (fileRef.current) fileRef.current.value = '';
  }

  function invalidateMutated(mutated: string[]) {
    const keys = new Set<string>();
    mutated.forEach((r) => (RESOURCE_QUERY_KEYS[r] ?? []).forEach((k) => keys.add(k)));
    keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

  async function sendText(text: string) {
    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const { data } = await api.post('/agent/chat', { messages: newMessages.map(({ role, content }) => ({ role, content })) });
      setMessages(prev => [...prev, { role: 'assistant', content: data.data.reply }]);
      if (data.data.mutated?.length) invalidateMutated(data.data.mutated);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || loading) return;
    setInput('');

    const imageUrls = previews.length > 0 ? [...previews] : undefined;
    const userContent = text || 'What is this?';
    const newMessages: Message[] = [...messages, { role: 'user', content: userContent, imageUrls }];
    setMessages(newMessages);
    // Keep URLs alive for message bubbles — clear state without revoking
    clearAttachments(false);
    setLoading(true);

    try {
      const form = new FormData();
      form.append('messages', JSON.stringify(newMessages.map(({ role, content }) => ({ role, content }))));
      attachments.forEach(f => form.append('images', f));

      const { data } = await api.post('/agent/chat', form);
      setMessages(prev => [...prev, { role: 'assistant', content: data.data.reply }]);
      if (data.data.mutated?.length) invalidateMutated(data.data.mutated);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-16 right-5 z-50 w-96 flex flex-col bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden"
          style={{ height: '520px' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 bg-zinc-800 border-b border-zinc-700">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100">Reactor AI</p>
                <p className="text-xs text-zinc-400">Inventory assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {messages.length > 0 && (
                <button onClick={clearChat} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                  Clear
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-200 transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 flex flex-col gap-3 px-4 py-4 overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col gap-4 pt-2">
                <div className="flex flex-col items-center gap-2 text-center px-4 pt-2">
                  <div className="w-10 h-10 rounded-full bg-indigo-600/20 flex items-center justify-center">
                    <Bot size={18} className="text-indigo-400" />
                  </div>
                  <p className="text-sm font-medium text-zinc-200">Reactor AI</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">Ask about your inventory, log a purchase or sale, upload a card image, or check your P&amp;L.</p>
                </div>
                <div className="px-2">
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2 px-1">Suggestions</p>
                  <div className="flex flex-col gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => sendText(s)}
                        disabled={loading}
                        className="w-full text-left px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-sm text-zinc-300 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[80%] rounded-2xl text-sm leading-relaxed overflow-hidden',
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'
                )}>
                  {m.imageUrls && m.imageUrls.length > 0 && (
                    <div className={cn('grid gap-0.5', m.imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                      {m.imageUrls.map((url, idx) => (
                        <img key={idx} src={url} alt={`attachment ${idx + 1}`} className="w-full max-h-40 object-cover" />
                      ))}
                    </div>
                  )}
                  {(m.content && m.content !== 'What is this?') || !m.imageUrls?.length ? (
                    <p className="px-4 py-2.5 whitespace-pre-wrap">{m.content}</p>
                  ) : null}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-zinc-800 text-zinc-400 px-4 py-3 rounded-2xl rounded-bl-sm">
                  <Loader2 size={14} className="animate-spin" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Attachment previews */}
          {previews.length > 0 && (
            <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
              {previews.map((url, i) => (
                <div key={i} className="relative shrink-0">
                  <img src={url} alt="attachment" className="h-14 w-14 object-cover rounded-lg border border-zinc-700" />
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-700 hover:bg-zinc-600 rounded-full flex items-center justify-center"
                  >
                    <X size={10} className="text-zinc-300" />
                  </button>
                </div>
              ))}
              {attachments.length < MAX_ATTACHMENTS && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="h-14 w-14 rounded-lg border border-dashed border-zinc-600 hover:border-indigo-500 flex items-center justify-center text-zinc-500 hover:text-indigo-400 transition-colors shrink-0"
                >
                  <Paperclip size={14} />
                </button>
              )}
            </div>
          )}

          {/* Input */}
          <div className="flex items-end gap-2 px-4 py-4 border-t border-zinc-700 bg-zinc-800/50">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={onFileChange}
            />
            {previews.length === 0 && (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-10 h-10 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors shrink-0"
                title="Attach images"
              >
                <Paperclip size={16} />
              </button>
            )}
            <textarea
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={attachments.length > 0 ? 'Describe what to do with these images…' : 'Message Reactor AI…'}
              className="flex-1 bg-zinc-800 text-zinc-200 text-sm rounded-xl px-4 py-2.5 resize-none outline-none placeholder:text-zinc-500 border border-zinc-700 focus:border-indigo-500 transition-colors min-h-[42px] max-h-32"
            />
            <button
              onClick={send}
              disabled={(!input.trim() && attachments.length === 0) || loading}
              className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white flex items-center justify-center transition-colors shrink-0"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg transition-colors',
          open
            ? 'bg-indigo-600 text-white'
            : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700'
        )}
      >
        <Bot size={15} />
        <span>AI Agent</span>
      </button>
    </>
  );
}
