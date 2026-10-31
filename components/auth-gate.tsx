'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { passkeyConfigured, supabase } from '../lib/supabase';
import { sendLoginCode, verifyLoginCode } from '../lib/login';

export default function AuthGate({children}:{children:(userId:string)=>ReactNode}){
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  const [email,setEmail]=useState('');
  const [token,setToken]=useState('');
  const [sent,setSent]=useState(false);
  const nextSend=useRef(0);
  const lock=useRef(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let live=true;const client=supabase();
    void client.auth.getSession().then(({data,error})=>{if(live){setSession(data.session);setLoading(false);if(error)setMessage('ログイン情報を読み取れませんでした。');}}).catch(()=>{if(live){setLoading(false);setMessage('通信を確認してください。');}});
    const {data}=client.auth.onAuthStateChange((_event,next)=>{if(live){setSession(next);setLoading(false);}});
    return()=>{live=false;data.subscription.unsubscribe();};
  },[]);
  async function action(work:()=>Promise<void>){
    if(lock.current)return;
    lock.current=true;setBusy(true);setMessage('');
    try{await work();}catch(e){setMessage(e instanceof Error?e.message:'接続できませんでした。もう一度お試しください。');}
    finally{lock.current=false;setBusy(false);}
  }
  function send(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    void action(async()=>{
      if(Date.now()<nextSend.current)throw new Error('コードの再送は、前回の送信から60秒お待ちください。');
      await sendLoginCode(supabase().auth,email);
      nextSend.current=Date.now()+60000;setSent(true);setToken('');
      setMessage('メールに届いた認証コードを入力してください。');
    });
  }
  function verify(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    void action(async()=>{await verifyLoginCode(supabase().auth,email,token);});
  }
  if(loading)return <main className="app-shell"><p role="status">ログイン情報を確認しています…</p></main>;
  if(session)return <>
    <div className="auth-toolbar"><span>Eye Drops</span>
      {passkeyConfigured()&&<button disabled={busy} className="text-button" onClick={()=>void action(async()=>{const {error}=await supabase().auth.registerPasskey();if(error)throw new Error('パスキーを登録できませんでした。対応端末と設定をご確認ください。');setMessage('パスキーを登録しました。メールコードは復旧用に残ります。');})}>パスキーを登録</button>}
      <button disabled={busy} className="text-button" onClick={()=>void action(async()=>{const {error}=await supabase().auth.signOut({scope:'local'});if(error)throw new Error('ログアウトできませんでした。');setToken('');setSent(false);})}>ログアウト</button>
    </div>
    {message&&<p className="message" role="status">{message}</p>}{children(session.user.id)}
  </>;
  return <main className="app-shell auth-page"><section className="panel">
    <p className="eyebrow">目薬の管理を、ひとつに。</p><h1>Eye Dropsにログイン</h1>
    <p>Lens Stockと同じ、登録済みのメールアドレスに認証コードを送ります。</p>
    {passkeyConfigured()&&<button className="primary" disabled={busy} onClick={()=>void action(async()=>{const {error}=await supabase().auth.signInWithPasskey();if(error)throw new Error('パスキーでログインできませんでした。メールコードでログインしてください。');})}>Face ID・Touch IDでログイン</button>}
    <form onSubmit={send}><fieldset disabled={busy} className="content-fieldset">
      <label>メールアドレス<input type="email" autoComplete="email" required maxLength={254} value={email} readOnly={sent} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
      <button className={sent?'secondary':'primary wide'} type="submit">{busy?'確認中…':sent?'認証コードを再送':'認証コードを送る'}</button>
    </fieldset></form>
    {sent&&<form onSubmit={verify}><fieldset disabled={busy} className="content-fieldset">
      <label>認証コード<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={token} onChange={e=>setToken(e.target.value)} placeholder="メールに届いたコード"/></label>
      <button className="primary wide">ログイン</button>
      <button type="button" className="text-button" onClick={()=>{setSent(false);setToken('');setMessage('');}}>メールアドレスを変更</button>
    </fieldset></form>}
    {message&&<p className="message" role="status">{message}</p>}
    <p className="muted small">新規登録は管理者による事前設定が必要です。</p>
  </section></main>;
}
