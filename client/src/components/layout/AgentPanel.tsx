import { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Loader2, Paperclip } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
}

const SUGGESTIONS = [
  'What is my inventory summary?',
  'Add a raw card purchase',
  'Record a sale',
  'Submit cards to grading',
  'Log an expense',
  'Show cards ready for sale',
];

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

  function clearAttachment(revokeUrl = true) {
    setAttachment(null);
    if (revokeUrl && preview) URL.revokeObjectURL(preview);
    setPreview(null);
  }

  async function sendText(text: string) {
    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const { data } = await api.post('/agent/chat', { messages: newMessages.map(({ role, content }) => ({ role, content })) });
      setMessages(prev => [...prev, { role: 'assistant', content: data.data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !attachment) || loading) return;
    setInput('');

    const imageUrl = preview ?? undefined;
    const userContent = text || 'What is this?';
    const newMessages: Message[] = [...messages, { role: 'user', content: userContent, imageUrl }];
    setMessages(newMessages);
    // Don't revoke the URL — it's now referenced by the message bubble
    clearAttachment(false);
    setLoading(true);

    try {
      // Always send through the agent chat — image gets attached as vision content
      const form = new FormData();
      // Strip imageUrl before sending to server (server doesn't need it)
      form.append('messages', JSON.stringify(newMessages.map(({ role, content }) => ({ role, content }))));
      if (attachment) form.append('image', attachment);

      const { data } = await api.post('/agent/chat', form);
      setMessages(prev => [...prev, { role: 'assistant', content: data.data.reply }]);
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
              <div className="flex flex-col gap-4 pt-2">
                <div className="flex flex-col items-center gap-2 text-center px-4 pt-2">
                  <div className="w-10 h-10 rounded-full bg-indigo-600/20 flex items-center justify-center">
                    <Bot size={18} className="text-indigo-400" />
                  </div>
                  <p className="text-sm font-medium text-zinc-200">Reactor AI</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">Ask about your inventory, log a purchase or sale, upload a card image, or check your P&L.</p>
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
                  {m.imageUrl && (
                    <img src={m.imageUrl} alt="attachment" className="w-full max-h-48 object-cover" />
                  )}
                  {(m.content && m.content !== 'What is this?') || !m.imageUrl ? (
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
