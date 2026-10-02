import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {decodeJwt} from 'jose';
import {createApp} from '../src/server.js';

const actor = {user_id:'11111111-1111-4111-8111-111111111111',tenant_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'manager'};
const config = {cookieSecret:'cookie-test',cookieName:'ens_session',marketingOps:{internalUrl:'http://marketing-ops:8091',maxBodyBytes:65536,timeoutMs:100,assertion:{activeKey:'workspace-test-bff-secret-with-more-than-32-bytes',activeKid:'bff-v1',issuer:'ens-app-api',audience:'ens-marketing-ops'}}};
const db = {query:async sql=>({rows:sql.includes('resolve_session')?[actor]:[]})};

test('Workspace authorize binds the real session and dedicated callback trusts only service from the domain',async()=>{
 const calls=[];
 const app=await createApp({config,db,fetch:async(url,init)=>{calls.push({url:String(url),init});return Response.json({data:{service:'google_drive'}});}});
 try{
  await app.inject({method:'POST',url:'/api/marketing/workspace/google_drive/authorize',cookies:{ens_session:'first-session'},headers:{'x-ens-oauth-session':'forged'},payload:{}});
  const r=await app.inject({url:'/api/workspace/oauth/google/callback?state=private-state&code=private-code&service=microsoft_mail&redirect_uri=https://attacker.test',cookies:{ens_session:'first-session'}});
  assert.equal(r.statusCode,303);
  assert.equal(r.headers.location,'/settings/integrations?tab=workspace&service=google_drive&result=connected');
  assert.equal(r.headers['cache-control'],'no-store');
  assert.equal(r.headers['referrer-policy'],'no-referrer');
  const first=new Headers(calls[0].init.headers).get('x-ens-oauth-session');
  assert.match(first,/^[a-f0-9]{64}$/);
  assert.equal(new Headers(calls[1].init.headers).get('x-ens-oauth-session'),first);
  assert.equal(calls[1].url,'http://marketing-ops:8091/v1/workspace/oauth/google/callback');
  assert.deepEqual(JSON.parse(calls[1].init.body),{state:'private-state',code:'private-code'});
  const claims=decodeJwt(new Headers(calls[1].init.headers).get('x-ens-actor-assertion'));
  assert.equal(claims.path,'/v1/workspace/oauth/google/callback');assert.equal(claims.method,'POST');
  await app.inject({method:'POST',url:'/api/marketing/workspace/google_calendar/authorize',cookies:{ens_session:'second-session'},payload:{}});
  assert.notEqual(new Headers(calls[2].init.headers).get('x-ens-oauth-session'),first);
 }finally{await app.close();}
});
test('Workspace callback rejects malformed/family-mismatched service and oversized upstream replies',async()=>{
 for(const body of ['not JSON',JSON.stringify({data:{service:'microsoft_mail'}}),JSON.stringify({data:{service:'google_drive',private:'x'.repeat(9000)}})]){
  const app=await createApp({config,db,fetch:async()=>new Response(body)});
  try{const r=await app.inject({url:'/api/workspace/oauth/google/callback?state=s&code=c',cookies:{ens_session:'session'}});assert.equal(r.headers.location,'/settings/integrations?tab=workspace&result=invalid');}finally{await app.close();}
 }
});
test('Workspace callback does not expose codes or upstream errors and refuses invalid requests before calling upstream',async()=>{
 let calls=0;const logs=[];
 const app=await createApp({config,db,logger:{stream:{write:line=>logs.push(line)}},fetch:async()=>{calls++;return Response.json({error:{code:'workspace_api_disabled',message:'private-upstream-token'}},{status:403});}});
 try{
  for(const url of ['/api/workspace/oauth/google/callback?state=s&code=c','/api/workspace/oauth/unknown/callback?state=s&code=c'])await app.inject({url});
  await app.inject({url:'/api/workspace/oauth/google/callback?state=s&code=c&error=denied',cookies:{ens_session:'session'}});
  assert.equal(calls,0);
  const r=await app.inject({url:'/api/workspace/oauth/microsoft/callback?state=private-state&code=private-code',cookies:{ens_session:'session'}});
  assert.equal(r.headers.location,'/settings/integrations?tab=workspace&result=api_disabled');
  assert.doesNotMatch(logs.join(''),/private-state|private-code|private-upstream-token|ens_session/);
 }finally{await app.close();}
});
test('Workspace callbacks deny ordinary members without provider calls',async()=>{
 let calls=0;
 const memberDb={query:async sql=>({rows:sql.includes('resolve_session')?[{...actor,role:'member'}]:[]})};
 const app=await createApp({config,db:memberDb,fetch:async()=>{calls++;return Response.json({data:{service:'microsoft_files'}});}});
 try{const r=await app.inject({url:'/api/workspace/oauth/microsoft/callback?state=s&code=c',cookies:{ens_session:'session'}});assert.equal(r.headers.location,'/settings/integrations?tab=workspace&result=session_required');assert.equal(calls,0);}finally{await app.close();}
});
test('Workspace provider operations receive a bounded extended proxy deadline',async()=>{
 const budgets=[];mock.method(AbortSignal,'timeout',value=>{budgets.push(value);return new AbortController().signal;});
 const app=await createApp({config,db,fetch:async()=>Response.json({data:{}})});
 try{await app.inject({url:'/api/marketing/workspace/google_sheets/sheet',cookies:{ens_session:'session'}});await app.inject({method:'POST',url:'/api/marketing/campaigns/11111111-1111-4111-8111-111111111111/workspace-links',cookies:{ens_session:'session'},payload:{service:'google_drive',kind:'file',resourceId:'file-1'}});await app.inject({url:'/api/marketing/campaigns',cookies:{ens_session:'session'}});assert.deepEqual(budgets,[120000,120000,100]);}finally{await app.close();mock.restoreAll();}
});
test('Malformed installation settings do not echo credential-bearing JSON in errors or logs',async()=>{
 const logs=[];const secret='synthetic-workspace-installation-secret';let calls=0;
 const app=await createApp({config,db,logger:{stream:{write:line=>logs.push(line)}},fetch:async()=>{calls++;return Response.json({data:{}});}});
 try{
  const r=await app.inject({method:'POST',url:'/api/marketing/workspace/apps/microsoft',cookies:{ens_session:'session'},headers:{'content-type':'application/json'},payload:`{"clientSecret":"${secret}","tenantId":`});
  assert.equal(r.statusCode,400);assert.equal(calls,0);assert.doesNotMatch(r.body+logs.join(''),new RegExp(secret));
 }finally{await app.close();}
});
