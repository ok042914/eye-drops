'use client';
import type { Bottle, State } from '../lib/model';
import { activeBottles, stockFor } from '../lib/model';
import { addDays, differenceDays, displayDate } from '../lib/dates';
import { forecastMedication } from '../lib/forecast';
import { DateValue } from './shared';
export default function HomePanel({state,today,onOpen,onEnd,onVisits}:{state:State;today:string;onOpen:(id:string)=>void;onEnd:(b:Bottle)=>void;onVisits:()=>void}){
  return <><div className="page-heading home-heading"><div><p className="eyebrow">毎日の安心を、ひと目で。</p><h1>目薬のストック</h1></div><span className="date-pill">{displayDate(today)}</span></div>
    <section className="visit-banner" aria-label="次回受診"><div><span className="eyebrow">次回受診予定</span><strong>{state.nextVisitOn?<DateValue value={state.nextVisitOn}/>:<>まだ設定していません</>}</strong>{state.nextVisitOn&&state.nextVisitOn<today&&<span className="warning-text">予定日を過ぎています。更新してください。</span>}</div><button className="secondary" onClick={onVisits}>処方本数の目安を見る →</button></section>
    <div className="medication-grid">{state.medications.map((med,index)=>{
      const f=forecastMedication(state,med.id,today);const stock=stockFor(state,med.id);const active=activeBottles(state,med.id);
      const last=state.bottles.filter(b=>b.medicationId===med.id&&b.status!=='cancelled').map(b=>b.openedOn).sort().at(-1)??null;
      const atRisk=stock===0||!!(f.earlyShortage&&state.nextVisitOn&&f.earlyShortage<state.nextVisitOn);
      return <article key={med.id} className="med-card"><div className="card-top"><span className="drug-number">{String(index+1).padStart(2,'0')}</span><span className={atRisk?'badge warning':'badge'}>{stock===0?'未開封在庫なし':atRisk?'受診前の不足に注意':'在庫を確認'}</span></div>
        <h2>{med.name}</h2><p className="muted">{med.volumeMl}mL · {med.directions}</p>
        <div className="stock-line"><div><span className="eyebrow">未開封の在庫</span><p className="stock-number">{stock}<span>本</span></p></div><div className="active-count">使用中 <strong>{active.length}</strong> / {med.parallel}本</div></div>
        <dl className="forecast-list"><div><dt>次回開封の目安</dt><dd><DateValue value={f.nextOpen}/></dd></div><div><dt>在庫不足の目安</dt><dd>{f.shortage?<DateValue value={f.shortage}/>:f.estimate.days?'2年以内の不足予測なし':'履歴不足'}</dd></div></dl>
        <button className="primary wide" disabled={stock===0} onClick={()=>onOpen(med.id)}>＋ 1本を開封する</button>{stock===0&&<p className="muted small">受取登録または棚卸しで在庫を確認してください。</p>}
        <div className="bottles"><h3>使用中のボトル <span className="muted small">1本ずつ管理</span></h3>{!active.length&&<p className="muted">使用中の登録はありません。</p>}{active.map(b=>{
          const expiry=b.expirationDays===null?null:addDays(b.openedOn,b.expirationDays);const remaining=expiry?differenceDays(today,expiry):null;
          return <div className="bottle-row" key={b.id}><div><strong>ボトル · {b.id.slice(-6)}</strong><span>{displayDate(b.openedOn)} 開封</span><small className={remaining!==null&&remaining<=0?'warning-text':'muted'}>{expiry?`期限目安 ${displayDate(expiry)} / ${remaining!<0?`${-remaining!}日超過`:remaining===0?'本日':`あと${remaining}日`}`:'開封後の期限は未設定'}</small></div><button className="secondary" onClick={()=>onEnd(b)}>使用終了</button></div>;
        })}</div>
        <details><summary>予測の根拠・日付の違い</summary><dl className="details-list"><div><dt>最終開封</dt><dd>{displayDate(last)}</dd></div><div><dt>最後の未開封品を開ける目安</dt><dd>{stock===0?'現在の未開封在庫は0本':f.lastUnopened?displayDate(f.lastUnopened):f.estimate.days?'2年以内に該当なし':'履歴不足'}</dd></div><div><dt>次に必要なのに在庫がない日</dt><dd>{f.shortage?displayDate(f.shortage):f.estimate.days?'2年以内に不足予測なし':'履歴不足'}</dd></div><div><dt>不足時期の幅（目安）</dt><dd>{f.earlyShortage?displayDate(f.earlyShortage):'算出なし'} 〜 {f.lateShortage?displayDate(f.lateShortage):'算出範囲外'}</dd></div><div><dt>1本の期間</dt><dd>{f.estimate.days?`約${f.estimate.days}日`:'算出できません'}</dd></div><div><dt>根拠</dt><dd>{f.estimate.source==='actual'?'使い切りの実記録':f.estimate.source==='interval'?'開封間隔の参考値':'履歴不足'} / 有効{f.estimate.samples.length}区間</dd></div></dl>{[...f.estimate.warnings,...f.notes].map((w,i)=><p className="muted small" key={i}>{w}</p>)}</details>
      </article>;
    })}</div><p className="footnote">日付・本数は目安です。残量や処方を医療上の確定判断として示すものではありません。</p></>;
}
