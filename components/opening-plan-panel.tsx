'use client';
import { useState } from 'react';
import type { State } from '../lib/model';
import { addDays, addMonths, displayDate } from '../lib/dates';
import { sixMonthOpeningPlan, validConsultation } from '../lib/opening-plan';

export default function OpeningPlanPanel({state,today}:{state:State;today:string}){
  const initialVisit=state.nextVisitOn&&state.nextVisitOn>=today?state.nextVisitOn:today;
  const [visitOverride,setVisitOverride]=useState<string|null>(null);
  const consult=visitOverride??initialVisit;
  const [followingOverride,setFollowingOverride]=useState<string|null>(null);
  const following=followingOverride??addMonths(consult||today,3);
  const [reserve,setReserve]=useState('14');
  const options={nextVisitOn:consult,followingVisitOn:following,reserveDays:reserve===''?NaN:Number(reserve)};
  const valid=validConsultation(today,options);
  const plan=sixMonthOpeningPlan(state,today,valid?options:undefined);
  const endOn=valid?addDays(following,options.reserveDays):null;
  return <>
    <section className="panel consultation" aria-labelledby="consultation-title">
      <h2 id="consultation-title">次回の処方本数を相談する目安</h2>
      <div className="form-grid">
        <label>次回診察日<input type="date" min={today} max={addDays(today,730)} value={consult} onChange={e=>{setVisitOverride(e.target.value);setFollowingOverride(null);}}/></label>
        <label>次々回診察日<input type="date" min={consult?addDays(consult,1):today} max={addDays(today,1000)} value={following} onChange={e=>setFollowingOverride(e.target.value)}/></label>
        <label>予備日数（日）<input type="number" min={0} max={90} step={1} inputMode="numeric" value={reserve} onChange={e=>setReserve(e.target.value)}/></label>
      </div>
      <p className="hint">次回診察日から次々回診察日＋予備日数の前日までをカバーする本数です。次々回は3暦月後、予備は14日を提案します。日付と予備日数は試算用で、受診予定の保存は下の通院記録で行います。</p>
      {!valid?<p className="message error" role="alert">次回は今日から730日以内、次々回はその翌日以降・今日から1000日以内、予備日数は0〜90日の整数で指定してください。</p>:<>
        <p className="muted small">相談対象：{displayDate(consult)}〜{displayDate(addDays(endOn!,-1))}。実際の処方は医師に相談してください。</p>
        <div className="estimate-grid">{plan.medications.map(({medication:m,estimate:e,stock,consultation:p})=><article className="estimate-card" key={m.id}>
          <h3>{m.name}</h3><span className="eyebrow">処方数量の目安</span><p className="estimate-number">{p!.quantity??'—'}<span> 本</span></p>
          <p>多めに見込む目安：<strong>{p!.conservativeQuantity??'—'}本</strong></p>
          {p!.shortfallBeforeVisit!==null&&p!.shortfallBeforeVisit>0&&<p className="message warning">受診前に最大{p!.shortfallBeforeVisit}本不足する試算です。今回の希望本数だけでは受診前の不足を解消できません。手元の実数と受診予定を確認してください。</p>}
          {e.confidence==='low'&&<p className="message warning">{e.days===null?'履歴不足のため、予定日・処方本数は算出できません。':'履歴が少ないため、不確実性の高い参考値です。'}</p>}
          <details><summary>計算の根拠</summary>
            <p>未開封在庫：{stock}本<br/>次回診察より前の開封需要：{p!.beforeVisit??'—'}本<br/>受診時の未開封在庫予測：{p!.remainingAtVisit??'—'}本<br/>対象期間中の必要本数：{p!.required??'—'}本<br/>予備日数：{options.reserveDays}日</p>
            <p>処方希望本数 ＝ 必要本数 − 受診時の未開封在庫（0本未満は0本）</p>
            <p className="muted small">未受取の処方は在庫に含めません。多めの目安は短い期間を使い、受診時の使用中残量を0とみなす試算です。使用中ボトルの残量は実測値ではありません。</p>
          </details>
        </article>)}</div>
      </>}
    </section>
    <section className="panel" aria-labelledby="opening-plan-title">
      <h2 id="opening-plan-title">今後の開封予定一覧</h2>
      <p>今後6か月：{displayDate(today)}〜{displayDate(addDays(plan.until,-1))}</p>
      <p className="hint">すべて予測で、実際の開封履歴とは別です。開封・使い切り・履歴訂正などの実績を登録すると再計算します。未開封在庫は現在の手持ちだけで照合し、今後の処方・入庫は加算していません。ドルモロールは朝夜を区別しません。</p>
      <div className="estimate-grid">{plan.medications.map(({medication:m,estimate:e,overdue,missingActive})=><article className="estimate-card" key={m.id}>
        <h3>{m.name}の予測根拠</h3>
        <p>1本の期間：{e.days===null?'算出できません':`約${e.days}日`}<br/>根拠：{e.source==='actual'?'使い切り実績':e.source==='interval'?`${m.parallel}本前との開封間隔`:'履歴不足'}</p>
        {e.samples.length>0&&<><p className="muted small">古い順に{e.samples.map(n=>`${n}日`).join(' → ')}。直近ほど重く、重み{e.weights.join('：')}の加重平均です。</p><p className="muted small">（{e.samples.map((n,i)=>`${n}日×${e.weights[i]}`).join(' ＋ ')}） ÷ {e.weights.reduce((n,w)=>n+w,0)} ＝ 約{e.days}日</p></>}
        {m.expirationDays!==null&&<p className="muted small">将来のボトルは設定済み期限{m.expirationDays}日も上限として計算します。</p>}
        {e.warnings.map((w,i)=><p className="muted small" key={i}>{w}</p>)}
        {overdue&&<p className="message warning">交換目安を過ぎた分は今日の予定にまとめています。実物と実績をご確認ください。</p>}
        {e.days!==null&&missingActive&&<p className="muted small">使用中本数が設定より少ないため、不足分は今日開封する想定です。</p>}
      </article>)}</div>
      {!plan.openings.length?<p className="empty">この期間の予定はありません。履歴不足の薬剤は、実績が増えるまで日付を予測しません。</p>:<ol className="record-list opening-plan-list" aria-label="日付順の予測開封予定">{plan.openings.map(o=>{
        const m=state.medications.find(m=>m.id===o.medicationId)!;
        return <li key={`${o.date}-${o.medicationId}`}><div className="record-top"><div><strong><time dateTime={o.date}>{displayDate(o.date)}</time> · {m.name}</strong><span>{o.quantity}本を開封する予測</span></div><span className="badge">予測</span></div><p className="small">現在の在庫で対応：{o.stockCovered}本{o.uncovered>0&&<span className="warning-text"> ／ 追加で必要：{o.uncovered}本</span>}</p></li>;
      })}</ol>}
    </section>
  </>;
}
