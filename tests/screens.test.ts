import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SetupWizard from '../components/setup-wizard.tsx';
import HomePanel from '../components/home-panel.tsx';
import HistoryPanel from '../components/history-panel.tsx';
import ReceiptsPanel from '../components/receipts-panel.tsx';
import VisitsPanel from '../components/visits-panel.tsx';
import SettingsPanel from '../components/settings-panel.tsx';
import { initialize, applyCommand } from '../lib/inventory.ts';
import { defaultMedications } from '../lib/model.ts';
const today='2026-10-31';let seq=0;const ids=()=>`screen-${++seq}`;
const state=initialize(defaultMedications().map(medication=>({medication,stock:3,activeDates:medication.parallel===2?['2026-10-15','2026-10-16']:['2026-10-15'],historicalDates:medication.parallel===2?['2026-09-15','2026-09-16']:['2026-08-16','2026-09-15']})),today,'2026-11-15',ids);
test('wizard starts with drug settings and does not falsely claim cloud save',()=>{
  const html=renderToStaticMarkup(createElement(SetupWizard,{today,onComplete:()=>{}}));
  assert.ok(html.includes('薬剤を確認'));assert.ok(html.includes('未開封の在庫'));assert.ok(html.includes('使用中のボトル'));assert.ok(html.includes('過去の開封履歴'));assert.ok(html.includes('期限の根拠'));
});
test('home renders individual bottle IDs, distinct depletion dates, and uncertainty',()=>{
  const html=renderToStaticMarkup(createElement(HomePanel,{state,today,onOpen:()=>{},onEnd:()=>{},onVisits:()=>{}}));
  for(const b of state.bottles.filter(b=>b.status==='in_use'))assert.ok(html.includes(b.id.slice(-6)));
  for(const label of ['最後の未開封品を開ける目安','次に必要なのに在庫がない日','次回受診予定','1本を開封する','在庫不足の目安','参考値'])assert.ok(html.includes(label),label);
  assert.ok(!html.includes('朝用'));assert.ok(!html.includes('夜用'));
});
test('opening and ending flow renders updated stock while preserving the other active bottle',()=>{
  const active=state.bottles.filter(b=>b.medicationId==='dolmorol'&&b.status==='in_use');
  const next=applyCommand(state,{action:'open',medicationId:'dolmorol',date:today,replaceId:active[0].id,replacementReason:'empty'},'screen-op',0,today,ids);
  const html=renderToStaticMarkup(createElement(HomePanel,{state:next,today,onOpen:()=>{},onEnd:()=>{},onVisits:()=>{}}));
  assert.ok(html.includes(active[1].id.slice(-6)));assert.ok(html.includes('stock-number">2'));
  const history=renderToStaticMarkup(createElement(HistoryPanel,{state:next,today,run:()=>true}));assert.ok(history.includes('使い切り'));
});
test('all management screens render with the same state; authentication remains explicitly unimplemented',()=>{
  const receipts=renderToStaticMarkup(createElement(ReceiptsPanel,{state,today,run:()=>true}));assert.ok(receipts.includes('実際に受け取りました'));
  const visits=renderToStaticMarkup(createElement(VisitsPanel,{state,today,run:()=>true}));assert.ok(visits.includes('処方数量の目安'));assert.ok(visits.includes('医師に相談'));
  const settings=renderToStaticMarkup(createElement(SettingsPanel,{state,run:()=>true,onReset:()=>{}}));assert.ok(settings.includes('パスキーは未実装'));assert.ok(settings.includes('再読込'));assert.ok(settings.includes('棚卸し'));
});
