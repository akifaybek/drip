import { useState } from 'react';
import {
  createStream,
  explorerLink,
  getConfig,
  parseTokenAmount,
  formatTokenAmount,
} from '../utils/stellar';
import { Spinner } from '../App.jsx';

const EMPTY = { employee: '', amountPerPeriod: '', intervalDays: '30', totalAmount: '' };

export default function CreateStream({ walletAddress, onSuccess }) {
  const [form,     setForm]     = useState(EMPTY);
  const [errors,   setErrors]   = useState({});
  const [loading,  setLoading]  = useState(false);
  const [txResult, setTxResult] = useState(null);
  const [txError,  setTxError]  = useState('');

  const { network } = getConfig();

  const set = (name, value) => {
    setForm(p => ({ ...p, [name]: value }));
    if (errors[name]) setErrors(p => ({ ...p, [name]: '' }));
  };

  const handleAmountChange = (e) => {
    set('amountPerPeriod', e.target.value);
    if (e.target.value && !form.totalAmount) {
      try {
        const sug = formatTokenAmount(parseTokenAmount(e.target.value) * 3n);
        setForm(p => ({ ...p, amountPerPeriod: e.target.value, totalAmount: sug }));
      } catch { /* ignore */ }
    }
  };

  const validate = () => {
    const e = {};
    if (!form.employee.trim())
      e.employee = 'Required';
    else if (!form.employee.startsWith('G') || form.employee.length !== 56)
      e.employee = 'Invalid address — must start with G and be 56 characters';
    else if (form.employee === walletAddress)
      e.employee = 'Cannot be the same as employer';

    let ppBI = 0n;
    if (!form.amountPerPeriod.trim()) {
      e.amountPerPeriod = 'Required';
    } else {
      try { ppBI = parseTokenAmount(form.amountPerPeriod); if (ppBI <= 0n) e.amountPerPeriod = 'Must be greater than 0'; }
      catch { e.amountPerPeriod = 'Invalid amount'; }
    }

    const days = parseInt(form.intervalDays);
    if (!form.intervalDays || isNaN(days) || days < 1) e.intervalDays = 'Minimum 1 day';

    if (!form.totalAmount.trim()) {
      e.totalAmount = 'Required';
    } else {
      try {
        const t = parseTokenAmount(form.totalAmount);
        if (t <= 0n) e.totalAmount = 'Must be greater than 0';
        else if (ppBI > 0n && t < ppBI) e.totalAmount = 'Must be at least equal to amount per period';
      } catch { e.totalAmount = 'Invalid amount'; }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true); setTxError('');
    try {
      const result = await createStream({
        employer:        walletAddress,
        employee:        form.employee.trim(),
        amountPerPeriod: parseTokenAmount(form.amountPerPeriod),
        intervalDays:    parseInt(form.intervalDays, 10),
        totalAmount:     parseTokenAmount(form.totalAmount),
      });
      setTxResult(result);
      setForm(EMPTY);
    } catch (err) {
      setTxError(err.message ?? 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const preview = (() => {
    try {
      const a = parseTokenAmount(form.amountPerPeriod);
      const t = parseTokenAmount(form.totalAmount);
      if (a > 0n && t >= a) return { periods: (t / a).toString() };
    } catch { /* ignore */ }
    return null;
  })();

  const formValid = form.employee && form.amountPerPeriod && form.intervalDays && form.totalAmount && !Object.values(errors).some(Boolean);

  if (txResult) return <SuccessCard result={txResult} onDone={() => onSuccess?.(txResult?.streamId)} />;

  return (
    <div>
      {/* Page title line */}
      <div className="mb-6">
        <p className="text-[13px] text-[#555555]">
          Lock USDC in escrow — the recipient claims each period as they earn it. Automatic, trustless, on-chain.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Paying from — readonly */}
        <div>
          <FieldLabel>Paying from</FieldLabel>
          <div className="flex items-center gap-2.5 h-9 px-3 rounded-lg border border-[#222222] bg-[#111111]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 pulse-slow" />
            <span className="font-mono text-[11px] text-[#555555] truncate">{walletAddress}</span>
          </div>
        </div>

        {/* Recipient address */}
        <Field label="Recipient address" error={errors.employee} hint="Stellar address that will receive payments">
          <input
            value={form.employee}
            onChange={e => set('employee', e.target.value)}
            placeholder="GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
            autoComplete="off" spellCheck={false}
            className={inp(errors.employee)}
          />
        </Field>

        {/* Amount + Interval row */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount per period" error={errors.amountPerPeriod}>
            <div className="relative">
              <input
                type="number" value={form.amountPerPeriod} onChange={handleAmountChange}
                placeholder="100" min="0" step="any"
                className={inp(errors.amountPerPeriod) + ' pr-14'}
              />
              <Badge>USDC</Badge>
            </div>
          </Field>
          <Field label="Interval" error={errors.intervalDays}>
            <div className="relative">
              <input
                type="number" value={form.intervalDays}
                onChange={e => set('intervalDays', e.target.value)}
                placeholder="30" min="1" step="1"
                className={inp(errors.intervalDays) + ' pr-14'}
              />
              <Badge>days</Badge>
            </div>
          </Field>
        </div>

        {/* Total to lock */}
        <Field label="Total amount to lock" error={errors.totalAmount}
          hint={preview ? `Covers ${preview.periods} payment period${preview.periods !== '1' ? 's' : ''}` : undefined}>
          <div className="relative">
            <input
              type="number" value={form.totalAmount}
              onChange={e => set('totalAmount', e.target.value)}
              placeholder="300" min="0" step="any"
              className={inp(errors.totalAmount) + ' pr-14'}
            />
            <Badge>USDC</Badge>
          </div>
        </Field>

        {/* Summary */}
        {formValid && preview && (
          <div className="rounded-lg border border-[#222222] bg-[#111111] divide-y divide-[#1a1a1a]">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-[11px] text-[#555]">Per period</span>
              <span className="text-[12px] font-medium text-[#aaa] num">
                {form.amountPerPeriod} USDC every {form.intervalDays} days
              </span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-[11px] text-[#555]">Periods covered</span>
              <span className="text-[12px] font-medium text-[#aaa] num">~{preview.periods}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-[11px] text-[#555]">Locking in escrow</span>
              <span className="text-[12px] font-semibold text-[#e8e8eb] num">{form.totalAmount} USDC</span>
            </div>
          </div>
        )}

        {/* TX error */}
        {txError && (
          <div className="rounded-lg border border-[#3a1818] bg-[#1a0e0e] px-4 py-3">
            <p className="text-[12px] font-medium text-red-400 mb-1">Transaction failed</p>
            <p className="text-[11px] text-[#7a3030] break-all leading-relaxed">{txError}</p>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-[#1a1a1a] pt-4 flex items-center justify-between gap-4">
          <p className="text-[11px] text-[#333]">
            Stellar {network} · Gas calculated by Freighter
          </p>
          <button
            type="submit" disabled={loading}
            className="flex items-center gap-2 h-9 px-5 bg-white hover:bg-[#e8e8e8] active:bg-[#d4d4d4] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-[13px] font-semibold text-[#0c0c0c] transition-colors flex-shrink-0"
          >
            {loading ? (
              <><Spinner size={13} color="#333" /> Confirm in Freighter…</>
            ) : (
              'Lock & start stream →'
            )}
          </button>
        </div>

      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Success
// ─────────────────────────────────────────────────────────────────────────────
function SuccessCard({ result, onDone }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full border border-[#1e3a1e] bg-[#0d1a0d] flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-[14px] font-semibold text-[#e8e8eb]">Stream created</p>
          {result?.streamId != null && (
            <p className="text-[12px] text-[#555]">Stream #{result.streamId}</p>
          )}
        </div>
      </div>

      <p className="text-[13px] text-[#555] leading-relaxed">
        USDC is locked in escrow. The recipient can now claim their earnings each period.
      </p>

      {result?.txHash && (
        <div className="flex items-center justify-between rounded-lg border border-[#1e1e1e] bg-[#111111] px-4 py-3">
          <span className="text-[11px] text-[#444]">Transaction</span>
          <a href={explorerLink(result.txHash)} target="_blank" rel="noreferrer"
            className="text-[11px] font-mono text-[#555] hover:text-[#888] transition-colors">
            {result.txHash.slice(0, 12)}…{result.txHash.slice(-8)} ↗
          </a>
        </div>
      )}

      <button
        onClick={onDone}
        className="flex items-center gap-1.5 h-9 px-5 bg-white hover:bg-[#e8e8e8] rounded-lg text-[13px] font-semibold text-[#0c0c0c] transition-colors"
      >
        View streams →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────
function FieldLabel({ children }) {
  return <p className="text-[11px] font-medium text-[#555555] mb-1.5">{children}</p>;
}

function Field({ label, error, hint, children }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {error && <p className="mt-1.5 text-[11px] text-red-400 leading-relaxed">{error}</p>}
      {hint && !error && <p className="mt-1.5 text-[11px] text-[#3a3a3a]">{hint}</p>}
    </div>
  );
}

function Badge({ children }) {
  return (
    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-[#3a3a3a] pointer-events-none select-none">
      {children}
    </span>
  );
}

const inp = (err) =>
  `w-full h-9 bg-[#111111] border ${
    err
      ? 'border-red-900/60 focus:border-red-600/60'
      : 'border-[#222222] focus:border-[#3a3a3a]'
  } rounded-lg px-3 text-[13px] text-[#e8e8eb] placeholder-[#333333] outline-none transition-colors`;
