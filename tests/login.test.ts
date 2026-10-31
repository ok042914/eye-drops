import test from 'node:test';
import assert from 'node:assert/strict';
import { sendLoginCode, verifyLoginCode } from '../lib/login.ts';

type Auth=Parameters<typeof sendLoginCode>[0];
function fakeAuth(result:{error:unknown}={error:null}){
  const calls:{method:string;args:unknown}[]=[];
  const auth={
    signInWithOtp:async(args:unknown)=>{calls.push({method:'send',args});return result;},
    verifyOtp:async(args:unknown)=>{calls.push({method:'verify',args});return result;},
  } as unknown as Auth;
  return {auth,calls};
}
test('login reuses a registered account without a separate email restriction or signup',async()=>{
  const {auth,calls}=fakeAuth();
  await sendLoginCode(auth,' lens-user@example.com ');
  assert.deepEqual(calls,[{method:'send',args:{email:'lens-user@example.com',options:{shouldCreateUser:false}}}]);
});
test('verification sends the entered email code using the same OTP type as Lens Stock',async()=>{
  const {auth,calls}=fakeAuth();
  await verifyLoginCode(auth,' lens-user@example.com ',' 12345678 ');
  assert.deepEqual(calls,[{method:'verify',args:{email:'lens-user@example.com',token:'12345678',type:'email'}}]);
});
test('send failure is shown and cannot be mistaken for successful delivery',async()=>{
  const {auth}=fakeAuth({error:{message:'provider failure'}});
  await assert.rejects(sendLoginCode(auth,'lens-user@example.com'),/送信できません/);
});
test('an expired or incorrect code is shown without accepting a session',async()=>{
  const {auth}=fakeAuth({error:{message:'expired'}});
  await assert.rejects(verifyLoginCode(auth,'lens-user@example.com','123456'),/最新のコード/);
});
