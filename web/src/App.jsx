import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:4000';
const socket = io(API_BASE, { autoConnect: false });

async function api(path, options = {}) {
  const token = localStorage.getItem('auth_token');
  const response = await axios({
    url: `${API_BASE}${path}`,
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': options.headers?.['Content-Type'] || 'application/json',
    },
  });

  return response.data;
}

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login'
        ? { email, password }
        : { email, password, displayName };

      const result = await api(endpoint, {
        method: 'POST',
        data: payload,
      });

      if (mode === 'login') {
        localStorage.setItem('auth_token', result.token);
        onAuthenticated(result.user);
      } else {
        setMode('login');
        setPassword('');
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand-block">
          <div className="brand-mark">C</div>
          <div>
            <span className="eyebrow">ChatWave</span>
            <h1>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
          </div>
        </div>
        <div className="auth-toggle">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
        </div>
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label>
              <span>Display name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          )}

          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>

          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>

          {error && <div className="error-box">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ChatApp({ currentUser, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState('');
  const [typingUser, setTypingUser] = useState('');
  const [callState, setCallState] = useState({ active: false, peer: null, type: 'audio' });
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);

  const socketRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    socketRef.current = io(API_BASE, { auth: { token } });
    socketRef.current.on('connect', () => {
      socketRef.current.emit('presence:online', { userId: currentUser.id });
    });

    socketRef.current.on('message:new', (message) => {
      setMessages((prev) => {
        const exists = prev.some((entry) => entry.id === message.id);
        if (exists) return prev;
        return [...prev, { ...message, attachments: message.attachments || [] }];
      });
      refreshConversations();
    });

    socketRef.current.on('typing:start', ({ userId, conversationId }) => {
      if (conversationId === selectedId && userId !== currentUser.id) {
        setTypingUser(userId);
      }
    });

    socketRef.current.on('typing:stop', ({ userId, conversationId }) => {
      if (conversationId === selectedId && userId !== currentUser.id) {
        setTypingUser('');
      }
    });

    socketRef.current.on('call:incoming', (payload) => {
      setCallState({ active: true, peer: payload.callerId, type: payload.type, incoming: true });
    });

    socketRef.current.on('call:offer', async ({ fromUserId, offer }) => {
      const pc = await createPeerConnection();
      peerConnectionRef.current = pc;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('call:answer', { toUserId: fromUserId, answer });
      setCallState({ active: true, peer: fromUserId, type: 'video', incoming: false });
    });

    socketRef.current.on('call:answer', async ({ fromUserId, answer }) => {
      const pc = peerConnectionRef.current;
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
      setCallState({ active: true, peer: fromUserId, type: callState.type || 'audio', incoming: false });
    });

    socketRef.current.on('call:ice-candidate', ({ fromUserId, candidate }) => {
      const pc = peerConnectionRef.current;
      if (pc && candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    return () => socketRef.current?.disconnect();
  }, [currentUser.id, selectedId]);

  async function refreshConversations() {
    const data = await api('/api/conversations');
    setConversations(data.conversations || []);
    if (!selectedId && data.conversations[0]) {
      setSelectedId(data.conversations[0].id);
    }
  }

  useEffect(() => {
    refreshConversations();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const join = async () => {
      socketRef.current?.emit('conversation:join', { conversationId: selectedId });
      const data = await api(`/api/conversations/${selectedId}/messages?limit=50`);
      setMessages(data.messages || []);
    };
    join();
  }, [selectedId]);

  useEffect(() => {
    if (!search.trim()) {
      setUsers([]);
      return;
    }

    const timeout = setTimeout(async () => {
      const data = await api(`/api/users/search?q=${encodeURIComponent(search)}`);
      setUsers(data.users || []);
    }, 200);

    return () => clearTimeout(timeout);
  }, [search]);

  async function startConversation(userId) {
    const data = await api('/api/conversations', {
      method: 'POST',
      data: { otherUserId: userId },
    });
    setSelectedId(data.conversation.id);
    setSearch('');
    refreshConversations();
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!selectedId || !draft.trim()) return;

    const data = await api(`/api/conversations/${selectedId}/messages`, {
      method: 'POST',
      data: { text: draft },
    });

    setDraft('');
    setMessages((prev) => [...prev, { ...data.message, attachments: data.message.attachments || [] }]);
    refreshConversations();
  }

  function startTyping() {
    if (!selectedId) return;
    socketRef.current?.emit('typing:start', { conversationId: selectedId });
  }

  async function startCall(type = 'audio') {
    if (!selectedId) return;
    const conversationUsers = conversations.find((item) => item.id === selectedId);
    const otherUserId = conversationUsers?.participantId || currentUser.id;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peerConnectionRef.current = pc;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    localStreamRef.current = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('call:ice-candidate', { toUserId: otherUserId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (event.streams?.[0]) {
        setCallState({ active: true, peer: otherUserId, type, incoming: false, remoteStream: event.streams[0] });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('call:offer', { toUserId: otherUserId, offer });
    setCallState({ active: true, peer: otherUserId, type, incoming: false });
  }

  async function acceptCall() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callState.type === 'video' });
    localStreamRef.current = stream;
    setCallState((prev) => ({ ...prev, active: true, incoming: false }));
  }

  async function createPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('call:ice-candidate', { toUserId: callState.peer, candidate: event.candidate });
      }
    };

    if (navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callState.type === 'video' });
      localStreamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    peerConnectionRef.current = pc;
    return pc;
  }

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || conversations[0],
    [conversations, selectedId]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="topbar">
          <h2>{currentUser.displayName}</h2>
          <button className="ghost" onClick={onLogout}>Logout</button>
        </div>

        <div className="search-box">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
          />
        </div>

        <div className="search-results">
          {users.map((user) => (
            <button key={user.id} className="user-result" onClick={() => startConversation(user.id)}>
              <span>{user.displayName}</span>
              <small>{user.email}</small>
            </button>
          ))}
        </div>

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-item ${selectedId === conversation.id ? 'active' : ''}`}
              onClick={() => setSelectedId(conversation.id)}
            >
              <strong>{conversation.id}</strong>
              <span>{conversation.lastMessage || 'No messages yet'}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel">
        {selectedConversation ? (
          <>
            <header className="chat-header">
              <div>
                <h3>{selectedConversation.id}</h3>
                <small>{typingUser ? 'Typing...' : 'Online'}</small>
              </div>
              <div className="header-actions">
                <button className="ghost" onClick={() => startCall('audio')}>Voice call</button>
                <button className="ghost" onClick={() => startCall('video')}>Video call</button>
              </div>
            </header>

            <div className="message-list">
              {messages.map((message) => (
                <div key={message.id} className={`message-row ${message.senderId === currentUser.id ? 'own' : ''}`}>
                  <div className="bubble">
                    <div className="message-meta">{message.senderId === currentUser.id ? 'You' : message.senderName}</div>
                    {message.content && <p>{message.content}</p>}
                    {message.attachments?.length > 0 && (
                      <ul className="attachments">
                        {message.attachments.map((attachment) => (
                          <li key={attachment.id}>
                            <a href={`${API_BASE}${attachment.url || ''}`} target="_blank" rel="noreferrer">
                              {attachment.fileName || attachment.file_name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={sendMessage} className="composer">
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  startTyping();
                }}
                placeholder="Write a message..."
              />
              <button type="submit">Send</button>
            </form>
          </>
        ) : (
          <div className="empty-state">Select a conversation</div>
        )}
      </main>

      {callState.active && (
        <div className="call-overlay">
          <div className="call-card">
            <h3>{callState.incoming ? 'Incoming call' : 'Call in progress'}</h3>
            <p>{callState.peer}</p>
            <div className="call-actions">
              {callState.incoming ? (
                <>
                  <button onClick={acceptCall}>Accept</button>
                  <button className="ghost" onClick={() => setCallState({ active: false, peer: null, type: 'audio' })}>Decline</button>
                </>
              ) : (
                <button onClick={() => setCallState({ active: false, peer: null, type: 'audio' })}>End call</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useLocalStorage('app_user', null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token || currentUser) return;

    api('/api/auth/me')
      .then((data) => setCurrentUser(data.user))
      .catch(() => {
        localStorage.removeItem('auth_token');
      });
  }, [currentUser]);

  function handleLogout() {
    localStorage.removeItem('auth_token');
    setCurrentUser(null);
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={setCurrentUser} />;
  }

  return <ChatApp currentUser={currentUser} onLogout={handleLogout} />;
}
