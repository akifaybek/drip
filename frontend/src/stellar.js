/* global BigInt */
import { Networks, TransactionBuilder, BASE_FEE, Contract, nativeToScVal, Address, scValToNative } from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { isConnected, requestAccess, getAddress, signTransaction } from '@stellar/freighter-api';

export function getConfig() {
  return {
    contractId:   process.env.REACT_APP_CONTRACT_ID   ?? '',
    network:      (process.env.REACT_APP_NETWORK ?? 'testnet').toLowerCase(),
    rpcUrl:       process.env.REACT_APP_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    usdcAddress:  process.env.REACT_APP_USDC_ADDRESS  ?? '',
    usdcDecimals: Number(process.env.REACT_APP_USDC_DECIMALS ?? '7'),
  };
}
const cfg = getConfig();
const NETWORK_PASSPHRASE = cfg.network === 'public' ? Networks.PUBLIC : Networks.TESTNET;
const STROOPS = 10_000_000n;
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const shortAddr = (addr, h=8, t=6) => addr ? `${addr.slice(0,h)}\u2026${addr.slice(-t)}` : '\u2014';
export const parseUSDC = (usdc) => { const [w='0',fr=''] = String(usdc).trim().split('.'); return BigInt(w)*STROOPS + BigInt(fr.padEnd(7,'0').slice(0,7)||'0'); };
const _isConn = async () => { const r = await isConnected(); return typeof r==='boolean'?r:r?.isConnected===true; };
const _getKey = async () => { const r = await getAddress(); const pk=typeof r==='string'?r:r?.address; if(!pk||r?.error) throw new Error(r?.error??'Cudan adresi alinamadi.'); return pk; };
const _sign = async (xdr, opts) => { const r = await signTransaction(xdr,opts); const s=typeof r==='string'?r:r?.signedTxXdr; if(!s||r?.error) throw new Error(r?.error??'Imzalama iptal.'); return s; };
export const connectWallet = async () => { if (!(await _isConn())) throw new Error('Freighter bulunamadi. https://freighter.app adresinden yukleyin.'); await requestAccess(); return _getKey(); };
// Sayfa yüklendiğinde sessizce bağlanır; popup çıkarmaz
export const autoConnect = async () => { try { if (!(await _isConn())) return null; return await _getKey(); } catch { return null; } };
const getServer = () => new SorobanRpc.Server(cfg.rpcUrl, { allowHttp: false });
const getContract = () => { if (!cfg.contractId) throw new Error('REACT_APP_CONTRACT_ID eksik.'); return new Contract(cfg.contractId); };
const invokeContract = async (publicKey, method, args=[]) => {
  const server=getServer(), contract=getContract();
  const account = await server.getAccount(publicKey);
  const tx = new TransactionBuilder(account,{fee:BASE_FEE,networkPassphrase:NETWORK_PASSPHRASE}).addOperation(contract.call(method,...args)).setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error('Sim hatasi: '+sim.error);
  const ready = SorobanRpc.assembleTransaction(tx,sim).build();
  const signedXDR = await _sign(ready.toXDR(),{network:'TESTNET',networkPassphrase:NETWORK_PASSPHRASE,accountToSign:publicKey});
  const signedTx = TransactionBuilder.fromXDR(signedXDR,NETWORK_PASSPHRASE);
  const submitted = await server.sendTransaction(signedTx);
  if (submitted.status==='ERROR') throw new Error('Gonderme hatasi');
  for (let i=0;i<30;i++) { const res=await server.getTransaction(submitted.hash); if(res.status==='SUCCESS') return res; if(res.status==='FAILED') throw new Error('Islem basarisiz'); await sleep(2000); }
  throw new Error('Zaman asimi');
};
export const createStream = async ({employer,employee,amountPerPeriod,intervalSeconds,totalAmount}) => {
  if (!cfg.usdcAddress) throw new Error('REACT_APP_USDC_ADDRESS eksik.');
  const args = [Address.fromString(employer).toScVal(),Address.fromString(employee).toScVal(),Address.fromString(cfg.usdcAddress).toScVal(),nativeToScVal(parseUSDC(amountPerPeriod),{type:'i128'}),nativeToScVal(BigInt(intervalSeconds),{type:'u64'}),nativeToScVal(parseUSDC(totalAmount),{type:'i128'})];
  const result = await invokeContract(employer,'create_stream',args);
  if (result?.returnValue) { try { return String(scValToNative(result.returnValue)); } catch {} }
  return employer;
};
export const readStream = async (streamId) => {
  const server=getServer(), contract=getContract();
  const DUMMY='GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
  const account = await server.getAccount(streamId).catch(()=>server.getAccount(DUMMY));
  const tx = new TransactionBuilder(account,{fee:BASE_FEE,networkPassphrase:NETWORK_PASSPHRASE}).addOperation(contract.call('get_stream',Address.fromString(streamId).toScVal())).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result?.retval) throw new Error('Stream bulunamadi.');
  const raw = scValToNative(sim.result.retval);
  return { employer:String(raw.employer??raw.sender??''), employee:String(raw.employee??raw.recipient??''), amount_per_period:raw.amount_per_period??0, total_amount:raw.total_amount??0, total_claimed:raw.total_claimed??raw.claimed_amount??0, interval_seconds:raw.interval_seconds??0, start_time:raw.start_time??0, last_claim_time:raw.last_claim_time??0, active:raw.active??true };
};
export const claimStream  = async (streamId, userAddress) => invokeContract(userAddress, 'claim',  []);
export const cancelStream = async (streamId, userAddress) => invokeContract(userAddress, 'cancel', []);