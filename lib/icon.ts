import { ImageResponse } from 'next/og';
import { createElement } from 'react';
export function dropIcon(size:number):ImageResponse {
  return new ImageResponse(createElement('div',{style:{width:'100%',height:'100%',background:'#087E79',display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'22%'}},createElement('div',{style:{background:'#FFFFFF',width:'42%',height:'52%',borderRadius:'60% 60% 65% 65%',display:'flex',alignItems:'center',justifyContent:'center',color:'#087E79',fontSize:Math.round(size/4),fontWeight:700}},'+')), {width:size,height:size});
}
