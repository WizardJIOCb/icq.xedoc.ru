import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const API = '/api';
const statuses = {
  online: { label: 'В сети', className: 'online' },
  away: { label: 'Отошёл', className: 'away' },
  dnd: { label: 'Не беспокоить', className: 'dnd' },
  invisible: { label: 'Невидимый', className: 'offline' },
  offline: { label: 'Не в сети', className: 'offline' },
};

function Flower({ small = false }) {
  return (
    <span className={`flower ${small ? 'flower--small' : ''}`} aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => <i key={index} style={{ '--i': index }} />)}
      <b />
    </span>
  );
}

function StatusDot({ status = 'offline' }) {
  return <span className={`status-dot status-dot--${statuses[status]?.className || 'offline'}`} title={statuses[status]?.label} />;
}

function api(path, options = {}, token) {
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Что-то пошло не так');
    return data;
  });
}

function Login({ onAuth }) {
  const showDemo = import.meta.env.DEV;
  const [mode, setMode] = useState('login');
  const [login, setLogin] = useState(showDemo ? '12345678' : '');
  const [name, setName] = useState('');
  const [password, setPassword] = useState(showDemo ? 'icq2001' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(mode === 'login' ? { login, password } : { name, password }),
      });
      onAuth(data);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-cloud login-cloud--one" />
      <div className="login-cloud login-cloud--two" />
      <section className="login-window classic-window">
        <div className="login-hero">
          <Flower />
          <div>
            <h1>ICQ</h1>
            <p>I seek you</p>
          </div>
        </div>
        <div className="login-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Вход</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Новый UIN</button>
        </div>
        <form className="login-form" onSubmit={submit}>
          {mode === 'login' ? (
            <label>UIN или имя<input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus /></label>
          ) : (
            <label>Ваше имя<input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Например, Rodion" /></label>
          )}
          <label>Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="classic-button login-button" disabled={busy}>{busy ? 'Соединение…' : mode === 'login' ? 'Войти' : 'Получить UIN'}</button>
        </form>
        <div className="login-note">
          <StatusDot status="online" /> Сервер доступен
          {mode === 'login' && showDemo && <span>Демо: 12345678 / icq2001</span>}
        </div>
      </section>
      <p className="login-footer">ICQ Retro · icq.xedoc.ru</p>
    </main>
  );
}

function Avatar({ contact, size = 'normal' }) {
  const initials = contact.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const hue = [...contact.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return <div className={`avatar avatar--${size}`} style={{ '--hue': hue }}>{initials}<StatusDot status={contact.status} /></div>;
}

function ContactRow({ contact, active, onClick }) {
  return (
    <button className={`contact-row ${active ? 'contact-row--active' : ''}`} onClick={onClick}>
      <Avatar contact={contact} />
      <span className="contact-copy"><strong>{contact.name}</strong><small>{contact.status === 'offline' ? contact.about || `ICQ# ${contact.uin}` : statuses[contact.status]?.label}</small></span>
      {contact.unread > 0 && <em>{contact.unread > 99 ? '99+' : contact.unread}</em>}
    </button>
  );
}

function AddContact({ token, onAdded, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (query.trim().length < 2) return setResults([]);
    const timer = setTimeout(() => {
      api(`/users/search?q=${encodeURIComponent(query)}`, {}, token)
        .then((data) => setResults(data.users))
        .catch((caught) => setError(caught.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, token]);

  const add = async (user) => {
    try {
      await api(`/contacts/${user.id}`, { method: 'POST' }, token);
      onAdded(user.id);
    } catch (caught) {
      setError(caught.message);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal classic-window">
        <header className="window-title"><Flower small /><b>Найти / добавить контакт</b><button onClick={onClose}>×</button></header>
        <div className="modal-body">
          <label className="search-big">Введите имя или ICQ UIN<input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Минимум 2 символа" /></label>
          <div className="search-results">
            {results.map((user) => (
              <div className="search-user" key={user.id}>
                <Avatar contact={user} />
                <span><b>{user.name}</b><small>ICQ# {user.uin}</small></span>
                <button className="classic-button" disabled={user.isContact} onClick={() => add(user)}>{user.isContact ? 'Добавлен' : 'Добавить'}</button>
              </div>
            ))}
            {query.length >= 2 && results.length === 0 && <p className="empty-hint">Никого не найдено</p>}
          </div>
          {error && <div className="form-error">{error}</div>}
        </div>
      </section>
    </div>
  );
}

function Messenger({ session, onLogout }) {
  const { token } = session;
  const [me, setMe] = useState(session.user);
  const [contacts, setContacts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState({});
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [typing, setTyping] = useState({});
  const [sound, setSound] = useState(true);
  const [shake, setShake] = useState(false);
  const [connection, setConnection] = useState('connecting');
  const socketRef = useRef(null);
  const soundRef = useRef(true);
  const messagesEndRef = useRef(null);
  const typingTimer = useRef(null);
  const selectedIdRef = useRef(null);

  selectedIdRef.current = selectedId;
  soundRef.current = sound;

  const beep = (frequency = 680, duration = 0.08) => {
    if (!soundRef.current) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(0.06, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch { /* browser blocked audio */ }
  };

  const loadContacts = async () => {
    try {
      const data = await api('/contacts', {}, token);
      setContacts(data.contacts);
    } catch (caught) {
      if (caught.message.includes('войти')) onLogout();
    }
  };

  useEffect(() => { loadContacts(); }, []);

  useEffect(() => {
    const socket = io({ auth: { token } });
    socketRef.current = socket;
    socket.on('connect', () => setConnection('connected'));
    socket.on('disconnect', () => setConnection('connecting'));
    socket.on('connect_error', () => setConnection('error'));
    socket.on('presence', ({ userId, status }) => setContacts((current) => current.map((c) => c.id === userId ? { ...c, status } : c)));
    socket.on('contacts:changed', loadContacts);
    socket.on('typing', ({ from, active }) => setTyping((current) => ({ ...current, [from]: active })));
    socket.on('messages:read', ({ by }) => setMessages((current) => ({
      ...current,
      [by]: (current[by] || []).map((message) => message.from === me.id ? { ...message, readAt: message.readAt || new Date().toISOString() } : message),
    })));
    socket.on('message:new', (message) => {
      const otherId = message.from === me.id ? message.to : message.from;
      setMessages((current) => {
        const existing = current[otherId] || [];
        if (existing.some((item) => item.id === message.id)) return current;
        return { ...current, [otherId]: [...existing, message] };
      });
      if (message.from !== me.id) {
        beep(message.kind === 'nudge' ? 280 : 760, message.kind === 'nudge' ? 0.18 : 0.09);
        if (message.kind === 'nudge') {
          setShake(true);
          setTimeout(() => setShake(false), 700);
        }
        if (selectedIdRef.current !== message.from) {
          setContacts((current) => current.map((c) => c.id === message.from ? { ...c, unread: (c.unread || 0) + 1 } : c));
        } else {
          api(`/messages/${message.from}`, {}, token).catch(() => {});
        }
      }
    });
    return () => socket.disconnect();
  }, [token]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, selectedId, typing]);

  const selectContact = async (id) => {
    setSelectedId(id);
    setContacts((current) => current.map((c) => c.id === id ? { ...c, unread: 0 } : c));
    try {
      const data = await api(`/messages/${id}`, {}, token);
      setMessages((current) => ({ ...current, [id]: data.messages }));
    } catch { /* keep local conversation */ }
  };

  const send = (event) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !selectedId || !socketRef.current?.connected) return;
    socketRef.current.emit('message:send', { to: selectedId, text });
    socketRef.current.emit('typing', { to: selectedId, active: false });
    setDraft('');
    beep(520, 0.05);
  };

  const sendNudge = () => {
    if (selectedId) socketRef.current?.emit('message:send', { to: selectedId, kind: 'nudge' });
  };

  const updateDraft = (value) => {
    setDraft(value);
    if (!selectedId) return;
    socketRef.current?.emit('typing', { to: selectedId, active: Boolean(value) });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socketRef.current?.emit('typing', { to: selectedId, active: false }), 1200);
  };

  const setStatus = (status) => {
    setMe((current) => ({ ...current, status }));
    socketRef.current?.emit('status:set', status);
  };

  const sortedContacts = useMemo(() => contacts
    .filter((contact) => contact.name.toLowerCase().includes(filter.toLowerCase()) || contact.uin.includes(filter))
    .sort((a, b) => Number(b.status !== 'offline') - Number(a.status !== 'offline') || a.name.localeCompare(b.name)), [contacts, filter]);
  const onlineContacts = sortedContacts.filter((c) => c.status !== 'offline');
  const offlineContacts = sortedContacts.filter((c) => c.status === 'offline');
  const selected = contacts.find((contact) => contact.id === selectedId);

  return (
    <main className={`desktop ${shake ? 'is-shaking' : ''}`}>
      <div className="desktop-glow" />
      <section className="roster classic-window">
        <header className="brand-bar">
          <div className="brand"><Flower /><span><b>ICQ</b><small>icq.xedoc.ru</small></span></div>
          <div className="window-controls"><button>_</button><button onClick={onLogout}>×</button></div>
        </header>
        <div className="profile-bar">
          <Avatar contact={{ ...me, status: me.status || 'online' }} size="large" />
          <div className="profile-copy"><strong>{me.name}</strong><span>ICQ# {me.uin}</span></div>
          <select value={me.status || 'online'} onChange={(e) => setStatus(e.target.value)} title="Изменить статус">
            {Object.entries(statuses).filter(([key]) => key !== 'offline').map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        </div>
        <div className="toolbar">
          <button onClick={() => setShowAdd(true)} title="Добавить контакт">👤<b>+</b></button>
          <button onClick={() => setSound((value) => !value)} title="Звук">{sound ? '🔊' : '🔇'}</button>
          <span />
          <i className={`connection connection--${connection}`} title={connection === 'connected' ? 'Подключено' : 'Соединение…'} />
        </div>
        <div className="contact-search"><span>⌕</span><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск в контактах" /></div>
        <div className="contacts">
          <ContactGroup title="В сети" count={onlineContacts.length} contacts={onlineContacts} selectedId={selectedId} onSelect={selectContact} />
          <ContactGroup title="Не в сети" count={offlineContacts.length} contacts={offlineContacts} selectedId={selectedId} onSelect={selectContact} />
          {contacts.length === 0 && <div className="empty-contacts"><Flower /><b>Список пуст</b><span>Найдите друзей по имени или UIN</span><button className="classic-button" onClick={() => setShowAdd(true)}>Добавить контакт</button></div>}
        </div>
        <footer className="roster-footer"><span>В сети: {onlineContacts.length}/{contacts.length}</span><button onClick={onLogout}>Выход</button></footer>
      </section>

      <section className={`chat classic-window ${selected ? 'chat--open' : ''}`}>
        {selected ? (
          <>
            <header className="window-title chat-title">
              <Flower small />
              <div><b>{selected.name}</b><span>{typing[selected.id] ? 'печатает сообщение…' : `${statuses[selected.status]?.label} · ICQ# ${selected.uin}`}</span></div>
              <button onClick={() => setSelectedId(null)}>×</button>
            </header>
            <div className="chat-person">
              <Avatar contact={selected} size="large" />
              <div><b>{selected.name}</b><span>{selected.about || 'Нет подписи'}</span></div>
              <button className="classic-button" onClick={sendNudge} title="Встряска">⚡ Встряска</button>
            </div>
            <div className="message-history">
              <div className="history-start">Начало истории сообщений</div>
              {(messages[selected.id] || []).map((message, index, list) => {
                const mine = message.from === me.id;
                const previous = list[index - 1];
                const grouped = previous && previous.from === message.from && new Date(message.createdAt) - new Date(previous.createdAt) < 180000;
                return message.kind === 'nudge' ? (
                  <div className="nudge" key={message.id}>⚡ {mine ? 'Вы отправили встряску' : `${selected.name} отправил(а) вам встряску`}</div>
                ) : (
                  <article key={message.id} className={`message ${mine ? 'message--mine' : ''} ${grouped ? 'message--grouped' : ''}`}>
                    {!grouped && <div className="message-meta"><b>{mine ? me.name : selected.name}</b><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>}
                    <p>{message.text}</p>
                    {mine && <span className={`read-check ${message.readAt ? 'read-check--read' : ''}`}>✓</span>}
                  </article>
                );
              })}
              {typing[selected.id] && <div className="typing-dots"><i /><i /><i /></div>}
              <div ref={messagesEndRef} />
            </div>
            <form className="composer" onSubmit={send}>
              <div className="composer-tools">
                <button type="button" onClick={() => updateDraft(`${draft}${draft ? ' ' : ''}:-)`)}>☺</button>
                <button type="button" onClick={() => updateDraft(`${draft}${draft ? ' ' : ''}¯\\_(ツ)_/¯`)}>ツ</button>
                <span>Ctrl+Enter — отправить</span>
              </div>
              <textarea value={draft} onChange={(e) => updateDraft(e.target.value)} onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(e);
              }} placeholder="Введите сообщение…" autoFocus />
              <button className="classic-button send-button" disabled={!draft.trim() || connection !== 'connected'}>Отправить</button>
            </form>
          </>
        ) : (
          <div className="chat-placeholder">
            <Flower />
            <h2>Добро пожаловать в ICQ</h2>
            <p>Выберите контакт, чтобы начать разговор</p>
            <div className="welcome-card"><StatusDot status="online" /><span>Ваш UIN</span><b>{me.uin}</b></div>
          </div>
        )}
      </section>
      {showAdd && <AddContact token={token} onClose={() => setShowAdd(false)} onAdded={(id) => { setShowAdd(false); loadContacts().then(() => selectContact(id)); }} />}
    </main>
  );
}

function ContactGroup({ title, count, contacts, selectedId, onSelect }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="contact-group">
      <button className="group-title" onClick={() => setOpen((value) => !value)}><span>{open ? '▾' : '▸'}</span><b>{title}</b><em>{count}</em></button>
      {open && contacts.map((contact) => <ContactRow key={contact.id} contact={contact} active={selectedId === contact.id} onClick={() => onSelect(contact.id)} />)}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => {
    try {
      const token = localStorage.getItem('icq-token');
      const user = JSON.parse(localStorage.getItem('icq-user'));
      return token && user ? { token, user } : null;
    } catch { return null; }
  });

  const onAuth = (data) => {
    localStorage.setItem('icq-token', data.token);
    localStorage.setItem('icq-user', JSON.stringify(data.user));
    setSession(data);
  };
  const logout = () => {
    localStorage.removeItem('icq-token');
    localStorage.removeItem('icq-user');
    setSession(null);
  };

  return session ? <Messenger session={session} onLogout={logout} /> : <Login onAuth={onAuth} />;
}
