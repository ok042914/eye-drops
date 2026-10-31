'use client';
import { useState } from 'react';
import type { Medication, State } from '../lib/model';
import { stockFor } from '../lib/model';
import type { Command } from '../lib/inventory';
import { displayDate } from '../lib/dates';
import { MedicationFields } from './shared';
function MedicationEditor({med,run}:{med:Medication;run:(c:Command)=>boolean}){
  const [draft,setDraft]=useState(med);
  return <form onSubmit={e=>{e.preventDefault();if(window.confirm('薬剤設定を更新します。既存ボトルの期限は変えず、予測の学習期間を新しい設定に分けます。'))run({action:'settings',medication:draft});}}><MedicationFields med={draft} onChange={setDraft}/><p className="muted small">設定変更後は、新しい条件の履歴が集まるまで予測を保留します。医療上の用法は変更前にご確認ください。</p><button className="primary">設定を保存</button></form>;
}
export default function SettingsPanel({state,run,onReset,cloud=false}:{state:State;run:(c:Command)=>boolean;onReset:()=>void;cloud?:boolean}){
  const [adding,setAdding]=useState(false);
  const [newMed,setNewMed]=useState<Medication>({id:'',name:'',volumeMl:5,timesPerDay:1,parallel:1,expirationDays:null,expirationSource:'',directions:'両眼',version:1});
  return <><div className="page-heading"><p className="eyebrow">自分に合った管理へ。</p><h1>設定・棚卸し</h1></div><section className="panel"><h2>現在の実数で棚卸し</h2><p>未開封の本数だけを数え、理由と一緒に記録します。</p>{state.medications.map(m=><form className="adjust-form" key={m.id} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const quantity=Number(data.get('quantity'));if(window.confirm(`${m.name}の未開封在庫を${stockFor(state,m.id)}本から${quantity}本に調整します。`))run({action:'adjust',medicationId:m.id,quantity,note:String(data.get('note'))});}}><h3>{m.name} <span className="badge">現在{stockFor(state,m.id)}本</span></h3><div className="form-grid"><label>数えた本数<input name="quantity" type="number" min="0" max="100000" required defaultValue={stockFor(state,m.id)}/></label><label>理由<input name="note" required maxLength={500} placeholder="実数確認、未開封品の廃棄など"/></label></div><button className="secondary">確認して調整</button></form>)}</section>
    {state.medications.map(m=><details className="panel" key={m.id}><summary>{m.name}の薬剤設定</summary><MedicationEditor key={m.version} med={m} run={run}/></details>)}
    <section className="panel"><button className="secondary" onClick={()=>setAdding(!adding)}>{adding?'薬剤追加を閉じる':'＋ 薬剤を追加'}</button>{adding&&<form onSubmit={e=>{e.preventDefault();const med={...newMed,id:crypto.randomUUID()};if(run({action:'add_medication',medication:med,stock:0}))setAdding(false);}}><MedicationFields med={newMed} onChange={setNewMed}/><p className="hint">未開封0本で追加します。棚卸しで現在の実数を登録してください。</p><button className="primary">薬剤を追加</button></form>}</section>
    <details className="panel"><summary>在庫の増減履歴</summary><div className="table-scroll"><table><thead><tr><th>日付</th><th>薬剤</th><th>増減</th><th>理由</th></tr></thead><tbody>{[...state.movements].reverse().map(m=><tr key={m.id}><td>{displayDate(m.date)}</td><td>{state.medications.find(d=>d.id===m.medicationId)?.name}</td><td>{m.delta>0?'+':''}{m.delta}本</td><td>{m.note}</td></tr>)}</tbody></table></div></details>
    <section className="panel"><h2>保存・認証について</h2>{cloud?<><p>変更は専用クラウド領域に保存します。画面復帰時と操作後に同期します。</p><p>パスキー登録は画面上部から行います。メールコードは復旧用に残してください。パスキーの利用には本番設定と実機確認が必要です。</p></>:<><p>フェーズ2のローカル試作です。データはこのページのメモリ内だけにあり、再読込・画面を閉じると消えます。</p><p>クラウド同期、メールOTP、パスキーは未実装です。実際の在庫の唯一の保管先には使用しないでください。</p><p className="muted small">操作IDとrevisionによるローカル整合性検査は実装済みです。DB側のトランザクション・RLS・複数端末同期はフェーズ3で検証します。</p><button className="secondary danger-text" onClick={onReset}>ローカル入力を破棄し、初期設定へ</button></>}</section></>;
}
