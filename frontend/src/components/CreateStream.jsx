import { useMemo, useState } from 'react';
import { createStream, formatTokenAmount, parseTokenAmount } from '../utils/stellar';

export default function CreateStream({ walletAddress, onCreated }) {
  const [form, setForm] = useState({
    employee: '',
    amountPerPeriod: '',
    intervalDays: '30',
    totalAmount: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const periodsPreview = useMemo(() => {
    try {
      const per = parseTokenAmount(form.amountPerPeriod || '0');
      const total = parseTokenAmount(form.totalAmount || '0');
      if (per <= 0n || total <= 0n) return null;
      return total / per;
    } catch {
      return null;
    }
  }, [form.amountPerPeriod, form.totalAmount]);

  function patch(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  }

  function validate() {
    const next = {};

    if (!form.employee.trim()) {
      next.employee = 'Çalışan adresi zorunlu.';
    } else if (!form.employee.startsWith('G') || form.employee.length !== 56) {
      next.employee = 'Geçerli bir Stellar adresi gir.';
    } else if (form.employee.trim() === walletAddress) {
      next.employee = 'İşveren ve çalışan aynı olamaz.';
    }

    let per = 0n;
    try {
      per = parseTokenAmount(form.amountPerPeriod || '0');
      if (per <= 0n) next.amountPerPeriod = 'Periyot miktarı sıfırdan büyük olmalı.';
    } catch {
      next.amountPerPeriod = 'Geçerli bir miktar gir.';
    }

    const days = Number.parseInt(form.intervalDays, 10);
    if (!Number.isInteger(days) || days < 1) {
      next.intervalDays = 'En az 1 gün olmalı.';
    }

    try {
      const total = parseTokenAmount(form.totalAmount || '0');
      if (total <= 0n) next.totalAmount = 'Toplam miktar sıfırdan büyük olmalı.';
      if (per > 0n && total < per) next.totalAmount = 'Toplam, periyottan küçük olamaz.';
    } catch {
      next.totalAmount = 'Geçerli bir toplam miktar gir.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    setLoading(true);
    try {
      const result = await createStream({
        employer: walletAddress,
        employee: form.employee.trim(),
        amountPerPeriod: form.amountPerPeriod.trim(),
        intervalDays: Number.parseInt(form.intervalDays, 10),
        totalAmount: form.totalAmount.trim(),
      });

      const id = String(result?.streamId ?? '');
      onCreated?.(id);

      setForm({ employee: '', amountPerPeriod: '', intervalDays: '30', totalAmount: '' });
      setErrors({});
    } catch (err) {
      setSubmitError(err?.message || 'Stream oluşturma başarısız.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight text-amber-100">Yeni ödeme akışı</h2>
        <p className="mt-1 text-sm text-zinc-400">
          USDC’yi kontratta kilitle, çalışan periyot doldukça güvenli şekilde claim etsin.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <Field label="İşveren" hint="Bağlı cüzdan adresi">
          <div className="h-11 rounded-xl border border-amber-500/20 bg-black/40 px-3 flex items-center font-mono text-sm text-zinc-300">
            {walletAddress}
          </div>
        </Field>

        <Field label="Çalışan adresi" error={errors.employee}>
          <input
            type="text"
            value={form.employee}
            onChange={(e) => patch('employee', e.target.value)}
            placeholder="G..."
            className={inputClass(!!errors.employee)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Periyot başına" error={errors.amountPerPeriod}>
            <div className="relative">
              <input
                type="number"
                min="0.0000001"
                step="0.0000001"
                value={form.amountPerPeriod}
                onChange={(e) => patch('amountPerPeriod', e.target.value)}
                placeholder="100"
                className={inputClass(!!errors.amountPerPeriod) + ' pr-16'}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">USDC</span>
            </div>
          </Field>

          <Field label="Periyot" error={errors.intervalDays}>
            <div className="relative">
              <input
                type="number"
                min="1"
                step="1"
                value={form.intervalDays}
                onChange={(e) => patch('intervalDays', e.target.value)}
                placeholder="30"
                className={inputClass(!!errors.intervalDays) + ' pr-14'}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">gün</span>
            </div>
          </Field>
        </div>

        <Field label="Toplam kilitlenecek" error={errors.totalAmount}>
          <div className="relative">
            <input
              type="number"
              min="0.0000001"
              step="0.0000001"
              value={form.totalAmount}
              onChange={(e) => patch('totalAmount', e.target.value)}
              placeholder="300"
              className={inputClass(!!errors.totalAmount) + ' pr-16'}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">USDC</span>
          </div>
        </Field>

        {periodsPreview !== null && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Özet</p>
            <p className="mt-2 text-sm text-zinc-200">
              ≈ <span className="font-semibold text-amber-200">{periodsPreview.toString()}</span> periyot
            </p>
            <p className="mt-1 text-sm text-zinc-300">
              {formatTokenAmount(parseTokenAmount(form.amountPerPeriod || '0'))} USDC / period
            </p>
          </div>
        )}

        {submitError && (
          <div className="rounded-xl border border-red-500/30 bg-red-900/15 px-4 py-3 text-sm text-red-200">
            {submitError}
          </div>
        )}

        <div className="pt-1 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="h-11 px-6 rounded-xl bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? 'Oluşturuluyor…' : 'Create stream'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1.5">{label}</label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function inputClass(hasError) {
  return `w-full h-11 rounded-xl border bg-black/40 px-3 text-sm outline-none transition-colors ${
    hasError
      ? 'border-red-500/50 text-red-100 placeholder:text-red-300/40'
      : 'border-amber-500/20 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/60'
  }`;
}
