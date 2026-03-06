/* global BigInt */

/**
 * utils/stellar.js
 *
 * Drip — Blockchain Layer
 * ─────────────────────────────────
 * Tüm Soroban kontrat çağrıları, Freighter cüzdan entegrasyonu
 * ve yardımcı fonksiyonlar burada toplanmıştır.
 *
 * Bağımlılıklar:
 *   @stellar/stellar-sdk   ^12.x
 *   @stellar/freighter-api ^2.x
 */

import {
  rpc as SorobanRpc,   // stellar-sdk v14: "SorobanRpc" → "rpc"
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Address,
  scValToNative,
} from '@stellar/stellar-sdk';

import {
  isConnected,  // v6: { isConnected: boolean } döndürüyor
  requestAccess,
  getAddress,   // v6'da getPublicKey() → getAddress() oldu, { address: string } döndürüyor
  signTransaction, // v6: opts = { networkPassphrase?, address? }
} from '@stellar/freighter-api';

// ── Ortam yapılandırması ──────────────────────────────────────────────────────

export function getConfig() {
  const networkRaw = (process.env.REACT_APP_NETWORK ?? 'testnet').toLowerCase();
  const network = networkRaw === 'public' ? 'public' : 'testnet';

  return {
    contractId: process.env.REACT_APP_CONTRACT_ID ?? '',
    network,
    rpcUrl: process.env.REACT_APP_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    usdcAddress: process.env.REACT_APP_USDC_ADDRESS ?? '',
    usdcDecimals: Number(process.env.REACT_APP_USDC_DECIMALS ?? '7'),
  };
}

const {
  contractId: CONTRACT_ID,
  network,
  rpcUrl: RPC_URL,
  usdcAddress: USDC_TOKEN_ID,
  usdcDecimals: USDC_DECIMALS,
} = getConfig();
const NETWORK_PASSPHRASE = network === 'public' ? Networks.PUBLIC : Networks.TESTNET;

/** İşlem onaylanana kadar maksimum bekleme (saniye) */
const TX_TIMEOUT_ATTEMPTS = 30;

/** Global tx lifecycle durumları */
export const TX_STATUS = Object.freeze({
  IDLE: 'idle',
  SIMULATING: 'simulating',
  SIGNING: 'signing',
  SUBMITTING: 'submitting',
  CONFIRMING: 'confirming',
  DONE: 'done',
  ERROR: 'error',
});

const txStatusListeners = new Set();

/**
 * Global tx status dinleyicisi ekler.
 * @param {(payload: {status: string, method?: string, txHash?: string, message?: string, error?: string, stage?: string}) => void} listener
 * @returns {() => void}
 */
export const subscribeTxStatus = (listener) => {
  if (typeof listener !== 'function') return () => {};
  txStatusListeners.add(listener);
  return () => txStatusListeners.delete(listener);
};

const _emitTxStatus = (payload) => {
  for (const listener of txStatusListeners) {
    try {
      listener(payload);
    } catch {
      // listener hataları akışı bozmasın
    }
  }
};

// ── BigInt & token amount yardımcıları ────────────────────────────────────────

/**
 * Soroban i128/ScVal çıktısını güvenli BigInt'e çevirir.
 * @param {unknown} value
 * @returns {bigint}
 */
export const parseI128ToBigInt = (value) => {
  if (value == null) return 0n;
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new Error('i128 değeri güvenli Number aralığı dışında. BigInt/string bekleniyor.');
    }
    return BigInt(value);
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return 0n;
    return BigInt(s);
  }

  if (typeof value === 'object' && value !== null && typeof value.toString === 'function') {
    const s = value.toString();
    if (!s) return 0n;
    return BigInt(s);
  }

  throw new Error('i128 değeri BigInt’e çevrilemedi.');
};

/**
 * BigInt değeri Soroban i128 argümanına çevirir.
 * @param {bigint|number|string} bi
 * @returns {any}
 */
export const bigintToI128Arg = (bi) =>
  nativeToScVal(parseI128ToBigInt(bi), { type: 'i128' });

/**
 * Decimal kullanıcı girdisini token alt birimine çevirir.
 * @param {string|number|bigint} amount
 * @param {number} [decimals=USDC_DECIMALS]
 * @returns {bigint}
 */
export const parseTokenAmount = (amount, decimals = USDC_DECIMALS) => {
  if (typeof amount === 'bigint') return amount;

  const s = String(amount ?? '').trim();
  if (!s) return 0n;
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error('Geçersiz miktar formatı.');
  }

  const [whole = '0', fraction = ''] = s.split('.');
  const fracPadded = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(fracPadded || '0');
};

/**
 * Token alt birimini (BigInt) okunabilir decimal string'e çevirir.
 * @param {bigint|number|string} amount
 * @param {number} [decimals=USDC_DECIMALS]
 * @returns {string}
 */
export const formatTokenAmount = (amount, decimals = USDC_DECIMALS) => {
  const n = parseI128ToBigInt(amount);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const base = 10n ** BigInt(decimals);

  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const full = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${full}` : full;
};

/**
 * Stroops → kullanıcıya gösterilecek USDC string'i
 * @param {bigint|number|string} stroops
 * @returns {string}
 */
export const formatUSDC = (stroops) => formatTokenAmount(stroops, USDC_DECIMALS);

/**
 * Kullanıcının girdiği USDC string'i → stroops BigInt
 * @param {string|number|bigint} usdc
 * @returns {bigint}
 */
export const parseUSDC = (usdc) => parseTokenAmount(usdc, USDC_DECIMALS);

/**
 * Stellar adresini kısalt: GABCD…XYZ4
 * @param {string} addr
 * @param {number} [head=8]
 * @param {number} [tail=6]
 */
export const shortAddr = (addr, head = 8, tail = 6) =>
  addr ? `${addr.slice(0, head)}…${addr.slice(-tail)}` : '—';

/** Stellar Expert explorer linki */
export const explorerLink = (hash) => {
  const { network } = getConfig();
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
};

// ── Freighter cüzdan işlemleri ────────────────────────────────────────────────

/**
 * Freighter'ı kontrol eder, erişim ister ve public key döner.
 * @returns {Promise<string>} Stellar public key (G…)
 */
export const connectWallet = async () => {
  // freighter-api v6: isConnected() artık boolean değil { isConnected: boolean } dönüyor
  const connResult = await isConnected();
  const connected = typeof connResult === 'boolean' ? connResult : connResult?.isConnected === true;
  if (!connected) {
    throw new Error(
      'Freighter cüzdanı bulunamadı. Lütfen https://freighter.app adresinden yükleyin.'
    );
  }
  await requestAccess();
  return _getKey();
};

/**
 * Zaten bağlı olan Freighter'dan public key okur (erişim istemez).
 * @returns {Promise<string|null>}
 */
export const getWalletAddress = async () => {
  try {
    return await _getKey();
  } catch {
    return null;
  }
};

/** freighter-api v6: getPublicKey() → getAddress(), döner { address, error? } */
const _getKey = async () => {
  const result = await getAddress();
  if (result?.error) throw new Error(result.error.message ?? 'Cüzdan adresi alınamadı.');
  const pk = result?.address;
  if (!pk) throw new Error('Cüzdan adresi alınamadı.');
  return pk;
};

// ── Soroban altyapısı ─────────────────────────────────────────────────────────

/** @returns {SorobanRpc.Server} */
const getServer = () =>
  new SorobanRpc.Server(RPC_URL, { allowHttp: false });

/** @returns {Contract} */
const getContract = () => {
  if (!CONTRACT_ID) throw new Error('REACT_APP_CONTRACT_ID .env içinde tanımlı değil.');
  return new Contract(CONTRACT_ID);
};

/**
 * Soroban işlemini gönderir ve teyide kadar bekler.
 * Adımlar: Build → Simulate → Assemble → Sign → Submit → Poll
 *
 * @param {string} publicKey  - İşlemi imzalayacak adres
 * @param {string} method     - Kontrat fonksiyon adı
 * @param {Array}  [args=[]]  - ScVal argüman dizisi
 * @returns {Promise<object>} - getTransaction sonucu
 */
export const invokeContract = async (publicKey, method, args = []) =>
  submitContractTx({ publicKey, method, args });

/**
 * Tx lifecycle helper: simulate -> sign -> send -> poll
 * @param {{publicKey: string, method: string, args?: Array}} params
 * @returns {Promise<object>}
 */
export const submitContractTx = async ({ publicKey, method, args = [] }) => {
  const server = getServer();
  const contract = getContract();

  try {
    const account = await server.getAccount(publicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();

    _emitTxStatus({ status: TX_STATUS.SIMULATING, method, message: 'İşlem simüle ediliyor…' });
    const simResult = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw _txStageError('simulate', method, `Simülasyon hatası: ${simResult.error}`);
    }

    const readyTx = SorobanRpc.assembleTransaction(tx, simResult).build();

    _emitTxStatus({ status: TX_STATUS.SIGNING, method, message: 'Freighter imzası bekleniyor…' });
    let signResult;
    try {
      // freighter-api v6: opts = { networkPassphrase?, address? }
      // (eski: network, accountToSign — v6'da kaldırıldı)
      signResult = await signTransaction(readyTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: publicKey,
      });
    } catch (e) {
      throw _txStageError('sign', method, e?.message || 'İmzalama başarısız.');
    }

    // v6: { signedTxXdr: string, signerAddress: string, error? }
    if (signResult?.error) {
      throw _txStageError('sign', method, signResult.error.message ?? 'İmzalama iptal edildi.');
    }
    const signedXDR = signResult?.signedTxXdr;
    if (!signedXDR) {
      throw _txStageError('sign', method, 'İmzalama iptal edildi veya başarısız.');
    }

    _emitTxStatus({ status: TX_STATUS.SUBMITTING, method, message: 'İşlem ağa gönderiliyor…' });
    let submitted;
    try {
      const signedTx = TransactionBuilder.fromXDR(signedXDR, NETWORK_PASSPHRASE);
      submitted = await server.sendTransaction(signedTx);
    } catch (e) {
      throw _txStageError('send', method, e?.message || 'Ağa gönderim başarısız.');
    }

    if (submitted.status === 'ERROR') {
      const detail = submitted.errorResult?.toXDR?.('base64') ?? 'bilinmiyor';
      throw _txStageError('send', method, `Gönderme hatası: ${detail}`);
    }

    _emitTxStatus({
      status: TX_STATUS.CONFIRMING,
      method,
      txHash: submitted.hash,
      message: 'On-chain onay bekleniyor…',
    });

    try {
      const result = await _waitForTx(server, submitted.hash);
      _emitTxStatus({
        status: TX_STATUS.DONE,
        method,
        txHash: submitted.hash,
        message: 'İşlem başarıyla onaylandı.',
      });
      setTimeout(() => _emitTxStatus({ status: TX_STATUS.IDLE, method }), 2000);
      return result;
    } catch (e) {
      throw _txStageError('confirm', method, e?.message || 'Onay alınamadı.');
    }
  } catch (e) {
    const stage = e?.stage || 'unknown';
    _emitTxStatus({
      status: TX_STATUS.ERROR,
      method,
      stage,
      error: e?.message || 'Bilinmeyen işlem hatası.',
      message: `İşlem başarısız (${stage}).`,
    });
    throw e;
  }
};

/** İşlem hash'ini poll eder, SUCCESS / FAILED durumunu döner */
const _waitForTx = async (server, hash) => {
  for (let i = 0; i < TX_TIMEOUT_ATTEMPTS; i++) {
    const result = await server.getTransaction(hash);

    if (result.status === 'SUCCESS') {
      return { ...result, txHash: hash, explorerUrl: explorerLink(hash) };
    }
    if (result.status === 'FAILED') {
      throw new Error(
        `İşlem başarısız. Hash: ${hash}\n${result.resultXdr ?? ''}`
      );
    }
    // NOT_FOUND → hâlâ işleniyor, bekle
    await _sleep(2000);
  }
  throw new Error(`İşlem zaman aşımı. Hash: ${hash}`);
};

/**
 * Salt okunur kontrat çağrısı — sadece simülasyon yapar.
 * State değiştirmez, Freighter imzası gerekmez.
 *
 * @param {string} publicKey
 * @param {string} method
 * @param {Array}  [args=[]]
 * @returns {Promise<any>} scValToNative ile dönüştürülmüş sonuç
 */
export const readContract = async (publicKey, method, args = []) => {
  const server   = getServer();
  const contract = getContract();
  const account  = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(account, {
    fee:               BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Okuma hatası (${method}): ${simResult.error}`);
  }
  if (!simResult.result?.retval) return null;

  return scValToNative(simResult.result.retval);
};

// ── Yüksek seviye kontrat fonksiyonları ──────────────────────────────────────

/**
 * Yeni ödeme akışı oluşturur.
 *
 * @param {object} params
 * @param {string} params.employer         - İşveren Stellar adresi
 * @param {string} params.employee         - Çalışan Stellar adresi
 * @param {string} params.amountPerPeriod  - USDC string'i (örn: "100")
 * @param {number} params.intervalDays     - Periyot gün sayısı
 * @param {string} params.totalAmount      - Toplam USDC (örn: "300")
 * @returns {Promise<object>}
 */
export const createStream = async ({
  employer,
  employee,
  amountPerPeriod,
  intervalDays,
  totalAmount,
}) => {
  if (!USDC_TOKEN_ID)
    throw new Error('REACT_APP_USDC_ADDRESS .env içinde tanımlı değil.');

  const amountStroops = parseTokenAmount(amountPerPeriod, USDC_DECIMALS);
  const totalStroops  = parseTokenAmount(totalAmount, USDC_DECIMALS);

  const args = [
    Address.fromString(employer).toScVal(),
    Address.fromString(employee).toScVal(),
    Address.fromString(USDC_TOKEN_ID).toScVal(),
    bigintToI128Arg(amountStroops),
    nativeToScVal(BigInt(intervalDays), { type: 'u64' }),
    bigintToI128Arg(totalStroops),
  ];

  const tx = await invokeContract(employer, 'create_stream', args);

  // Kontratın create_stream dönüş değerinden stream_id oku (u64 ise)
  let streamId = null;
  if (tx.returnValue) {
    try {
      const raw = scValToNative(tx.returnValue);
      const n   = Number(raw);
      if (Number.isFinite(n) && n >= 0) {
        streamId = n;
        _setLocalLastStreamId(employer, streamId);
      }
    } catch { /* kontrat void dönüyorsa ignore */ }
  }
  // Kontrat void dönüyorsa (stream_id yoksa) local counter kullan
  if (streamId === null) {
    const last = _getLocalLastStreamId(employer);
    streamId   = last !== null ? last + 1 : 0;
    _setLocalLastStreamId(employer, streamId);
  }

  return { ...tx, streamId };
};

/**
 * Çalışanın claim() çağırmasını sağlar.
 * @param {string} employeeAddress
 * @returns {Promise<object>}
 */
export const claimStream = async (employeeAddress, streamId) =>
  invokeContract(employeeAddress, 'claim', [nativeToScVal(BigInt(streamId), { type: 'u64' })]);

/**
 * İşveren akışı iptal eder; kalan USDC iade edilir.
 * @param {string} employerAddress
 * @returns {Promise<object>}
 */
export const cancelStream = async (employerAddress, streamId) =>
  invokeContract(employerAddress, 'cancel', [nativeToScVal(BigInt(streamId), { type: 'u64' })]);

/**
 * Akış verilerini okur (read-only).
 * @param {string} publicKey
 * @returns {Promise<StreamData|null>}
 *
 * @typedef {object} StreamData
 * @property {string}  employer
 * @property {string}  employee
 * @property {string}  usdcToken
 * @property {bigint}  amountPerPeriod
 * @property {bigint}  intervalSeconds
 * @property {bigint}  totalAmount
 * @property {bigint}  claimedAmount
 * @property {bigint}  lastClaimTime
 * @property {bigint}  startTime
 * @property {boolean} active
 */
const mapStreamFromRaw = (raw) => {
  if (!raw) return null;

  return {
    employer: _addrStr(raw.employer),
    employee: _addrStr(raw.employee),
    usdcToken: _addrStr(raw.usdc_token),
    amountPerPeriod: parseI128ToBigInt(raw.amount_per_period ?? 0),
    intervalSeconds: parseI128ToBigInt(raw.interval_seconds ?? 0),
    totalAmount: parseI128ToBigInt(raw.total_amount ?? 0),
    claimedAmount: parseI128ToBigInt(raw.claimed_amount ?? 0),
    lastClaimTime: parseI128ToBigInt(raw.last_claim_time ?? 0),
    startTime: parseI128ToBigInt(raw.start_time ?? 0),
    active: Boolean(raw.active),
  };
};

/**
 * Kontrattan stream state okur (tek kaynak: get_stream).
 * @param {string} publicKey
 * @param {number|bigint|string} streamId
 * @returns {Promise<StreamData|null>}
 */
export const readStream = async (publicKey, streamId) => {
  const raw = await readContract(publicKey, 'get_stream', [nativeToScVal(BigInt(streamId), { type: 'u64' })]);
  return mapStreamFromRaw(raw);
};

/**
 * Kontrattan claimable miktarı okur (tek kaynak: claimable_amount).
 * @param {string} publicKey
 * @param {number|bigint|string} streamId
 * @returns {Promise<bigint>}
 */
export const readClaimable = async (publicKey, streamId) => {
  const raw = await readContract(publicKey, 'claimable_amount', [nativeToScVal(BigInt(streamId), { type: 'u64' })]);
  return parseI128ToBigInt(raw);
};

// Geriye dönük uyumluluk (eski isimler)
export const getStream = readStream;
export const getClaimableAmount = readClaimable;

// ── Yardımcılar ───────────────────────────────────────────────────────────────

/** Soroban Address scVal → string veya zaten string */
const _addrStr = (val) => {
  if (!val) return '';
  if (typeof val === 'string') return val;
  // scValToNative bazen obje döner
  return val.toString?.() ?? String(val);
};

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const _isMissingFunctionError = (error, fnName) => {
  const msg = String(error?.message ?? '');
  return msg.includes('trying to invoke non-existent contract function') && msg.includes(fnName);
};

// eslint-disable-next-line no-unused-vars
const _resolveNextStreamId = async (publicKey) => {
  try {
    const nextIdRaw = await readContract(publicKey, 'get_next_stream_id', []);
    const n = Number(nextIdRaw ?? 0);
    if (Number.isInteger(n) && n > 0) return n;
  } catch (e) {
    // Kontratta helper fonksiyon yoksa local fallback kullan.
    if (!_isMissingFunctionError(e, 'get_next_stream_id')) throw e;
  }

  const local = _getLocalLastStreamId(publicKey);
  if (local && Number.isInteger(local) && local > 0) return local + 1;
  return null;
};

const _getLocalLastStreamId = (publicKey) => {
  if (!publicKey || typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(`stellarflow:lastStreamId:${publicKey}`);
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const _setLocalLastStreamId = (publicKey, streamId) => {
  if (!publicKey || !Number.isInteger(streamId) || streamId <= 0 || typeof window === 'undefined') return;
  window.localStorage.setItem(`stellarflow:lastStreamId:${publicKey}`, String(streamId));
};

const _txStageError = (stage, method, message) => {
  const e = new Error(`${message} [stage=${stage}, method=${method}]`);
  e.stage = stage;
  e.method = method;
  return e;
};
