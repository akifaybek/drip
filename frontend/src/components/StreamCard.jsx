import { useMemo, useState } from 'react';
import { formatTokenAmount, parseI128ToBigInt, shortAddr } from '../utils/stellar';

function ConfirmDialog({ open, onClose, onConfirm }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-zinc-950 p-5">
        <h4 className="text-lg font-semibold text-red-200">Stream iptal edilsin mi?</h4>
        <p className="mt-2 text-sm text-zinc-300">Kalan bakiye işverene iade edilir ve stream pasife düşer.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
          >
            Vazgeç
          </button>
          <button
            onClick={onConfirm}
            className="h-10 px-4 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-500"
          >
            Evet, iptal et
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StreamCard({
  streamId,
  stream,
  walletAddress,
  onClaim,
  onCancel,
  onRefresh,
}) {
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  const employer = stream?.employer || '';
  const employee = stream?.employee || '';

  const amountPerPeriod = parseI128ToBigInt(stream?.amountPerPeriod ?? 0n);
  const totalAmount = parseI128ToBigInt(stream?.totalAmount ?? 0n);
  const claimedAmount = parseI128ToBigInt(stream?.claimedAmount ?? 0n);
  const remaining = totalAmount > claimedAmount ? totalAmount - claimedAmount : 0n;

  const isEmployer = walletAddress === employer;
  const isEmployee = walletAddress === employee;
  const active = Boolean(stream?.active);

  const progress = useMemo(() => {
    if (totalAmount <= 0n) return 0;
    return Math.min(100, Number((claimedAmount * 10000n) / totalAmount) / 100);
  }, [claimedAmount, totalAmount]);

  async function doClaim() {
    setLoading('claim');
    setError('');
    try {
      await onClaim?.();
      await onRefresh?.();
    } catch (e) {
      setError(e?.message || 'Claim başarısız.');
    } finally {
      setLoading('');
    }
  }

  async function doCancel() {
    setLoading('cancel');
    setError('');
    try {
      await onCancel?.();
      setCancelOpen(false);
    } catch (e) {
      setError(e?.message || 'Cancel başarısız.');
    } finally {
      setLoading('');
    }
  }

  return (
    <>
      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={doCancel} />

      <article className="rounded-2xl border border-amber-500/20 bg-[#101010] overflow-hidden">
        <header className="px-5 py-3.5 border-b border-amber-500/15 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-500">Stream ID</p>
            <p className="font-mono text-sm text-zinc-200">{String(streamId)}</p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 text-xs rounded-full border ${
                active
                  ? 'border-emerald-500/35 text-emerald-200 bg-emerald-500/10'
                  : 'border-zinc-700 text-zinc-300 bg-zinc-800/40'
              }`}
            >
              {active ? 'Active' : 'Inactive'}
            </span>
            <button
              onClick={onRefresh}
              className="h-8 px-3 rounded-lg border border-amber-500/20 text-amber-100 hover:bg-amber-500/10 text-xs"
            >
              Refresh
            </button>
          </div>
        </header>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Info label="Employer" value={shortAddr(employer, 10, 8)} mono />
            <Info label="Employee" value={shortAddr(employee, 10, 8)} mono />
            <Info label="Per period" value={`${formatTokenAmount(amountPerPeriod)} USDC`} />
            <Info label="Total" value={`${formatTokenAmount(totalAmount)} USDC`} />
            <Info label="Claimed" value={`${formatTokenAmount(claimedAmount)} USDC`} />
            <Info label="Remaining" value={`${formatTokenAmount(remaining)} USDC`} />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-zinc-500 uppercase tracking-wider">Progress</span>
              <span className="text-amber-200 font-semibold">{progress.toFixed(2)}%</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            {isEmployee && (
              <button
                onClick={doClaim}
                disabled={!active || loading === 'claim'}
                className="h-10 px-4 rounded-xl bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 disabled:opacity-50"
              >
                {loading === 'claim' ? 'Claiming…' : 'Claim'}
              </button>
            )}

            {isEmployer && (
              <button
                onClick={() => setCancelOpen(true)}
                disabled={!active || loading === 'cancel'}
                className="h-10 px-4 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
              >
                {loading === 'cancel' ? 'Cancelling…' : 'Cancel stream'}
              </button>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-900/15 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>
      </article>
    </>
  );
}

function Info({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border border-amber-500/15 bg-black/35 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-sm text-zinc-100 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}
