import { useState, useEffect, useCallback } from 'react';
import CreateStream from './components/CreateStream';
import StreamCard   from './components/StreamCard';
import { connectWallet, autoConnect, readStream, shortAddr, getConfig, claimStream, cancelStream } from './stellar';

const idsKey = pk => `sf:ids:${pk}`;
function loadIds(pk) {
  try {
    const raw = localStorage.getItem(idsKey(pk));
    if (raw) return JSON.parse(raw);
    const old = localStorage.getItem(`sf:${pk}`);
    if (old) { saveIds(pk, [old]); return [old]; }
  } catch {}
  return [];
}
function saveIds(pk, ids) { localStorage.setItem(idsKey(pk), JSON.stringify(ids)); }

function DropIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C12 2 4 10.5 4 15a8 8 0 0016 0C20 10.5 12 2 12 2z"/></svg>;
}
function StreamsIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
}
function PlusIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>;
}

export default function App() {
  const [wallet, setWallet]     = useState(null);
  const [page, setPage]         = useState('home');
  const [streams, setStreams]   = useState([]);
  const [watchId, setWatchId]   = useState('');
  const [watchErr, setWatchErr] = useState('');
  const cfg = getConfig();

  // Sayfa açılışında Freighter zaten yetkiliyse sessizce bağlan (popup yok)
  useEffect(() => {
    autoConnect().then(addr => { if (addr) setWallet({ address: addr }); });
  }, []);

  async function connect() {
    try { const addr = await connectWallet(); setWallet({ address: addr }); }
    catch (e) { alert(e.message); }
  }

  const loadAllStreams = useCallback(async (pk) => {
    const ids = loadIds(pk);
    if (!ids.length) { setStreams([]); return; }
    const entries = await Promise.all(ids.map(async id => {
      try { const data = await readStream(id); return { id, data, status: 'ok', error: null }; }
      catch (e) { return { id, data: null, status: 'error', error: e.message }; }
    }));
    setStreams(entries);
  }, []);

  useEffect(() => { if (wallet) loadAllStreams(wallet.address); }, [wallet, loadAllStreams]);

  async function refreshSingle(id) {
    try { const data = await readStream(id); setStreams(prev => prev.map(s => s.id===id ? {...s,data,status:'ok',error:null} : s)); }
    catch (e) { setStreams(prev => prev.map(s => s.id===id ? {...s,status:'error',error:e.message} : s)); }
  }
  function handleCreated(id) {
    if (wallet) { const ids = loadIds(wallet.address); if (!ids.includes(id)) saveIds(wallet.address,[...ids,id]); loadAllStreams(wallet.address); }
    setPage('streams');
  }
  async function addStreamById() {
    const id = watchId.trim(); if (!id) return; setWatchErr('');
    try {
      const data = await readStream(id);
      if (wallet) { const ids=loadIds(wallet.address); if(!ids.includes(id)) saveIds(wallet.address,[...ids,id]); }
      setStreams(prev => prev.find(s=>s.id===id) ? prev : [...prev,{id,data,status:'ok',error:null}]);
      setWatchId(''); setPage('streams');
    } catch(e) { setWatchErr('Stream not found: '+e.message); }
  }
  async function handleClaim(id) { await claimStream(id, wallet.address); await refreshSingle(id); }
  async function handleCancel(id) {
    await cancelStream(id, wallet.address);
    if (wallet) { saveIds(wallet.address, loadIds(wallet.address).filter(x=>x!==id)); }
    setStreams(prev => prev.filter(s=>s.id!==id));
  }
  function signOut() {
    // LocalStorage'daki tüm sf: anahtarlarını temizle
    Object.keys(localStorage).filter(k => k.startsWith('sf:')).forEach(k => localStorage.removeItem(k));
    setWallet(null); setStreams([]); setPage('home');
  }

  const sb='#0d0d1a', bc='#1a1a2e';
  const blueBtn = { background:'linear-gradient(135deg,#2563eb 0%,#4f46e5 100%)' };

  return (
    <div className="flex h-screen overflow-hidden" style={{background:'#080810'}}>
      <aside className="flex flex-col flex-shrink-0 w-[260px]" style={{background:sb,borderRight:`1px solid ${bc}`}}>
        <div className="flex items-center gap-2.5 px-5 h-[52px]" style={{borderBottom:`1px solid ${bc}`}}>
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-900/40"><DropIcon size={13}/></div>
          <span className="text-[15px] font-semibold tracking-tight text-white">Drip</span>
        </div>
        <nav className="flex-1 px-3 py-3 flex flex-col gap-0.5">
          <button onClick={()=>setPage('streams')} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] w-full text-left transition-colors ${page==='streams'?'bg-blue-600/10 border border-blue-500/20 text-blue-400':'text-[#666] hover:text-[#aaa] hover:bg-white/[0.04] border border-transparent'}`}>
            <StreamsIcon/> Streams
          </button>
          <button onClick={()=>{ if(wallet) setPage('create'); else connect(); }} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] w-full text-left transition-colors mt-0.5 ${page==='create'?'bg-blue-600/10 border border-blue-500/20 text-blue-400':'text-[#666] hover:text-[#aaa] hover:bg-white/[0.04] border border-transparent'}`}>
            <PlusIcon/> New stream
          </button>
        </nav>
        <div className="px-4 pb-4 pt-2" style={{borderTop:`1px solid ${bc}`}}>
          {wallet ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>
                <span className="text-[12px] text-[#888] font-mono truncate">{shortAddr(wallet.address)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#555] uppercase tracking-widest">{cfg.network==='testnet'?'TESTNET':'MAINNET'}</span>
                <button onClick={signOut} className="text-[11px] text-[#444] hover:text-[#888]">Sign out</button>
              </div>
            </div>
          ) : <button onClick={connect} className="w-full text-[12px] text-[#555] hover:text-[#999] py-1.5">Connect wallet</button>}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto relative">
        <div className="sticky top-0 z-10 flex items-center justify-between px-8 h-[52px]" style={{background:'rgba(8,8,16,0.85)',backdropFilter:'blur(12px)',borderBottom:`1px solid ${bc}`}}>
          <h1 className="text-[14px] font-semibold text-white">
            {page==='home'&&'Dashboard'}{page==='create'&&'New stream'}{page==='streams'&&'Streams'}
          </h1>
          {wallet && <button onClick={()=>setPage('create')} className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium text-white hover:opacity-90 shadow-lg shadow-blue-900/30" style={blueBtn}><PlusIcon/> New stream</button>}
        </div>

        <div className="px-8 py-8 max-w-[820px] mx-auto">
          {page==='home' && (
            <div className="relative min-h-[calc(100vh-120px)] flex flex-col items-center justify-center text-center">
              <div className="absolute inset-0 hero-glow pointer-events-none"/>
              <div className="relative z-10 flex flex-col items-center">
                <div className="fade-up mb-8">
                  <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-2xl shadow-blue-900/50"><DropIcon size={28}/></div>
                </div>
                <h1 className="fade-up-1 text-[46px] font-bold tracking-tight leading-none mb-4"
                    style={{background:'linear-gradient(135deg,#fff 40%,#93c5fd 100%)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
                  Drip
                </h1>
                <p className="fade-up-1 text-[18px] text-[#777] mb-3 font-medium">DAO payroll, drop by drop.</p>
                <p className="fade-up-2 text-[14px] text-[#4a4a5a] leading-relaxed mb-10 max-w-[360px] mx-auto">
                  Lock USDC in a trustless on-chain escrow. Recipients claim each period as they earn it — no middlemen, no delays.
                </p>
                <div className="fade-up-2 flex flex-col items-center gap-3">
                  <button onClick={wallet?()=>setPage('create'):connect} className="flex items-center gap-2 h-11 px-7 rounded-xl text-[14px] font-semibold text-white shadow-xl shadow-blue-900/40 hover:opacity-90" style={blueBtn}>
                    <PlusIcon/>{wallet?'Create a stream':'Connect wallet'}
                  </button>
                  {wallet && <button onClick={()=>setPage('streams')} className="text-[13px] text-[#444] hover:text-[#777]">View my streams →</button>}
                </div>
                <div className="fade-up-3 flex items-center justify-center gap-3 mt-12 flex-wrap">
                  {['Soroban smart contract','USDC on Stellar','Trustless escrow','Freighter wallet'].map(f=>(
                    <span key={f} className="text-[11px] px-3 py-1 rounded-full text-[#555]" style={{background:'rgba(255,255,255,0.04)',border:'1px solid #1a1a2e'}}>{f}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {page==='create' && (wallet
            ? <CreateStream wallet={wallet} onCreated={handleCreated}/>
            : <div className="flex flex-col items-center justify-center py-32 gap-4">
                <p className="text-[#555]">Connect your wallet first</p>
                <button onClick={connect} className="h-9 px-5 rounded-lg text-[13px] font-medium text-white" style={blueBtn}>Connect wallet</button>
              </div>
          )}

          {page==='streams' && (
            <div>
              <div className="rounded-xl p-4 mb-6 flex items-center gap-3" style={{background:'#0d0d1a',border:'1px solid #1e1e30'}}>
                <input value={watchId} onChange={e=>{setWatchId(e.target.value);setWatchErr('');}} onKeyDown={e=>e.key==='Enter'&&addStreamById()} placeholder="Watch stream by ID…" className="flex-1 bg-transparent text-[13px] outline-none text-white" style={{'--tw-placeholder-color':'#333'}}/>
                <button onClick={addStreamById} className="h-7 px-4 rounded-lg text-[12px] font-medium text-white hover:opacity-80" style={blueBtn}>Watch</button>
              </div>
              {watchErr && <p className="text-red-400 text-[12px] mb-4 -mt-2">{watchErr}</p>}
              {!wallet ? (
                <div className="flex flex-col items-center py-32 gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-400"><DropIcon size={20}/></div>
                  <p className="text-[#555]">Connect wallet to view your streams</p>
                  <button onClick={connect} className="h-9 px-5 rounded-lg text-[13px] font-medium text-white" style={blueBtn}>Connect wallet</button>
                </div>
              ) : streams.length===0 ? (
                <div className="flex flex-col items-center py-28 gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-400"><DropIcon size={20}/></div>
                  <p className="text-[#555]">No streams yet</p>
                  <button onClick={()=>setPage('create')} className="h-9 px-5 rounded-lg text-[13px] font-medium text-white" style={blueBtn}>Create stream</button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {streams.map(s=>s.status==='error'
                    ? <div key={s.id} className="rounded-xl p-4 text-[13px] text-red-400" style={{background:'#0d0d1a',border:'1px solid rgba(239,68,68,0.2)'}}>{s.id.slice(0,12)}… {s.error}</div>
                    : <StreamCard key={s.id} streamId={s.id} stream={s.data} wallet={wallet} onClaim={()=>handleClaim(s.id)} onCancel={()=>handleCancel(s.id)} onRefresh={()=>refreshSingle(s.id)}/>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
