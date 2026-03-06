import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelStream,
  claimStream,
  explorerLink,
  formatTokenAmount,
  readClaimable,
  shortAddr,
  parseI128ToBigInt,
} from '../utils/stellar';
import { Spinner } from '../App.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Countdown hook — counts down to a unix timestamp, updates every second
// ─────────────────────────────────────────────────────────────────────────────
function useCountdown(targetTs) {
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false); // true when next claim is due (diff ≤ 0)

  useEffect(() => {
    if (!targetTs) { setText(''); setReady(false); return; }

    const update = () => {
      const diff = targetTs - Math.floor(Date.now() / 1000);
      if (diff <= 0) {
        setText('Available now');
        setReady(true);
        return;
      }
      setReady(false);
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      if (d > 0)      setText(`${d}d ${h}h ${m}m`);
      else if (h > 0) setText(`${h}h ${m}m ${s}s`);
      else            setText(`${m}m ${s}s`);
    };

    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [targetTs]);

  return { text, ready };
}

// ─────────────────────────────────────────────────────────────────────────────
export default function StreamCard({ stream, streamId, walletAddress, onRefresh }) {
  const [claimable,   setClaimable]  = useState(0n);
  const [actionState, setAction]    = useState({ status: 'idle', error: '' });
  const [lastTx,      setLastTx]    = useState('');

  const isEmployer = walletAddress === stream?.employer;
  const isEmployee = walletAddress === stream?.employee;

  // ── Derived ───────────────────────────────────────────────────────────────
  const total     = parseI128ToBigInt(stream?.totalAmount   ?? 0);
  const claimed   = parseI128ToBigInt(stream?.claimedAmount ?? 0);
  const remaining = total > claimed ? total - claimed : 0n;
  const pct       = total > 0n ? Number((claimed * 1000n) / total) / 10 : 0;

  const intervalDays = useMemo(() => {
    const s = Number(stream?.intervalSeconds ?? 0n);
    return s ? Math.round(s / 86400) : 0;
  }, [stream]);

  const startDate = useMemo(() => {
    const ts = Number(stream?.startTime ?? 0n);
    return ts ? new Date(ts * 1000).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    }) : '—';
  }, [stream]);

  const lastClaimDate = useMemo(() => {
    const ts = Number(stream?.lastClaimTime ?? 0n);
    return ts && claimed > 0n
      ? new Date(ts * 1000).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
        })
      : '—';
  }, [stream, claimed]);

  // ── Next claim timestamp ──────────────────────────────────────────────────
  const nextClaimTs = useMemo(() => {
    const start    = Number(stream?.startTime      ?? 0n);
    const interval = Number(stream?.intervalSeconds ?? 0n);
    const lastClaim= Number(stream?.lastClaimTime  ?? 0n);
    if (!start || !interval) return null;
    const base = lastClaim > 0 ? lastClaim : start;
    return base + interval;
  }, [stream]);

  const { text: countdownText, ready: claimReady } = useCountdown(
    stream?.active ? nextClaimTs : null
  );

  // ── Claimable ─────────────────────────────────────────────────────────────
  const refreshClaimable = useCallback(async () => {
    if (!walletAddress || streamId == null) return;
    try {
      const v = await readClaimable(walletAddress, streamId);
      setClaimable(parseI128ToBigInt(v));
    } catch { setClaimable(0n); }
  }, [walletAddress, streamId]);

  useEffect(() => {
    refreshClaimable();
    const t = setInterval(refreshClaimable, 30_000);
    return () => clearInterval(t);
  }, [refreshClaimable]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const onClaim = async () => {
    setAction({ status: 'loading', error: '' });
    try {
      const tx = await claimStream(walletAddress, streamId);
      setLastTx(tx?.txHash ?? '');
      await Promise.all([onRefresh?.(), refreshClaimable()]);
      setAction({ status: 'success', error: '' });
    } catch (e) {
      setAction({ status: 'error', error: e.message || 'Claim failed.' });
    }
  };

  const onCancel = async () => {
    if (!window.confirm('Cancel this stream? Remaining USDC will be returned to you.')) return;
    setAction({ status: 'loading', error: '' });
    try {
      const tx = await cancelStream(walletAddress, streamId);
      setLastTx(tx?.txHash ?? '');
      await onRefresh?.();
      setAction({ status: 'success', error: '' });
    } catch (e) {
      setAction({ status: 'error', error: e.message || 'Cancel failed.' });
    }
  };

  const busy = actionState.status === 'loading';

  return (
    <div className="rounded-xl border border-[#1e1e1e] bg-[#111111] overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2.5">
          <StatusPill active={stream?.active} />
          {streamId != null && (
            <span className="text-[11px] font-mono text-[#2a2a2a] num">#{streamId}</span>
          )}
        </div>
        <button
          onClick={onRefresh} disabled={busy}
          className="text-[11px] text-[#333] hover:text-[#666] transition-colors flex items-center gap-1.5 disabled:opacity-40"
        >
          <RefreshIcon /> Refresh
        </button>
      </div>

      {/* ── Employer → Employee ─────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-[#3a3a3a] mb-1">Employer</p>
          <p className="font-mono text-[12px] text-[#666] truncate">{shortAddr(stream?.employer, 8, 6)}</p>
        </div>
        <ArrowRight />
        <div className="flex-1 min-w-0 text-right">
          <p className="text-[10px] font-medium uppercase tracking-wider text-[#3a3a3a] mb-1">Employee</p>
          <p className="font-mono text-[12px] text-[#666] truncate">{shortAddr(stream?.employee, 8, 6)}</p>
        </div>
      </div>

      {/* ── Progress ────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-[#1a1a1a]">
        <div className="flex items-end justify-between mb-2.5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[#3a3a3a] mb-1">Progress</p>
            <p className="text-[13px] font-medium text-[#e8e8eb] num">
              {formatTokenAmount(claimed)}
              <span className="text-[#3a3a3a] font-normal"> / {formatTokenAmount(total)} USDC</span>
            </p>
          </div>
          <span className="text-[12px] text-[#3a3a3a] num">{pct.toFixed(1)}%</span>
        </div>
        <div className="h-1 rounded-full bg-[#1a1a1a] overflow-hidden">
          <div
            className="h-full rounded-full bg-white/60 transition-all duration-700"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      {/* ── Countdown (employee only, active stream) ─────────────────────── */}
      {isEmployee && stream?.active && nextClaimTs && (
        <div className={`px-5 py-3 border-b border-[#1a1a1a] flex items-center justify-between ${
          claimReady ? 'bg-[#0d1a0d]' : ''
        }`}>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[#3a3a3a] mb-0.5">
              {claimReady ? 'Next claim' : 'Next claim in'}
            </p>
            <p className={`text-[13px] font-semibold num tracking-tight ${
              claimReady ? 'text-emerald-400' : 'text-[#888]'
            }`}>
              {claimReady ? 'Available now' : countdownText}
            </p>
          </div>
          {claimReady && (
            <span className="text-[10px] font-medium text-emerald-400/60 uppercase tracking-wider">
              {formatTokenAmount(stream?.amountPerPeriod)} USDC ready
            </span>
          )}
        </div>
      )}

      {/* ── Details ─────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-[#1a1a1a] grid grid-cols-2 gap-x-6 gap-y-3">
        <Stat label="Per period"  value={`${formatTokenAmount(stream?.amountPerPeriod)} USDC`} />
        <Stat label="Interval"    value={`${intervalDays} days`} />
        <Stat label="Remaining"   value={`${formatTokenAmount(remaining)} USDC`} />
        <Stat label="Started"     value={startDate} />
        <Stat label="Last claim"  value={lastClaimDate} />
      </div>

      {/* ── Claimable / Cancel ──────────────────────────────────────────── */}
      <div className="px-5 py-4">
        {isEmployee && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[#3a3a3a] mb-1">
                Available to claim
              </p>
              <p className={`text-[22px] font-semibold num tracking-tight leading-none ${
                claimable > 0n ? 'text-[#e8e8eb]' : 'text-[#2a2a2a]'
              }`}>
                {formatTokenAmount(claimable)}
                <span className="text-[13px] font-normal text-[#3a3a3a] ml-1.5">USDC</span>
              </p>
            </div>
            <button
              onClick={onClaim}
              disabled={busy || !stream?.active || claimable <= 0n}
              className="flex items-center gap-2 h-9 px-5 bg-white hover:bg-[#e8e8e8] active:bg-[#d4d4d4] disabled:opacity-25 disabled:cursor-not-allowed rounded-lg text-[13px] font-semibold text-[#0c0c0c] transition-colors"
            >
              {busy ? <Spinner size={13} color="#333" /> : null}
              Claim
            </button>
          </div>
        )}

        {isEmployer && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[#3a3a3a] mb-1">
                Remaining in escrow
              </p>
              <p className="text-[22px] font-semibold num tracking-tight leading-none text-[#e8e8eb]">
                {formatTokenAmount(remaining)}
                <span className="text-[13px] font-normal text-[#3a3a3a] ml-1.5">USDC</span>
              </p>
            </div>
            {stream?.active && (
              <button
                onClick={onCancel} disabled={busy}
                className="flex items-center gap-2 h-9 px-5 rounded-lg border border-[#3a1818] bg-[#1a0e0e] hover:bg-[#220e0e] disabled:opacity-30 disabled:cursor-not-allowed text-[13px] font-medium text-red-400 transition-colors"
              >
                {busy ? <Spinner size={13} /> : null}
                Cancel stream
              </button>
            )}
          </div>
        )}

        {!isEmployee && !isEmployer && (
          <p className="text-[12px] text-[#2a2a2a]">Read-only view</p>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      {(actionState.error || lastTx) && (
        <div className="border-t border-[#1a1a1a] px-5 py-3 space-y-1.5">
          {actionState.error && (
            <p className="text-[11px] text-red-400 break-all leading-relaxed">{actionState.error}</p>
          )}
          {lastTx && (
            <a href={explorerLink(lastTx)} target="_blank" rel="noreferrer"
              className="text-[11px] font-mono text-[#444] hover:text-[#888] transition-colors flex items-center gap-1">
              Last tx: {lastTx.slice(0, 12)}…{lastTx.slice(-8)}
              <span className="text-[10px]">↗</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function StatusPill({ active }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
      active
        ? 'bg-[#0d1a0d] border-[#1e3a1e] text-emerald-400'
        : 'bg-[#181818] border-[#222] text-[#444]'
    }`}>
      <span className={`w-1 h-1 rounded-full flex-shrink-0 ${active ? 'bg-emerald-400' : 'bg-[#3a3a3a]'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-[#3a3a3a] mb-0.5">{label}</p>
      <p className="text-[12px] text-[#777] num">{value ?? '—'}</p>
    </div>
  );
}

function ArrowRight() {
  return (
    <svg className="w-4 h-4 text-[#252525] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
