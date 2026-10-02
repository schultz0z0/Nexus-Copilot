import {randomUUID} from 'node:crypto';
import {validateSession} from '../auth/service.js';
import {createActorAssertion} from './assertion.js';
import {oauthSessionBinding} from './adsOAuth.js';

const services = new Set(['google_drive','google_gmail','google_calendar','google_sheets','google_search_console','microsoft_files','microsoft_mail','microsoft_calendar']);
const valid = (value,maximum=1024)=>typeof value==='string' && value.length>0 && value.length<=maximum && !/[\x00-\x1f\x7f]/.test(value);
async function boundedJson(response) {
 if(!response.body)return null;
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return null;}chunks.push(Buffer.from(value));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch{return null;}finally{reader.releaseLock();}
}

/** Callback values are never reflected into redirects, provider requests or logs. */
export async function workspaceOAuthRoutes(fastify,options) {
 const {config,db}=options;const marketing=config.marketingOps;const fetchImpl=options.fetch??globalThis.fetch;
 fastify.get('/api/workspace/oauth/:family/callback',async(request,reply)=>{
  reply.header('cache-control','no-store').header('referrer-policy','no-referrer');
  const family=request.params.family;
  const redirect=(result,service)=>reply.code(303).header('location',`/settings/integrations?tab=workspace${service?`&service=${service}`:''}&result=${result}`).send();
  if(!['google','microsoft'].includes(family))return redirect('invalid');
  const token=request.cookies?.[config.cookieName||'ens_session'];
  if(!token)return redirect('session_required');
  const actor=await validateSession(db,token);
  if(!actor?.tenant_id||!['admin','manager'].includes(actor.role))return redirect('session_required');
  const {state,code,error}=request.query;
  if(!valid(state)||(code!==undefined&&!valid(code,4096))||(error!==undefined&&!valid(error,200))||(!code&&!error)||(code&&error))return redirect('invalid');
  const path=`/v1/workspace/oauth/${family}/callback`;const correlationId=randomUUID();
  try{
   const headers=new Headers({'content-type':'application/json','x-correlation-id':correlationId,'x-ens-oauth-session':oauthSessionBinding(token,marketing.assertion),'x-ens-actor-assertion':await createActorAssertion({actor,correlationId,method:'POST',path},marketing.assertion)});
   const upstream=await fetchImpl(`${marketing.internalUrl}${path}`,{method:'POST',headers,body:JSON.stringify({state,...(code?{code}:{error})}),redirect:'error',signal:AbortSignal.timeout(120000)});
   const body=await boundedJson(upstream);
   if(upstream.ok){const service=body?.data?.service;return services.has(service)&&service.startsWith(`${family}_`)?redirect('connected',service):redirect('invalid');}
   if([400,409,410,422].includes(upstream.status))return redirect('invalid');
   if(error&&[401,403].includes(upstream.status))return redirect('cancelled');
   if(body?.error?.code==='workspace_api_disabled')return redirect('api_disabled');
   if([401,403].includes(upstream.status)||body?.error?.code==='workspace_permission_required')return redirect('permission_required');
   if(upstream.status===429||body?.error?.code==='workspace_rate_limited')return redirect('rate_limited');
   return redirect('unavailable');
  }catch{return redirect('unavailable');}
 });
}
