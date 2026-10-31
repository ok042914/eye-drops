'use client';
import { useState } from 'react';
import { HISTORY_START, displayDate, validDate } from '../lib/dates';
import { defaultMedications } from '../lib/model';
import type { InitialMedication, State } from '../lib/model';
import { initialize, validateMedication } from '../lib/inventory';
import { MedicationFields } from './shared';
const steps=['薬剤を確認','未開封の在庫','使用中のボトル','過去の開封履歴','確認して開始'];
export default function SetupWizard({today,onComplete,cloud=false}:{today:string;onComplete:(state:State)=>void;cloud?:boolean}){
  const [step,setStep]=useState(0);const [error,setError]=useState('');
  const [items,setItems]=useState<InitialMedication[]>(()=>defaultMedications().map(medication=>({medication,stock:0,activeDates:[],historicalDates:[]})));
  const [history,setHistory]=useState<string[]>(['','']);const [nextVisit,setNextVisit]=useState('');
  function update(i:number,patch:Partial<InitialMedication>){setItems(old=>old.map((item,j)=>i===j?{...item,...patch}:item));}
  function parsed():InitialMedication[]{return items.map((item,i)=>({...item,activeDates:item.activeDates.filter(Boolean),historicalDates:history[i].split(/[\n,、\s]+/).filter(Boolean)}));}
  function next(){
    try {
      if(step===0)items.forEach(i=>validateMedication(i.medication));
      const values=parsed();
      if(step>=1&&values.some(i=>!Number.isSafeInteger(i.stock)||i.stock<0||i.stock>100000))throw new Error('在庫本数は0以上の整数で入力してください。');
      if(step>=2&&values.some(i=>i.activeDates.length>i.medication.parallel||i.activeDates.some(d=>!validDate(d)||d<HISTORY_START||d>today)))throw new Error('使用中ボトルの本数と開封日を確認してください。');
      if(step>=3&&values.some(i=>i.historicalDates.some(d=>!validDate(d)||d<HISTORY_START||d>today)))throw new Error('過去履歴は2026-06-01〜今日のYYYY-MM-DD形式で入力してください。');
      setError('');setStep(s=>s+1);
    }catch(e){setError(e instanceof Error?e.message:'入力を確認してください。');}
  }
  function finish(){try{const s=initialize(parsed(),today,nextVisit||null);onComplete(s);}catch(e){setError(e instanceof Error?e.message:'入力を確認してください。');}}
  return <section className="wizard"><div className="page-heading"><p className="eyebrow">はじめの準備</p><h1>目薬のことを、<br/>ひとつずつ。</h1><p>現在の実数から始めます。過去の履歴で、今の在庫を減らすことはありません。</p></div>
    <ol className="steps" aria-label="初期設定の進み具合">{steps.map((s,i)=><li key={s} aria-current={step===i?'step':undefined} className={i<=step?'done':''}><span>{i+1}</span><small>{s}</small></li>)}</ol>
    <div className="panel"><p className="eyebrow">STEP {step+1} / 5</p><h2>{steps[step]}</h2>
      {step===0&&<><p className="muted">ご指定の2剤を用意しました。期限は確認した値だけを設定してください。</p>{items.map((item,i)=><fieldset className="med-fieldset" key={item.medication.id}><legend>{item.medication.name}</legend><MedicationFields med={item.medication} onChange={medication=>update(i,{medication})}/></fieldset>)}</>}
      {step===1&&<><p>手元の、まだ開けていない本数を数えてください。使用中は含めません。</p>{items.map((item,i)=><label className="stock-input" key={item.medication.id}>{item.medication.name}<span><input aria-label={`${item.medication.name}の未開封本数`} type="number" min="0" max="100000" value={item.stock} onChange={e=>update(i,{stock:Number(e.target.value)})}/> 本</span></label>)}</>}
      {step===2&&<><p>現在使用中のボトルだけ、1本ごとに開封日を入力します。該当しない欄は空欄にしてください。</p><p className="hint">ここで登録するボトルは、現在の未開封在庫から減算しません。</p>{items.map((item,i)=><fieldset className="med-fieldset" key={item.medication.id}><legend>{item.medication.name}</legend>{Array.from({length:item.medication.parallel},(_,b)=><label key={b}>ボトル {b+1} の開封日<input type="date" min={HISTORY_START} max={today} value={item.activeDates[b]??''} onChange={e=>{const dates=Array.from({length:item.medication.parallel},(_,j)=>item.activeDates[j]??'');dates[b]=e.target.value;update(i,{activeDates:dates});}}/></label>)}</fieldset>)}</>}
      {step===3&&<><p>2026年6月以降の、すでに使用を終えたボトルの開封日を1本につき1行で入力します。後から追加もできます。</p><p className="hint">前の画面で登録した使用中ボトルは、ここへ重複入力しないでください。同日に別の2本を開けた場合は、同じ日付を2行入力できます。</p>{items.map((item,i)=><label key={item.medication.id}>{item.medication.name}<textarea rows={5} placeholder={'2026-06-01\n2026-07-01'} value={history[i]} onChange={e=>setHistory(old=>old.map((v,j)=>j===i?e.target.value:v))}/></label>)}</>}
      {step===4&&<><p>{cloud?'次の内容をクラウドに保存します。':'次の内容をこの画面内だけで管理します。クラウド保存・ログインは未実装です。'}</p><div className="table-scroll"><table><thead><tr><th>薬剤</th><th>未開封</th><th>使用中</th><th>過去履歴</th></tr></thead><tbody>{parsed().map(item=><tr key={item.medication.id}><th>{item.medication.name}</th><td>{item.stock}本</td><td>{item.activeDates.length}本</td><td>{item.historicalDates.length}本</td></tr>)}</tbody></table></div><label>次回受診予定日（任意）<input type="date" min={today} value={nextVisit} onChange={e=>setNextVisit(e.target.value)}/></label><p className="muted">初期設定日：{displayDate(today)}。在庫0でも開始できます。</p></>}
      {error&&<p className="message error" role="alert">{error}</p>}
      <div className="actions">{step>0&&<button className="secondary" onClick={()=>{setStep(s=>s-1);setError('');}}>戻る</button>}{step<4?<button className="primary" onClick={next}>次へ →</button>:<button className="primary" onClick={finish}>この内容で始める</button>}</div>
    </div>
  </section>;
}
