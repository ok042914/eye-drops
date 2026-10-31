import { NextResponse } from 'next/server';
export const dynamic='force-dynamic';
export async function GET(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return NextResponse.json({configured:false},{status:503});
  const headers={apikey:key};
  try{
    const [auth,api,privateSchema]=await Promise.all([fetch(url+'/auth/v1/settings',{headers,cache:'no-store',signal:AbortSignal.timeout(5000)}),fetch(url+'/rest/v1/',{headers,cache:'no-store',signal:AbortSignal.timeout(5000)}),fetch(url+'/rest/v1/stock_balances?select=quantity&limit=0',{headers:{...headers,'Accept-Profile':'eye_stock'},cache:'no-store',signal:AbortSignal.timeout(5000)})]);
    const settings=auth.ok?await auth.json():{};const spec=api.ok?await api.json():{};const privateResult=await privateSchema.json();
    return NextResponse.json({configured:true,privateSchemaHidden:privateResult.code==='PGRST106',authReachable:auth.ok,emailEnabled:settings.external?.email??null,signupDisabled:settings.disable_signup??null,passkeyEnabled:settings.passkey_enabled??null,postgrestVersion:spec.info?.version??null},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({configured:true,reachable:false},{status:503});}
}
