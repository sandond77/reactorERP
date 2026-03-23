import { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Loader2, Paperclip } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function AgentPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachment(file);
    setPreview(URL.createObjectURL(file));
    e.target.value = '';
  }

  function clearAttachment() {
    setAttachment(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  }

  function detectHint(text: string): 'purchase' | 'sale' | undefined {
    const lower = text.toLowerCase();
    if (/sale|sold|selling/.test(lower)) return 'sale';
    if (/purchase|bought|receipt|intake/.test(lower)) return 'purchase';
    return undefined;
  }

  async function send() {
    const text = input.trim();
    if ((!text && !attachment) || loading) return;
    setInput('');

    const userContent = text || (attachment ? `[Image: ${attachment.name}]` : '');
    const newMessages: Message[] = [...messages, { role: 'user', content: userContent }];
    setMessages(newMessages);
    setLoading(true);

    try {
      if (attachment) {
        const form = new FormData();
        form.append('image', attachment);
        const hint = detectHint(text);
        if (hint) form.append('hint', hint);
        if (text) form.append('note', text);

        clearAttachment();
        const { data } = await api.post('/agent/parse-receipt', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const result = data.data;
        const lines: string[] = [];
        if (result.order_number) lines.push(`Order #: ${result.order_number}`);
        if (result.date) lines.push(`Date: ${result.date}`);
        if (result.platform) lines.push(`Platform: ${result.platform}`);
        if (result.cards?.length) {
          lines.push(`\nCards found (${result.cards.length}):`);
          result.cards.forEach((c: Record<string, string | number>, i: number) => {
            const parts = [`${i + 1}. ${c.card_name ?? 'Unknown'}`];
            if (c.set_name) parts.push(c.set_name as string);
            if (c.card_number) parts.push(`#${c.card_number}`);
            if (c.cost) parts.push(`$${c.cost}`);
            if (c.grade) parts.push(`Grade: ${c.grade}`);
            lines.push(parts.join(' — '));
          });
        }
        if (result.notes) lines.push(`\nNotes: ${result.notes}`);
        lines.push(`\nConfidence: ${result.confidence}`);
        setMessages(prev => [...prev, { role: 'assistant', content: lines.join('\n') }]);
      } else {
        const { data } = await api.post('/agent/chat', { messages: newMessages });
        setMessages(prev => [...prev, { role: 'assistant', content: data.data.reply }]);
      }
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
      {/* Floating chat popup */}
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
            <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-200 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 flex flex-col gap-3 px-4 py-4 overflow-y-auto">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                <div className="w-12 h-12 rounded-full bg-indigo-600/20 flex items-center justify-center">
                  <Bot size={22} className="text-indigo-400" />
                </div>
                <p className="text-sm font-medium text-zinc-300">How can I help?</p>
                <p className="text-xs text-zinc-500">Ask about your inventory, P&L, or upload a receipt/image to scan.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'
                )}>
                  {m.content}
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

          {/* Image preview */}
          {preview && (
            <div className="px-4 pb-2 flex items-center gap-2">
              <div className="relative inline-block">
                <img src={preview} alt="attachment" className="h-16 w-16 object-cover rounded-lg border border-zinc-700" />
                <button
                  onClick={clearAttachment}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-700 hover:bg-zinc-600 rounded-full flex items-center justify-center"
                >
                  <X size={10} className="text-zinc-300" />
                </button>
              </div>
              <p className="text-xs text-zinc-400 truncate max-w-[240px]">{attachment?.name}</p>
            </div>
          )}

          {/* Input */}
          <div className="flex items-end gap-2 px-4 py-4 border-t border-zinc-700 bg-zinc-800/50">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onFileChange}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-10 h-10 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors shrink-0"
              title="Attach image"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={attachment ? 'Describe what to do with this image…' : 'Message Reactor AI…'}
              className="flex-1 bg-zinc-800 text-zinc-200 text-sm rounded-xl px-4 py-2.5 resize-none outline-none placeholder:text-zinc-500 border border-zinc-700 focus:border-indigo-500 transition-colors min-h-[42px] max-h-32"
            />
            <button
              onClick={send}
              disabled={(!input.trim() && !attachment) || loading}
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
