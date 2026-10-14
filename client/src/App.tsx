import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

type User = { id: string; name: string; email: string; lastSeen?: string };
type Conversation = { id: string; user: User; lastMessage: string; lastMessageAt: string };

type Reaction = {
  userId: string;
  emoji: string;
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  readBy: string[];
  createdAt: string;
  isDeletedForEveryone?: boolean;
  messageType?: 'text' | 'image' | 'file';
  attachment?: {
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
  } | null;
  replyTo?: string | null;
  reactions?: Reaction[];
};

type AuthResult = { token: string; user: User };

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('cl_token') || '');
  const [me, setMe] = useState<User | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(false);
  const [typing, setTyping] = useState(false);
  const [dark, setDark] = useState(true);

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | undefined>(undefined);

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }, [token]);

  const loadConversations = useCallback(async () => {
    const data = await api('/conversations');
    setConversations(data.conversations);
    setActive(current =>
      current
        ? data.conversations.find((c: Conversation) => c.id === current.id) || current
        : null
    );
  }, [api]);

  const loadMessages = useCallback(async (conversation: Conversation) => {
    const data = await api(`/conversations/${conversation.id}/messages?limit=80`);
    setMessages(data.messages);
    setSelectedMessageIds([]);
    setSelectionMode(false);
    socketRef.current?.emit('conversation:join', conversation.id);
    await api(`/conversations/${conversation.id}/read`, { method: 'POST' }).catch(() => {});
  }, [api]);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }

    api('/auth/me')
      .then(d => setMe(d.user))
      .catch(() => {
        localStorage.removeItem('cl_token');
        setToken('');
        setMe(null);
      });
  }, [token, api]);

  useEffect(() => {
    if (!token || !me) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setOnline(true));
    socket.on('disconnect', () => setOnline(false));
    socket.on('connect_error', e => setError(e.message || 'Live connection failed.'));

    socket.on('message:new', (message: Message) => {
      if (message.conversationId === active?.id) {
        setMessages(old => old.some(m => m.id === message.id) ? old : [...old, message]);
        if (message.senderId !== me.id) {
          api(`/conversations/${message.conversationId}/read`, { method: 'POST' }).catch(() => {});
        }
      }
      loadConversations().catch(() => {});
    });

    socket.on('typing:update', (d: { conversationId: string; userId: string; typing: boolean }) => {
      if (d.conversationId === active?.id && d.userId !== me.id) setTyping(d.typing);
    });

    socket.on('messages:read', (d: { conversationId: string; userId: string }) => {
      if (d.conversationId === active?.id && d.userId !== me.id) {
        setMessages(old => old.map(m => ({
          ...m,
          readBy: m.readBy.includes(d.userId) ? m.readBy : [...m.readBy, d.userId],
        })));
      }
    });
        
    socket.on(
      'message:reaction-updated',
      (data: {
        conversationId: string;
        messageId: string;
        reactions: Reaction[];
      }) => {
        console.log('REACTION EVENT RECEIVED:', data);

        setMessages(old =>
          old.map(m =>
            m.id === data.messageId &&
            m.conversationId === data.conversationId
              ? { ...m, reactions: data.reactions }
              : m
          )
        );
      }
    );

    socket.on('message:deleted-for-me', (data: {
      conversationId: string;
      messageId: string;
      userId: string;
    }) => {
      if (data.userId !== me.id) return;

      setMessages(old => old.filter(
        m => !(m.id === data.messageId && m.conversationId === data.conversationId)
      ));
      setSelectedMessageIds(old => old.filter(id => id !== data.messageId));
      loadConversations().catch(() => {});
    });

    socket.on('message:deleted-for-everyone', (data: {
      conversationId: string;
      messageId: string;
      text: string;
      isDeletedForEveryone: boolean;
    }) => {
      setMessages(old =>
        old.map(m =>
          m.id === data.messageId &&
          m.conversationId === data.conversationId
            ? {
                ...m,
                text: data.text,
                isDeletedForEveryone: data.isDeletedForEveryone,
              }
            : m
        )
      );

      setSelectedMessageIds(old =>
        old.filter(id => id !== data.messageId)
      );

      setSelectedMessage(current =>
        current?.id === data.messageId ? null : current
      );

      loadConversations().catch(() => {});
    });

    socket.on('message:deleted-for-everyone', (data: {
      conversationId: string;
      messageId: string;
      text: string;
      isDeletedForEveryone: boolean;
    }) => {
      setMessages(old => old.map(m =>
        m.id === data.messageId && m.conversationId === data.conversationId
          ? { ...m, text: data.text, isDeletedForEveryone: true }
          : m
      ));
      setSelectedMessageIds(old => old.filter(id => id !== data.messageId));
      loadConversations().catch(() => {});
    });

    return () => {
      socket.off('message:reaction-updated');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, me, active?.id, api, loadConversations]);

  useEffect(() => {
    if (token && me) loadConversations().catch(e => setError(e.message));
  }, [token, me, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  async function authenticate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const response = await fetch(`${API}/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data: AuthResult = await response.json();
      if (!response.ok || !data.token) {
        throw new Error((data as any).error || 'Could not sign in.');
      }

      localStorage.setItem('cl_token', data.token);
      setToken(data.token);
      setMe(data.user);
      setPassword('');
    } catch (e: any) {
      setError(e.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  async function addConnection(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const data = await api('/connections', {
        method: 'POST',
        body: JSON.stringify({ email: addEmail }),
      });

      setAddOpen(false);
      setAddEmail('');
      await loadConversations();

      const found = (await api('/conversations')).conversations.find(
        (c: Conversation) => c.id === data.conversationId
      );

      if (found) {
        setActive(found);
        await loadMessages(found);
      }

      setNotice(`Connected with ${data.user.name}`);
      window.setTimeout(() => setNotice(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectConversation(c: Conversation) {
    setActive(c);
    setTyping(false);
    setSelectedMessageIds([]);
    setSelectionMode(false);

    try {
      await loadMessages(c);
    } catch (e: any) {
      setError(e.message);
    }
  }
  
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !draft.trim()) return;

    const text = draft.trim();
    const replyToId = replyingTo?.id || null;

    setDraft('');
    socketRef.current?.emit('typing:stop', active.id);

    try {
      await api(`/conversations/${active.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text,
          replyTo: replyToId,
        }),
      });

      setReplyingTo(null);
    } catch (e: any) {
      setDraft(text);
      setError(e.message || 'Could not send message.');
    }
  }

  function toggleMessageSelection(message: Message) {
    if (message.isDeletedForEveryone) return;

    setSelectionMode(true);
    setSelectedMessageIds(old =>
      old.includes(message.id)
        ? old.filter(id => id !== message.id)
        : [...old, message.id]
    );
    setSelectedMessage(null);
  }

  function cancelSelection() {
    setSelectedMessageIds([]);
    setSelectionMode(false);
  }

  function selectAllMessages() {
    const selectable = messages
      .filter(m => !m.isDeletedForEveryone)
      .map(m => m.id);
    setSelectedMessageIds(selectable);
    setSelectionMode(true);
  }

  async function deleteSelectedMessages(scope: 'me' | 'everyone') {
    if (!active || !me || deleting || selectedMessageIds.length === 0) return;

    const selectedMessages = messages.filter(m => selectedMessageIds.includes(m.id));
    if (selectedMessages.length === 0) return;

    if (scope === 'everyone' && selectedMessages.some(m => m.senderId !== me.id)) {
      setError('Delete for everyone is only available for your own messages. Select only your messages.');
      return;
    }

    const prompt = scope === 'me'
      ? `Delete ${selectedMessages.length} selected message(s) only for you?`
      : `Delete ${selectedMessages.length} selected message(s) for everyone?`;

    if (!window.confirm(prompt)) return;

    setDeleting(true);
    setError('');

    const failedIds: string[] = [];
    const deletedForMe: string[] = [];
    const deletedForEveryone: string[] = [];

    try {
      for (const message of selectedMessages) {
        try {
          const endpoint = scope === 'me' ? 'delete-for-me' : 'delete-for-everyone';
          await api(
            `/conversations/${active.id}/messages/${message.id}/${endpoint}`,
            { method: 'PATCH' }
          );

          if (scope === 'me') deletedForMe.push(message.id);
          else deletedForEveryone.push(message.id);
        } catch {
          failedIds.push(message.id);
        }
      }

      if (scope === 'me') {
        setMessages(old => old.filter(m => !deletedForMe.includes(m.id)));
      } else {
        setMessages(old => old.map(m =>
          deletedForEveryone.includes(m.id)
            ? { ...m, text: 'This message was deleted', isDeletedForEveryone: true }
            : m
        ));
      }

      setSelectedMessageIds(failedIds);
      if (failedIds.length === 0) {
        cancelSelection();
        setNotice(`${selectedMessages.length} message(s) deleted`);
      } else {
        setError(`${failedIds.length} message(s) could not be deleted. Select them and try again.`);
      }

      window.setTimeout(() => setNotice(''), 3000);
      await loadConversations();
    } catch (e: any) {
      setError(e.message || 'Could not delete selected messages.');
    } finally {
      setDeleting(false);
    }
  }

  async function deleteMessage(message: Message, scope: 'me' | 'everyone') {
    if (!active || !me || deleting) return;

    if (scope === 'everyone' && message.senderId !== me.id) {
      setError('You can only delete your own message for everyone.');
      return;
    }

    const confirmed = window.confirm(
      scope === 'me'
        ? 'Delete this message only for you?'
        : 'Delete this message for everyone?'
    );

    if (!confirmed) return;

    setDeleting(true);
    setError('');

    try {
      const endpoint = scope === 'me' ? 'delete-for-me' : 'delete-for-everyone';
      await api(
        `/conversations/${active.id}/messages/${message.id}/${endpoint}`,
        { method: 'PATCH' }
      );

      if (scope === 'me') {
        setMessages(old =>
          old.filter(m => m.id !== message.id)
        );

        setSelectedMessageIds(old =>
          old.filter(id => id !== message.id)
        );
      } else {
        setMessages(old =>
          old.map(m =>
            m.id === message.id
              ? {
                  ...m,
                  text: 'This message was deleted',
                  isDeletedForEveryone: true,
                }
              : m
          )
        );
      }

      setSelectedMessage(null);
      setNotice('Message deleted');
      window.setTimeout(() => setNotice(''), 2500);
      await loadConversations();
    } catch (e: any) {
      setError(e.message || 'Could not delete message.');
    } finally {
      setDeleting(false);
    }
  }

  function handleDraft(value: string) {
    setDraft(value);
    if (!active) return;

    socketRef.current?.emit(value.trim() ? 'typing:start' : 'typing:stop', active.id);
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(
      () => socketRef.current?.emit('typing:stop', active.id),
      1200
    );
  }

  function logout() {
    socketRef.current?.disconnect();
    localStorage.removeItem('cl_token');
    setToken('');
    setMe(null);
    setActive(null);
    setConversations([]);
    setMessages([]);
    cancelSelection();
  }

  const initials = (s: string) =>
    s.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();

  const fmt = (s: string) =>
    new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const selectableMessages = messages.filter(m => !m.isDeletedForEveryone);
  const allSelected = selectableMessages.length > 0 &&
    selectableMessages.every(m => selectedMessageIds.includes(m.id));

  if (!me) {
    return (
      <main className={`auth-page ${dark ? 'dark' : 'light'}`}>
        <div className="auth-decoration decor-one" />
        <div className="auth-decoration decor-two" />
        <section className="auth-card">
          <div className="brand-mark">C<span>✦</span></div>
          <p className="eyebrow">YOUR SPACE TO CONNECT</p>
          <h1>{mode === 'login' ? 'Welcome back.' : 'Create your space.'}</h1>
          <p className="muted">Private conversations, in real time.</p>

          <form onSubmit={authenticate} className="auth-form">
            {mode === 'register' && (
              <label>Full name
                <input required minLength={2} maxLength={60} value={name}
                  onChange={e => setName(e.target.value)} placeholder="Your name" />
              </label>
            )}
            <label>Email address
              <input required type="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <label>Password
              <input required minLength={8} type="password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <span>↗</span>
            </button>
          </form>

          <p className="switch-auth">
            {mode === 'login' ? 'New to ConnectLive?' : 'Already have an account?'}
            {' '}
            <button className="link" onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}>
              {mode === 'login' ? 'Create account' : 'Sign in'}
            </button>
          </p>
          <p className="tiny muted">By continuing, you agree to use this service responsibly.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${dark ? 'dark' : 'light'}`}>
      <aside className={`sidebar ${active ? 'mobile-hidden' : ''}`}>
        <header className="side-header">
          <div className="brand-inline">
            <div className="brand-mark small">C<span>✦</span></div>
            <div><strong>connectlive</strong><small>private messaging</small></div>
          </div>
          <div className="header-actions">
            <button className="icon-btn" title="Toggle theme" onClick={() => setDark(!dark)}>
              {dark ? '☼' : '☾'}
            </button>
            <button className="icon-btn add-btn" title="Add connection" onClick={() => {
              setAddOpen(true);
              setError('');
            }}>＋</button>
          </div>
        </header>

        <div className="me-card">
          <div className="avatar">{initials(me.name)}</div>
          <div className="me-meta"><strong>{me.name}</strong><small>{me.email}</small></div>
          <button className="icon-btn" title="Log out" onClick={logout}>↪</button>
        </div>

        <div className="list-heading">
          <span>MESSAGES</span>
          <span>{conversations.length.toString().padStart(2, '0')}</span>
        </div>

        <div className="conversation-list">
          {conversations.map(c => (
            <button key={c.id}
              className={`conversation ${active?.id === c.id ? 'selected' : ''}`}
              onClick={() => selectConversation(c)}>
              <div className="avatar">{initials(c.user.name)}<i className="presence" /></div>
              <div className="conversation-copy">
                <div className="conversation-top">
                  <strong>{c.user.name}</strong>
                  <time>{c.lastMessageAt ? fmt(c.lastMessageAt) : ''}</time>
                </div>
                <p>{c.lastMessage || 'Start a conversation'}</p>
                <small>{c.user.email}</small>
              </div>
            </button>
          ))}

          {!conversations.length && (
            <div className="empty-list">
              <div className="empty-icon">＋</div>
              <strong>Your space is quiet</strong>
              <p>Add a connection by email to start chatting.</p>
              <button className="secondary" onClick={() => setAddOpen(true)}>
                Add your first connection
              </button>
            </div>
          )}
        </div>

        <footer className="side-footer">
          <span className={`status-dot ${online ? 'on' : ''}`} />
          {online ? 'Live connection active' : 'Connecting…'}
          <span className="footer-version">CONNECTLIVE</span>
        </footer>
      </aside>

      <section className={`chat-panel ${!active ? 'mobile-hidden' : ''}`}>
        {active ? (
          <>
            <header className="chat-header">
              <button className="back-btn" onClick={() => {
                setActive(null);
                cancelSelection();
              }}>←</button>
              <div className="avatar large">{initials(active.user.name)}<i className="presence" /></div>
              <div className="chat-user">
                <strong>{active.user.name}</strong>
                <small>{typing ? 'typing…' : online ? 'Connected to chat' : 'Messages are saved'}</small>
              </div>
              <div className="secure-label"><span>◈</span> PRIVATE CHAT</div>
            </header>

            {selectionMode && (
              <div className="bulk-select-toolbar">
                <span>{selectedMessageIds.length} selected</span>
                <button className="secondary" type="button" onClick={allSelected ? cancelSelection : selectAllMessages}>
                  {allSelected ? 'Clear selection' : 'Select all'}
                </button>
                <button className="secondary" type="button" disabled={!selectedMessageIds.length || deleting}
                  onClick={() => deleteSelectedMessages('me')}>
                  Delete for me
                </button>
                <button className="primary" type="button" disabled={!selectedMessageIds.length || deleting ||
                  messages.some(m => selectedMessageIds.includes(m.id) && m.senderId !== me.id)}
                  onClick={() => deleteSelectedMessages('everyone')}>
                  Delete for everyone
                </button>
                <button className="secondary" type="button" onClick={cancelSelection}>Cancel</button>
              </div>
            )}

            <div className="messages-area">
              <div className="date-chip">YOUR CONVERSATION</div>

              {!selectionMode && messages.length > 0 && (
                <div className="start-selection">
                  <button className="secondary" type="button" onClick={() => setSelectionMode(true)}>
                    Select messages
                  </button>
                </div>
              )}

              {messages.map(m => {
                const isSelected = selectedMessageIds.includes(m.id);

                return (
                  <div
                    key={m.id}
                    className={`message-row ${m.senderId === me.id ? 'mine' : 'theirs'} ${isSelected ? 'message-selected' : ''}`}
                    onContextMenu={e => {
                      e.preventDefault();
                      if (!m.isDeletedForEveryone) {
                        if (selectionMode) toggleMessageSelection(m);
                        else setSelectedMessage(m);
                      }
                    }}
                  >
                    {selectionMode && !m.isDeletedForEveryone && (
                      <input
                        className="message-select-checkbox"
                        type="checkbox"
                        checked={isSelected}
                        aria-label="Select message"
                        onChange={() => toggleMessageSelection(m)}
                      />
                    )}

                    <div
                      className="message-bubble"
                      onClick={() => {
                        if (selectionMode && !m.isDeletedForEveryone) toggleMessageSelection(m);
                      }}
                    >
                      
                      {m.replyTo && !m.isDeletedForEveryone && (() => {
                        const originalMessage = messages.find(
                          item => item.id === m.replyTo
                        );

                        return (
                          <div className="message-reply-quote">
                            <strong>
                              {originalMessage
                                ? originalMessage.senderId === me.id
                                  ? 'You'
                                  : active.user.name
                                : 'Reply'}
                            </strong>
                            <p>
                              {originalMessage?.text || 'Original message'}
                            </p>
                          </div>
                        );
                      })()}

                      <p style={{
                        fontStyle: m.isDeletedForEveryone ? 'italic' : 'normal',
                        opacity: m.isDeletedForEveryone ? 0.7 : 1,
                      }}>{m.text}</p>

                      <div className="message-meta">
                        <time>{fmt(m.createdAt)}</time>
                        {m.senderId === me.id && (
                          <span className={m.readBy.includes(active.user.id) ? 'read' : ''}>
                            {m.readBy.includes(active.user.id) ? '✓✓' : '✓'}
                          </span>
                        )}

                        {!selectionMode && !m.isDeletedForEveryone && (
                          <button type="button" className="icon-btn" title="Message options"
                            aria-label="Message options"
                            onClick={() => setSelectedMessage(current => current?.id === m.id ? null : m)}>
                            ⋯
                          </button>
                        )}
                      </div>
                      
                      {!m.isDeletedForEveryone && (
                        <div className="message-reaction-area">
                          {m.reactions && m.reactions.length > 0 && (
                            <div className="message-reactions">
                              {m.reactions.map((reaction, index) => (
                                <span
                                  key={`${reaction.userId}-${index}`}
                                  className={`reaction-chip ${
                                    reaction.userId === me.id ? 'my-reaction' : ''
                                  }`}
                                  title={reaction.userId === me.id ? 'Your reaction' : 'Reaction'}
                                >
                                  {reaction.emoji}
                                </span>
                              ))}
                            </div>
                          )}

                          {reactionPickerFor === m.id && (
                            <div className="reaction-picker">
                              {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      const result = await api(
                                        `/conversations/${m.conversationId}/messages/${m.id}/reaction`,
                                        {
                                          method: 'PATCH',
                                          body: JSON.stringify({ emoji }),
                                        }
                                      );

                                      setMessages(old =>
                                        old.map(item =>
                                          item.id === m.id
                                            ? { ...item, reactions: result.reactions }
                                            : item
                                        )
                                      );

                                      setReactionPickerFor(null);
                                      setError('');
                                    } catch (e: any) {
                                      setError(e.message || 'Could not add reaction.');
                                    }
                                  }}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {selectedMessage?.id === m.id && !selectionMode && (
                        <div className="message-actions">                          
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingTo(m);
                              setSelectedMessage(null);
                              setReactionPickerFor(null);
                            }}
                          >
                            ↩ Reply
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => {
                              setReactionPickerFor(current =>
                                current === m.id ? null : m.id
                              );
                              setSelectedMessage(null);
                            }}
                          >
                            ☺ React
                          </button>

                          <button type="button" disabled={deleting} onClick={() => deleteMessage(m, 'me')}>
                            Delete for me
                          </button>
                          {m.senderId === me.id && (
                            <button type="button" disabled={deleting}
                              onClick={() => deleteMessage(m, 'everyone')}>
                              Delete for everyone
                            </button>
                          )}
                          <button type="button" onClick={() => setSelectedMessage(null)}>Cancel</button>
                          <button type="button" onClick={() => toggleMessageSelection(m)}>
                            Select multiple messages
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {typing && <div className="typing-label">{active.user.name} is typing <span>•••</span></div>}

              {!messages.length && (
                <div className="empty-chat">
                  <div className="empty-illustration">✦</div>
                  <h3>A good conversation starts here.</h3>
                  <p>Say hello to {active.user.name}.</p>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            
            {replyingTo && (
              <div className="reply-preview">
                <div className="reply-preview-content">
                  <strong>
                    Replying to {replyingTo.senderId === me.id ? 'yourself' : active.user.name}
                  </strong>
                  <p>{replyingTo.text || 'Attachment'}</p>
                </div>

                <button
                  type="button"
                  aria-label="Cancel reply"
                  onClick={() => setReplyingTo(null)}
                >
                  ✕
                </button>
              </div>
            )}


            <form className="composer" onSubmit={sendMessage}>
              <button type="button" className="emoji-btn" title="Add smiley"
                onClick={() => handleDraft(draft + '😊')}>☺</button>
              <textarea
                value={draft}
                onChange={e => {
                  handleDraft(e.target.value);
                  e.currentTarget.style.height = '38px';
                  e.currentTarget.style.height =
                    `${Math.min(e.currentTarget.scrollHeight, 120)}px`;
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();

                    if (draft.trim()) {
                      e.currentTarget.form?.requestSubmit();
                    }
                  }
                }}
                placeholder={`Message ${active.user.name}…`}
                maxLength={4000}
                rows={1}
                className="message-input"
              />
              <span className="composer-hint">↵</span>
              <button className="send-btn" disabled={!draft.trim()} title="Send message">➤</button>
            </form>
            <div className="encryption-note">
              Messages are saved to your cloud database · Never share sensitive information
            </div>
          </>
        ) : (
          <div className="welcome-panel">
            <div className="welcome-art">
              <div className="orbit orbit-a" />
              <div className="orbit orbit-b" />
              <div className="welcome-symbol">C<span>✦</span></div>
            </div>
            <p className="eyebrow">A LITTLE CLOSER, EVEN FAR AWAY</p>
            <h1>Conversations that<br /><em>just flow.</em></h1>
            <p className="muted">Choose a connection to start chatting, or add someone new with the + button.</p>
            <button className="primary" onClick={() => setAddOpen(true)}>＋ Add a connection</button>
            <div className="welcome-foot"><span>REAL-TIME</span><span>·</span><span>CLOUD-SAVED</span><span>·</span><span>PRIVATE</span></div>
          </div>
        )}
      </section>

      {addOpen && (
        <div className="modal-backdrop" onMouseDown={e => {
          if (e.target === e.currentTarget) setAddOpen(false);
        }}>
          <section className="modal">
            <button className="modal-close" onClick={() => setAddOpen(false)}>×</button>
            <div className="modal-icon">＋</div>
            <p className="eyebrow">GROW YOUR CIRCLE</p>
            <h2>Add a connection</h2>
            <p className="muted">Enter the email address they used to register.</p>
            <form onSubmit={addConnection}>
              <label>Email address
                <input autoFocus type="email" required value={addEmail}
                  onChange={e => setAddEmail(e.target.value)} placeholder="friend@example.com" />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="primary full" disabled={busy}>
                {busy ? 'Finding user…' : 'Connect and open chat'} <span>↗</span>
              </button>
            </form>
            <p className="tiny muted">They must have a ConnectLive account first.</p>
          </section>
        </div>
      )}

      {notice && <div className="toast">✓ {notice}</div>}
      {error && !addOpen && <button className="error-toast" onClick={() => setError('')}>{error} ×</button>}
    </main>
  );
}