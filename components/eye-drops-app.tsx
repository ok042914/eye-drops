'use client';
import { useEffect, useRef, useState } from 'react';
import type { Bottle, State } from '../lib/model';
import type { Command } from '../lib/inventory';
import { applyCommand } from '../lib/inventory';
import { initializationArgs, mutationArgs, type MutationArgs } from '../lib/db-contract';
import { CloudError, loadState, rpc, saveCommand } from '../lib/cloud';
import { addDays, japanToday } from '../lib/dates';
import SetupWizard from './setup-wizard';
import HomePanel from './home-panel';
import HistoryPanel from './history-panel';
import ReceiptsPanel from './receipts-panel';
import VisitsPanel from './visits-panel';
import SettingsPanel from './settings-panel';
import BottleDialog from './bottle-dialog';
const tabs=[{id:'home',label:'ホーム',icon:'⌂'},{id:'history',label:'開封履歴',icon:'◷'},{id:'receipts',label:'処方・入庫',icon:'＋'},{id:'visits',label:'通院・目安',icon:'▦'},{id:'settings',label:'設定',icon:'⚙'}] as const;
type Tab=typeof tabs[number]['id'];
export default function EyeDropsApp({cloud=false}:{cloud?:boolean}){
  const [ready,setReady]=useState(!cloud);const [loading,setLoading]=useState(cloud);const [busy,setBusy]=useState(false);const [pending,setPending]=useState<MutationArgs|null>(null);const pendingRef=useRef<MutationArgs|null>(null);
  const refreshRef=useRef(false);const [refreshing,setRefreshing]=useState(false);
  function accept(next:State|null){stateRef.current=next;setState(next);}
  async function refresh(){if(refreshRef.current||submitLock.current)return;refreshRef.current=true;setRefreshing(true);try{accept(await loadState(stateRef.current));setReady(true);setError('');}catch(e){setError(e instanceof Error?e.message:'同期できませんでした。');}finally{refreshRef.current=false;setRefreshing(false);setLoading(false);}}
  useEffect(()=>{if(!cloud)return;void refresh();const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[cloud]);
  const [state,setState]=useState<State|null>(null);const stateRef=useRef<State|null>(null);
  const [today,setToday]=useState('');const [tab,setTab]=useState<Tab>('home');const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [modal,setModal]=useState<{medicationId:string;ending?:Bottle}|null>(null);const submitLock=useRef(false);const lockTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    // One timer at the JST date boundary, no periodic polling and no API requests.
    const update=()=>{const day=japanToday();setToday(day);clearTimeout(timer);const next=Date.parse(addDays(day,1)+'T00:00:00+09:00');timer=setTimeout(update,Math.max(1000,next-Date.now()+100));};
    const visible=()=>{if(document.visibilityState==='visible')update();};update();document.addEventListener('visibilitychange',visible);
    if('serviceWorker' in navigator&&process.env.NODE_ENV==='production')void navigator.serviceWorker.register('/sw.js').catch(()=>{});
    return()=>{clearTimeout(timer);if(lockTimer.current)clearTimeout(lockTimer.current);document.removeEventListener('visibilitychange',visible);};
  },[]);
  useEffect(()=>{const before=(e:BeforeUnloadEvent)=>{if((!cloud&&stateRef.current)||pendingRef.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[]);
  async function persist(request:MutationArgs){
    if(submitLock.current||refreshRef.current)return;submitLock.current=true;setBusy(true);pendingRef.current=request;setPending(request);setNotice('保存中…');
    try{await saveCommand(request);setReady(false);pendingRef.current=null;setPending(null);accept(await loadState());setReady(true);setError('');setNotice('クラウドに保存しました。');}
    catch(e){setNotice('');if(e instanceof CloudError&&/^PT[45]/.test(e.code)){pendingRef.current=null;setPending(null);}setError(e instanceof Error?e.message:'保存結果を確認できませんでした。同じ操作を再登録しないでください。');}
    finally{submitLock.current=false;setBusy(false);}
  }
  async function checkPending(){if(!pending||submitLock.current||refreshRef.current)return;submitLock.current=true;setBusy(true);try{const result=await rpc<{status:string}>('eye_stock_operation_status',{operation_id:pending.operation_id});if(result.status==='committed'){setReady(false);pendingRef.current=null;setPending(null);accept(await loadState());setReady(true);setError('');setNotice('保存済みであることを確認しました。');}else setError('保存結果はまだ不明です。同じ操作IDで再送できます。');}catch(e){setError(e instanceof Error?e.message:'結果を確認できませんでした。');}finally{submitLock.current=false;setBusy(false);}}
  function run(command:Command):boolean {
    if(!ready||!stateRef.current||submitLock.current||refreshRef.current||pendingRef.current)return false;
    if(cloud){try{const old=stateRef.current;applyCommand(old,command,crypto.randomUUID(),old.revision,japanToday());void persist(mutationArgs(command,crypto.randomUUID(),old.revision));return true;}catch(e){setError(e instanceof Error?e.message:'入力を確認してください。');return false;}}
    submitLock.current=true;
    try{
      const old=stateRef.current;const next=applyCommand(old,command,crypto.randomUUID(),old.revision,japanToday());
      stateRef.current=next;setState(next);setError('');setNotice('ローカル画面に反映しました（クラウド保存はしていません）。');return true;
    }catch(e){setNotice('');setError(e instanceof Error?e.message:'入力を確認してください。');return false;}
    finally{lockTimer.current=setTimeout(()=>{submitLock.current=false;},500);}
  }
  function navigate(next:Tab){setTab(next);setError('');setNotice('');document.querySelector('main')?.scrollIntoView({behavior:'instant'});}
  return <div className="app-shell"><header className="site-header"><a href="#main" className="brand" aria-label="Eye Drops ホーム" onClick={e=>{e.preventDefault();navigate('home');}}><svg viewBox="0 0 32 36" width="28" height="32" aria-hidden="true"><path d="M16 1C10 10 2 16 2 23a14 14 0 0 0 28 0C30 16 22 10 16 1Z" fill="currentColor"/><path d="M16 16v13M9.5 22.5h13" stroke="white" strokeWidth="3" strokeLinecap="round"/></svg><span>Eye Drops<small>目薬の在庫と開封記録</small></span></a><span className="local-badge">{cloud?'クラウド同期':'ローカル試作'}</span></header>
    {!cloud&&<div className="prototype-banner" role="note"><strong>クラウド未接続</strong><span>この画面だけの試作です。再読込・終了で入力は消えます。パスキーは未実装です。</span></div>}
    {state&&<nav className="main-nav" aria-label="メインナビゲーション">{tabs.map(t=><button key={t.id} aria-current={tab===t.id?'page':undefined} onClick={()=>navigate(t.id)}><span aria-hidden="true">{t.icon}</span>{t.label}</button>)}</nav>}
    <main id="main">{cloud&&<div className="actions"><button className="text-button" disabled={busy||refreshing} onClick={()=>void refresh()}>最新データに更新</button><span role="status">{busy?'保存中…':loading||refreshing?'同期中…':''}</span></div>}{pending&&<div className="message error"><p>この操作の結果が未確認です。ページを閉じず、確認または同じIDで再送してください。</p><button className="secondary" disabled={busy||refreshing} onClick={()=>void checkPending()}>保存結果を確認</button><button className="secondary" disabled={busy||refreshing} onClick={()=>void persist(pending)}>同じ操作を再送</button></div>}{error&&<div className="message error global-message" role="alert"><span>{error}</span><button className="text-button" onClick={()=>setError('')}>閉じる</button></div>}{notice&&<p className="message success" role="status">{notice}</p>}
    {loading?<p role="status">クラウドから読み込んでいます…</p>:!ready?<p>クラウドの確認が完了していません。「最新データに更新」で再確認してください。</p>:!today?<p className="empty" role="status">準備しています…</p>:!state?<fieldset disabled={busy||refreshing||Boolean(pending)} className="content-fieldset"><SetupWizard today={today} cloud={cloud} onComplete={s=>{if(cloud){void persist(initializationArgs(s.medications.map(m=>({medication:m,stock:s.movements.filter(x=>x.medicationId===m.id).reduce((n,x)=>n+x.delta,0),activeDates:s.bottles.filter(b=>b.medicationId===m.id&&b.origin==='initial').map(b=>b.openedOn),historicalDates:s.bottles.filter(b=>b.medicationId===m.id&&b.origin==='historical').map(b=>b.openedOn)})),s.nextVisitOn,crypto.randomUUID()));}else accept(s);setTab('home');}}/></fieldset>:<fieldset disabled={busy||refreshing||Boolean(pending)} className="content-fieldset">
      {tab==='home'&&<HomePanel state={state} today={today} onOpen={medicationId=>setModal({medicationId})} onEnd={ending=>setModal({medicationId:ending.medicationId,ending})} onVisits={()=>navigate('visits')}/>}
      {tab==='history'&&<HistoryPanel state={state} today={today} run={run}/>}
      {tab==='receipts'&&<ReceiptsPanel state={state} today={today} run={run}/>}
      {tab==='visits'&&<VisitsPanel state={state} today={today} run={run}/>}
      {tab==='settings'&&<SettingsPanel state={state} cloud={cloud} run={run} onReset={()=>{if(window.confirm('この画面の全入力を破棄します。元に戻せません。')){stateRef.current=null;setState(null);setTab('home');setError('');setNotice('');}}}/>}
      {modal&&<BottleDialog state={state} today={today} medicationId={modal.medicationId} ending={modal.ending} onClose={()=>setModal(null)} run={run} externalError={error}/>}
    </fieldset>}</main><footer className="site-footer">Eye Drops · 日付・本数の予測は相談用の目安です。<br/>薬剤の使用・期限・処方は医師・薬剤師に確認してください。</footer></div>;
}
