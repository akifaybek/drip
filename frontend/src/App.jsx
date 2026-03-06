import { useState, useEffect, useCallback, useMemo } from 'react';
import CreateStream from './components/CreateStream';
import StreamCard from './components/StreamCard';
import {
  connectWallet,
  getWalletAddress,
  readStream,
  shortAddr,
  getConfig,
  claimStream,
  cancelStream,
  subscribeTxStatus,
  TX_STATUS,
  explorerLink,
} from './utils/stellar';

const idsKey = (pk) => `drip:streamIds:${pk}`;

function loadIds(pk) {
  if (!pk) return [];
  try {
    const raw = localStorage.getItem(idsKey(pk));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map((x) => String(x)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveIds(pk, ids) {
  if (!pk) return;
  localStorage.setItem(idsKey(pk), JSON.stringify(ids.map((x) => String(x))));
}

function DropIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C12 2 4 10.5 4 15a8 8 0 0016 0C20 10.5 12 2 12 2z" />
    </svg>
  );
}

function Spinner({ size = 16 }) {
  return (
    <svg
      className="animate-spin"
      style={{ width: size, height: size }}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function TxToast({ tx }) {
  if (!tx || tx.status === TX_STATUS.IDLE) return null;

  const isDone = tx.status === TX_STATUS.DONE;
  const isError = tx.status === TX_STATUS.ERROR;

  return (
    <div className="fixed right-5 bottom-5 z-50 w-[360px] max-w-[calc(100vw-2rem)]">
      <div
        className={`rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${
          isDone
            ? 'border-emerald-500/30 bg-emerald-950/90 text-emerald-200'
            : isError
              ? 'border-red-500/30 bg-red-950/90 text-red-200'
              : 'border-amber-500/35 bg-zinc-950/95 text-amber-100'
        }`}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          {isDone ? <span>✓</span> : isError ? <span>✕</span> : <Spinner size={13} />}
          <span>{tx.message || tx.status}</span>
        </div>
        {tx.error && <p className="mt-1.5 text-xs opacity-80 break-all">{tx.error}</p>}
        {tx.txHash && (
          <a
            href={explorerLink(tx.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-[11px] font-mono opacity-80 underline underline-offset-2"
          >
            {tx.txHash.slice(0, 16)}…{tx.txHash.slice(-8)}
          </a>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [wallet, setWallet] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  const [page, setPage] = useState('home');
  const [streams, setStreams] = useState([]);
  const [streamsLoading, setStreamsLoading] = useState(false);

  const [watchId, setWatchId] = useState('');
  const [watchErr, setWatchErr] = useState('');

  const [txState, setTxState] = useState({
    status: TX_STATUS.IDLE,
    message: '',
    txHash: '',
    error: '',
  });

  const cfg = getConfig();

  useEffect(() => {
    let active = true;
    getWalletAddress().then((pk) => {
      if (active && pk) setWallet(pk);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return subscribeTxStatus((payload) => {
      setTxState({
        status: payload?.status ?? TX_STATUS.IDLE,
        message: payload?.message ?? '',
        txHash: payload?.txHash ?? '',
        error: payload?.error ?? '',
      });
    });
  }, []);

  const loadAllStreams = useCallback(async (pk) => {
    if (!pk) {
      setStreams([]);
      return;
    }

    const ids = loadIds(pk);
    if (!ids.length) {
      setStreams([]);
      return;
    }

    setStreamsLoading(true);
    const rows = await Promise.all(
      ids.map(async (id) => {
        try {
          const data = await readStream(pk, id);
          return { id: String(id), status: 'ok', data, error: '' };
        } catch (e) {
          return {
            id: String(id),
            status: 'error',
            data: null,
            error: e?.message || 'Stream okunamadı.',
          };
        }
      })
    );

    setStreams(rows);
    setStreamsLoading(false);
  }, []);

  useEffect(() => {
    if (wallet) loadAllStreams(wallet);
    else setStreams([]);
  }, [wallet, loadAllStreams]);

  async function handleConnect() {
    setConnectError('');
    setConnecting(true);
    try {
      const pk = await connectWallet();
      setWallet(pk);
    } catch (e) {
      setConnectError(e?.message || 'Cüzdan bağlanamadı.');
    } finally {
      setConnecting(false);
    }
  }

  function handleSignOut() {
    setWallet('');
    setStreams([]);
    setPage('home');
    setWatchErr('');
    setWatchId('');
  }

  async function refreshSingle(id) {
    if (!wallet) return;
    try {
      const data = await readStream(wallet, id);
      setStreams((prev) => prev.map((s) => (s.id === String(id) ? { ...s, status: 'ok', data, error: '' } : s)));
    } catch (e) {
      setStreams((prev) =>
        prev.map((s) =>
          s.id === String(id)
            ? { ...s, status: 'error', error: e?.message || 'Yenileme başarısız.' }
            : s
        )
      );
    }
  }

  function handleCreated(id) {
    const streamId = String(id);
    if (!wallet || !streamId) return;

    const ids = loadIds(wallet);
    if (!ids.includes(streamId)) saveIds(wallet, [...ids, streamId]);

    loadAllStreams(wallet);
    setPage('streams');
  }

  async function addWatchById() {
    if (!wallet) {
      setWatchErr('Önce cüzdan bağla.');
      return;
    }

    const id = watchId.trim();
    if (!id) return;

    setWatchErr('');
    try {
      await readStream(wallet, id);
      const ids = loadIds(wallet);
      if (!ids.includes(id)) saveIds(wallet, [...ids, id]);
      setWatchId('');
      setPage('streams');
      await loadAllStreams(wallet);
    } catch (e) {
      setWatchErr(e?.message || 'Stream bulunamadı.');
    }
  }

  async function onClaim(id) {
    if (!wallet) return;
    await claimStream(wallet, id);
    await refreshSingle(id);
  }

  async function onCancel(id) {
    if (!wallet) return;
    await cancelStream(wallet, id);
    const ids = loadIds(wallet).filter((x) => x !== String(id));
    saveIds(wallet, ids);
    await loadAllStreams(wallet);
  }

  const stats = useMemo(() => {
    const total = streams.length;
    const healthy = streams.filter((s) => s.status === 'ok' && s.data).length;
    const active = streams.filter((s) => s.status === 'ok' && s.data?.active).length;
    return { total, healthy, active };
  }, [streams]);

  return (
    <div className="min-h-screen bg-[#070707] text-zinc-100">
      <TxToast tx={txState} />

      <div className="flex min-h-screen">
        <aside className="w-[270px] border-r border-amber-500/15 bg-[#0d0d0d]">
          <div className="h-16 px-5 flex items-center border-b border-amber-500/15">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600 text-black flex items-center justify-center shadow-lg shadow-amber-500/30">
              <DropIcon />
            </div>
            <div className="ml-3">
              <p className="text-[18px] font-semibold tracking-tight">Drip</p>
              <p className="text-[11px] text-amber-300/70">Payroll on Stellar</p>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {[
              { id: 'home', label: 'Dashboard' },
              { id: 'streams', label: 'Streams' },
              { id: 'create', label: 'New stream' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (!wallet && item.id !== 'home') {
                    handleConnect();
                    return;
                  }
                  setPage(item.id);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors border ${
                  page === item.id
                    ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
                    : 'border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.03]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="px-4 py-4 mt-auto border-t border-amber-500/15">
            {wallet ? (
              <>
                <p className="text-xs text-zinc-400 font-mono truncate">{shortAddr(wallet, 10, 8)}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-amber-300/70">{cfg.network}</span>
                  <button onClick={handleSignOut} className="text-xs text-zinc-400 hover:text-zinc-200">
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full h-10 rounded-xl bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 disabled:opacity-50"
              >
                {connecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}

            {connectError && <p className="mt-2 text-xs text-red-300">{connectError}</p>}
          </div>
        </aside>

        <main className="flex-1">
          <header className="h-16 px-8 flex items-center justify-between border-b border-amber-500/15 bg-[#0a0a0a]/95 backdrop-blur">
            <h1 className="text-[15px] font-semibold tracking-wide">
              {page === 'home' ? 'Dashboard' : page === 'create' ? 'Create stream' : 'Streams'}
            </h1>
            {wallet && (
              <button
                onClick={() => setPage('create')}
                className="h-10 px-4 rounded-xl bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400"
              >
                + New stream
              </button>
            )}
          </header>

          <section className="p-8 max-w-[980px] mx-auto">
            {page === 'home' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-zinc-900 to-black p-10">
                  <h2 className="text-4xl font-semibold tracking-tight text-amber-100">Drip</h2>
                  <p className="mt-3 max-w-[560px] text-zinc-300 leading-relaxed">
                    USDC maaş akışlarını profesyonel bir panelden yönet. Fonları kontratta kilitle,
                    çalışanlar periyot doldukça güvenli şekilde claim etsin.
                  </p>
                  <div className="mt-7 flex gap-3">
                    <button
                      onClick={wallet ? () => setPage('create') : handleConnect}
                      className="h-11 px-6 rounded-xl bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400"
                    >
                      {wallet ? 'Create stream' : 'Connect wallet'}
                    </button>
                    {wallet && (
                      <button
                        onClick={() => setPage('streams')}
                        className="h-11 px-6 rounded-xl border border-amber-500/30 text-amber-100 hover:bg-amber-500/10"
                      >
                        View streams
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Tracked streams', value: stats.total },
                    { label: 'Readable', value: stats.healthy },
                    { label: 'Active', value: stats.active },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border border-amber-500/20 bg-[#0e0e0e] p-5">
                      <p className="text-xs uppercase tracking-wider text-zinc-500">{s.label}</p>
                      <p className="mt-2 text-3xl font-bold text-amber-200">{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {page === 'create' && (
              <div className="rounded-2xl border border-amber-500/20 bg-[#101010] p-6">
                {wallet ? (
                  <CreateStream walletAddress={wallet} onCreated={handleCreated} />
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-zinc-400 mb-4">Create stream için önce cüzdan bağla.</p>
                    <button
                      onClick={handleConnect}
                      className="h-10 px-5 rounded-xl bg-amber-500 text-black text-sm font-semibold"
                    >
                      Connect wallet
                    </button>
                  </div>
                )}
              </div>
            )}

            {page === 'streams' && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-amber-500/20 bg-[#101010] p-4 flex gap-3 items-center">
                  <input
                    value={watchId}
                    onChange={(e) => {
                      setWatchId(e.target.value);
                      setWatchErr('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && addWatchById()}
                    placeholder="Stream ID ekle (u64)…"
                    className="flex-1 h-10 rounded-xl border border-amber-500/15 bg-black/40 px-3 text-sm outline-none focus:border-amber-400/60"
                  />
                  <button
                    onClick={addWatchById}
                    className="h-10 px-4 rounded-xl bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400"
                  >
                    Add
                  </button>
                </div>

                {watchErr && <p className="text-sm text-red-300 -mt-2">{watchErr}</p>}

                {!wallet ? (
                  <div className="rounded-2xl border border-amber-500/15 bg-[#101010] p-12 text-center">
                    <p className="text-zinc-400 mb-4">Streams için cüzdan bağlantısı gerekiyor.</p>
                    <button
                      onClick={handleConnect}
                      className="h-10 px-5 rounded-xl bg-amber-500 text-black text-sm font-semibold"
                    >
                      Connect wallet
                    </button>
                  </div>
                ) : streamsLoading ? (
                  <div className="py-12 flex justify-center text-amber-300">
                    <Spinner size={20} />
                  </div>
                ) : streams.length === 0 ? (
                  <div className="rounded-2xl border border-amber-500/15 bg-[#101010] p-12 text-center">
                    <p className="text-zinc-400 mb-4">Henüz stream yok.</p>
                    <button
                      onClick={() => setPage('create')}
                      className="h-10 px-5 rounded-xl bg-amber-500 text-black text-sm font-semibold"
                    >
                      Create first stream
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {streams.map((row) =>
                      row.status === 'error' ? (
                        <div
                          key={row.id}
                          className="rounded-2xl border border-red-500/30 bg-red-900/10 p-4 text-sm text-red-200"
                        >
                          <p className="font-mono">#{row.id}</p>
                          <p className="mt-1 text-red-300/90">{row.error}</p>
                        </div>
                      ) : (
                        <StreamCard
                          key={row.id}
                          streamId={row.id}
                          stream={row.data}
                          walletAddress={wallet}
                          onClaim={() => onClaim(row.id)}
                          onCancel={() => onCancel(row.id)}
                          onRefresh={() => refreshSingle(row.id)}
                        />
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
