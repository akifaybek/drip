import { useState, useEffect, useCallback } from 'react';
import CreateStream from './components/CreateStream';
import StreamCard   from './components/StreamCard';
import {
  connectWallet, readStream, shortAddr, getConfig,
  subscribeTxStatus, TX_STATUS, explorerLink,
} from './utils/stellar';

// ─────────────────────────────────────────────────────────────────────────────
// localStorage helpers — multi-stream aware
// ─────────────────────────────────────────────────────────────────────────────
const IDS_KEY = (pk) => `sf:ids:${pk}`;

function getStoredIds(pk) {
  if (!pk) return [];
  try {
    const raw = localStorage.getItem(IDS_KEY(pk));
    if (raw !== null) return JSON.parse(raw);
    // ── Migrate from old single-ID format ─────────────────────────────────
    const oldVal = localStorage.getItem(`sf:${pk}`);
    if (oldVal !== null) {
      const n = Number(oldVal);
      if (Number.isInteger(n) && n >= 0) {
        const ids = [n];
        localStorage.setItem(IDS_KEY(pk), JSON.stringify(ids));
        localStorage.removeItem(`sf:${pk}`);
        return ids;
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveIds(pk, ids) {
  if (pk) localStorage.setItem(IDS_KEY(pk), JSON.stringify(ids));
}

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // streams: [{ id, data, status: 'loading'|'success'|'error', error }]
  const [streams,    setStreams]   = useState([]);
  const [ready,      setReady]     = useState(false);   // first load done
  const [wallet,     setWallet]    = useState(null);
  const [view,       setView]      = useState('streams');
  const [connecting, setConnecting]= useState(false);
  const [connectErr, setConnectErr]= useState('');
  const [toast,      setToast]     = useState(null);

  const { network } = getConfig();

  // ── Load streams ───────────────────────────────────────────────────────────
  const loadAllStreams = useCallback(async (pk, idsOverride = null) => {
    if (!pk) return;
    const ids = idsOverride ?? getStoredIds(pk);
    setReady(false);
    if (ids.length === 0) { setStreams([]); setReady(true); return; }

    // Optimistically set all to loading
    setStreams(ids.map(id => ({ id, data: null, status: 'loading', error: '' })));

    const results = await Promise.allSettled(ids.map(id => readStream(pk, id)));

    setStreams(ids.map((id, i) => {
      const r = results[i];
      return r.status === 'fulfilled'
        ? { id, data: r.value, status: 'success', error: '' }
        : { id, data: null, status: 'error', error: r.reason?.message || 'Failed to load' };
    }));
    setReady(true);
  }, []);

  const refreshSingle = useCallback(async (pk, streamId) => {
    try {
      const data = await readStream(pk, streamId);
      setStreams(prev => prev.map(s => s.id === streamId ? { ...s, data, status: 'success', error: '' } : s));
    } catch (e) {
      setStreams(prev => prev.map(s => s.id === streamId ? { ...s, status: 'error', error: e.message } : s));
    }
  }, []);

  const addStreamById = useCallback(async (pk, rawId) => {
    const id = parseInt(rawId, 10);
    if (isNaN(id) || id < 0) throw new Error('Invalid stream ID');
    const current = getStoredIds(pk);
    if (current.includes(id)) throw new Error('Already watching stream #' + id);
    const newIds = [...current, id];
    saveIds(pk, newIds);
    setStreams(prev => [...prev, { id, data: null, status: 'loading', error: '' }]);
    try {
      const data = await readStream(pk, id);
      setStreams(prev => prev.map(s => s.id === id ? { ...s, data, status: 'success', error: '' } : s));
    } catch (e) {
      setStreams(prev => prev.map(s => s.id === id ? { ...s, status: 'error', error: e.message } : s));
    }
  }, []);

  // ── TX toast ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return subscribeTxStatus((p) => {
      setToast({ status: p?.status, message: p?.message ?? '', txHash: p?.txHash ?? '', error: p?.error ?? '' });
      if (p?.status === TX_STATUS.DONE || p?.status === TX_STATUS.ERROR) {
        setTimeout(() => setToast(null), 5000);
      }
    });
  }, []);

  // ── Connect ────────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true); setConnectErr('');
    try {
      const pk = await connectWallet();
      setWallet(pk);
      await loadAllStreams(pk);
    } catch (e) {
      setConnectErr(e.message || 'Connection failed.');
    } finally { setConnecting(false); }
  };

  const handleDisconnect = () => {
    setWallet(null); setStreams([]); setReady(false);
    setConnectErr(''); setView('streams');
  };

  const handleStreamCreated = (createdId) => {
    if (createdId != null) {
      const current = getStoredIds(wallet);
      const newIds  = current.includes(createdId) ? current : [...current, createdId];
      saveIds(wallet, newIds);
      loadAllStreams(wallet, newIds);
    } else {
      loadAllStreams(wallet);
    }
    setView('streams');
  };

  const successCount = streams.filter(s => s.status === 'success').length;

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!wallet) {
    return (
      <div className="min-h-screen bg-[#0c0c0c] flex flex-col items-center justify-center px-4">
        <Landing onConnect={handleConnect} loading={connecting} error={connectErr} />
      </div>
    );
  }

  // ── App shell ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0c0c0c] flex">
      {/* Sidebar */}
      <aside className="w-[216px] flex-shrink-0 h-screen sticky top-0 flex flex-col border-r border-[#1e1e1e] bg-[#111111]">
        <div className="h-[52px] flex items-center px-4 border-b border-[#1e1e1e] gap-2.5">
          <BrandMark />
          <span className="text-[13px] font-semibold text-[#e8e8eb] tracking-tight">Drip</span>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          <NavItem
            active={view === 'streams'}
            onClick={() => setView('streams')}
            icon={<IconList />}
            label="Streams"
            badge={successCount > 0 ? successCount : null}
          />
          <NavItem
            active={view === 'create'}
            onClick={() => setView('create')}
            icon={<IconPlus />}
            label="New stream"
          />
        </nav>

        <div className="border-t border-[#1e1e1e] px-3 py-3">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 pulse-slow" />
            <span className="font-mono text-[11px] text-[#555] flex-1 truncate num">
              {shortAddr(wallet, 6, 4)}
            </span>
          </div>
          <div className="px-2 flex items-center justify-between mt-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[#333]">{network}</span>
            <button onClick={handleDisconnect} className="text-[11px] text-[#333] hover:text-[#666] transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="h-[52px] flex-shrink-0 flex items-center justify-between px-8 border-b border-[#1e1e1e]">
          <h1 className="text-[13px] font-semibold text-[#e8e8eb]">
            {view === 'create' ? 'New stream' : 'Streams'}
          </h1>
          {view === 'streams' && (
            <button
              onClick={() => setView('create')}
              className="flex items-center gap-1.5 h-7 px-3 bg-white hover:bg-[#e8e8e8] active:bg-[#d0d0d0] rounded-md text-[12px] font-semibold text-[#0c0c0c] transition-colors"
            >
              <IconPlus size={11} /> New stream
            </button>
          )}
        </header>

        <main className="flex-1 px-8 py-6">
          {view === 'create' && (
            <div className="max-w-lg">
              <CreateStream walletAddress={wallet} onSuccess={handleStreamCreated} />
            </div>
          )}
          {view === 'streams' && (
            <StreamsView
              wallet={wallet}
              streams={streams}
              ready={ready}
              onCreate={() => setView('create')}
              onRefresh={(id) => refreshSingle(wallet, id)}
              onAddById={(rawId) => addStreamById(wallet, rawId)}
            />
          )}
        </main>
      </div>

      {toast && <TxToast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Landing
// ─────────────────────────────────────────────────────────────────────────────
function Landing({ onConnect, loading, error }) {
  return (
    <div style={{ animation: 'fadeIn 0.4s ease' }} className="max-w-[400px] w-full text-center">
      <div className="flex justify-center mb-8">
        <div className="w-12 h-12 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center">
          <BoltIcon size={20} />
        </div>
      </div>
      <h1 className="text-[28px] font-semibold tracking-tight text-[#e8e8eb] leading-none mb-3">Drip</h1>
      <p className="text-[15px] text-[#555] mb-2">DAO payroll, drop by drop.</p>
      <p className="text-[13px] text-[#666] leading-relaxed mb-10 max-w-[300px] mx-auto">
        Lock USDC into Soroban smart contracts. Contributors withdraw as they earn — automatic, trustless, transparent.
      </p>
      <button
        onClick={onConnect} disabled={loading}
        className="inline-flex items-center justify-center gap-2 h-10 px-6 bg-white hover:bg-[#e8e8e8] active:bg-[#d4d4d4] disabled:opacity-40 rounded-lg text-[13px] font-semibold text-[#0c0c0c] transition-colors w-full max-w-[240px]"
      >
        {loading ? <><Spinner size={14} color="#333" /> Connecting…</> : 'Connect Freighter'}
      </button>
      {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}
      <div className="mt-8 flex items-center justify-center gap-5 text-[11px] text-[#555]">
        {['Soroban', 'Stellar Testnet', 'USDC'].map((f, i, arr) => (
          <span key={f} className="flex items-center gap-5">
            {f}
            {i < arr.length - 1 && <span className="w-px h-3 bg-[#1e1e1e]" />}
          </span>
        ))}
      </div>
      <p className="mt-6 text-[11px] text-[#555]">
        Requires{' '}
        <a href="https://freighter.app" target="_blank" rel="noreferrer"
          className="text-[#666] hover:text-[#666] underline underline-offset-2 transition-colors">
          Freighter
        </a>{' '}browser extension
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Streams view — multi-stream
// ─────────────────────────────────────────────────────────────────────────────
function StreamsView({ wallet, streams, ready, onCreate, onRefresh, onAddById }) {
  const [watchId,  setWatchId]  = useState('');
  const [watchErr, setWatchErr] = useState('');
  const [watching, setWatching] = useState(false);

  const handleWatch = async (e) => {
    e.preventDefault();
    if (!watchId.trim()) return;
    setWatching(true); setWatchErr('');
    try {
      await onAddById(watchId.trim());
      setWatchId('');
    } catch (err) {
      setWatchErr(err.message);
    } finally { setWatching(false); }
  };

  // Initial loading
  if (!ready) {
    return (
      <div className="flex items-center gap-2.5 text-[#444] text-[13px] py-16">
        <Spinner size={15} /> Loading streams…
      </div>
    );
  }

  // Empty state
  if (streams.length === 0) {
    return (
      <div className="max-w-xl space-y-6">
        <div className="flex flex-col items-start py-8">
          <div className="w-10 h-10 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] flex items-center justify-center mb-4">
            <IconList size={16} color="#777" />
          </div>
          <p className="text-[14px] font-medium text-[#888] mb-1.5">No streams yet</p>
          <p className="text-[13px] text-[#666] mb-5 max-w-[280px] leading-relaxed">
            Create a new stream, or enter a stream ID you were given to start tracking it.
          </p>
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 h-8 px-4 bg-white hover:bg-[#e8e8e8] rounded-md text-[12px] font-semibold text-[#0c0c0c] transition-colors mb-5"
          >
            <IconPlus size={11} /> Create stream
          </button>
        </div>

        {/* Watch by ID — even on empty state */}
        <WatchForm
          watchId={watchId} setWatchId={setWatchId}
          onSubmit={handleWatch} watching={watching} error={watchErr}
          setWatchErr={setWatchErr}
        />
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      {/* Watch by ID */}
      <WatchForm
        watchId={watchId} setWatchId={setWatchId}
        onSubmit={handleWatch} watching={watching} error={watchErr}
        setWatchErr={setWatchErr}
      />

      {/* Stream cards */}
      {streams.map(({ id, data, status, error }) => {
        if (status === 'loading') return <StreamSkeleton key={id} id={id} />;
        if (status === 'error')   return <StreamError   key={id} id={id} error={error} onRetry={() => onRefresh(id)} />;
        return (
          <StreamCard
            key={id}
            stream={data}
            walletAddress={wallet}
            streamId={id}
            onRefresh={() => onRefresh(id)}
          />
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Watch by ID form
// ─────────────────────────────────────────────────────────────────────────────
function WatchForm({ watchId, setWatchId, onSubmit, watching, error, setWatchErr }) {
  return (
    <div>
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          value={watchId}
          onChange={e => { setWatchId(e.target.value); setWatchErr?.(''); }}
          placeholder="Watch a stream by ID…"
          type="number" min="0"
          className="flex-1 h-8 px-3 bg-[#181818] border border-[#2a2a2a] focus:border-[#4a4a4a] rounded-lg text-[12px] text-[#aaa] placeholder-[#4a4a4a] outline-none transition-colors num"
        />
        <button
          type="submit" disabled={watching || !watchId.trim()}
          className="h-8 px-3.5 flex items-center gap-1.5 bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2a2a2a] rounded-lg text-[12px] text-[#888] hover:text-[#ccc] disabled:opacity-40 transition-colors flex-shrink-0"
        >
          {watching ? <Spinner size={11} /> : null}
          Watch
        </button>
      </form>
      {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream skeleton
// ─────────────────────────────────────────────────────────────────────────────
function StreamSkeleton({ id }) {
  return (
    <div className="rounded-xl border border-[#1e1e1e] bg-[#111111] overflow-hidden animate-pulse">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-3 bg-[#1e1e1e] rounded" />
          <div className="w-16 h-5 bg-[#1e1e1e] rounded-full" />
        </div>
        {id != null && <span className="text-[11px] text-[#555] font-mono">#{id}</span>}
      </div>
      <div className="px-5 py-4 space-y-3">
        <div className="h-3 bg-[#1a1a1a] rounded w-3/4" />
        <div className="h-3 bg-[#1a1a1a] rounded w-1/2" />
        <div className="h-1 bg-[#1a1a1a] rounded-full w-full mt-4" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream error row
// ─────────────────────────────────────────────────────────────────────────────
function StreamError({ id, error, onRetry }) {
  return (
    <div className="rounded-xl border border-[#3a1818] bg-[#1a0e0e] px-5 py-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-red-400 mb-0.5">
          {id != null ? `Stream #${id}` : 'Stream'} — failed to load
        </p>
        <p className="text-[11px] text-[#7a3030] break-all leading-relaxed">{error}</p>
      </div>
      <button onClick={onRetry} className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0 underline underline-offset-2">
        Retry
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TX Toast
// ─────────────────────────────────────────────────────────────────────────────
function TxToast({ toast, onClose }) {
  const isDone  = toast.status === TX_STATUS.DONE;
  const isError = toast.status === TX_STATUS.ERROR;
  if (toast.status === TX_STATUS.IDLE) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 w-[300px]" style={{ animation: 'slideUp 0.2s ease' }}>
      <div className={`rounded-xl border shadow-2xl shadow-black/60 overflow-hidden ${
        isDone  ? 'bg-[#0d1a0d] border-[#1e3a1e]' :
        isError ? 'bg-[#1a0d0d] border-[#3a1e1e]' : 'bg-[#141414] border-[#222222]'
      }`}>
        <div className="px-4 py-3.5 flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0 w-4 h-4 flex items-center justify-center">
            {isDone  ? <span className="text-emerald-400 text-[13px] font-bold leading-none">✓</span> :
             isError ? <span className="text-red-400 text-[13px] font-bold leading-none">✕</span> :
                       <Spinner size={13} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[12px] font-medium ${isDone ? 'text-emerald-300' : isError ? 'text-red-300' : 'text-[#aaa]'}`}>
              {toast.message || toast.status}
            </p>
            {toast.error && <p className="text-[11px] text-red-400/60 mt-1 break-all leading-relaxed">{toast.error}</p>}
            {toast.txHash && (
              <a href={explorerLink(toast.txHash)} target="_blank" rel="noreferrer"
                className="text-[10px] font-mono text-[#444] hover:text-[#777] mt-1.5 block transition-colors">
                {toast.txHash.slice(0, 12)}…{toast.txHash.slice(-8)} ↗
              </a>
            )}
          </div>
          <button onClick={onClose} className="text-[#333] hover:text-[#666] text-[12px] mt-0.5 flex-shrink-0 transition-colors">✕</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────
export function Spinner({ size = 16, color = 'currentColor' }) {
  return (
    <svg className="animate-spin flex-shrink-0" style={{ width: size, height: size }} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-15" cx="12" cy="12" r="10" stroke={color} strokeWidth="3" />
      <path className="opacity-60" fill={color} d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function NavItem({ active, onClick, icon, label, badge }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors text-left ${
        active ? 'bg-[#1e1e1e] text-[#e8e8eb]' : 'text-[#555] hover:text-[#aaa] hover:bg-[#181818]'
      }`}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge != null && (
        <span className="text-[10px] font-medium text-[#444] bg-[#1a1a1a] border border-[#2a2a2a] px-1.5 py-0.5 rounded-full num">
          {badge}
        </span>
      )}
    </button>
  );
}

function BrandMark() {
  return (
    <div className="w-6 h-6 rounded-md bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center flex-shrink-0">
      <BoltIcon size={13} />
    </div>
  );
}

function BoltIcon({ size = 14 }) {
  return (
    <svg style={{ width: size, height: size }} fill="none" viewBox="0 0 24 24" stroke="#777" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

export function IconList({ size = 14, color = 'currentColor' }) {
  return (
    <svg style={{ width: size, height: size }} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}

export function IconPlus({ size = 14, color = 'currentColor' }) {
  return (
    <svg style={{ width: size, height: size }} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}
