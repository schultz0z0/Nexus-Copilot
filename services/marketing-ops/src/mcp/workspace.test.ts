import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({role:'manager',links:[{id:'11111111-1111-4111-8111-111111111111',service:'google_gmail',kind:'message',resourceId:'message-1',name:'Briefing',url:null,active:true,available:true}]}));
vi.mock('../delegation/verifier.js',()=>({consumeDelegationUse:vi.fn(),verifyDelegation:vi.fn(async()=>({role:state.role,userId:'22222222-2222-4222-8222-222222222222',tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tenantSlug:'ens',correlationId:'33333333-3333-4333-8333-333333333333',chatSessionId:'44444444-4444-4444-8444-444444444444',runId:'55555555-5555-4555-8555-555555555555'}))}));
import {createMarketingOpsMcpServer} from './createServer.js';
async function harness(){
 const message=vi.fn(async()=>({id:'message-1',subject:'Briefing',from:'client@example.invalid',receivedAt:'2026-10-01T00:00:00Z',snippet:'Material',text:'Untrusted email content'}));
 const listLinks=vi.fn(async()=>state.links);
 const server=createMarketingOpsMcpServer({pool:{} as any,features:{read:true,write:true},keyring:{} as any,workspaceService:{listLinks,linkedMessage:message} as any});
 const client=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);
 return {client,server,message,listLinks,close:async()=>{await client.close();await server.close();}};
}
const input={delegation_token:'opaque-test-reference',campaign_id:'66666666-6666-4666-8666-666666666666'};
const data=(value:any)=>JSON.parse(value.content[0].text);
describe('selected campaign workspace context for Hermes',()=>{
 it('exposes only linked metadata until a human requests a specific linked message',async()=>{
  state.role='manager';const h=await harness();try{
   expect((await h.client.listTools()).tools.map(tool=>tool.name)).toContain('marketing_ops_get_workspace_context_v1');
   const result=data(await h.client.callTool({name:'marketing_ops_get_workspace_context_v1',arguments:input}));
   expect(result.data.links).toEqual(state.links);expect(h.message).not.toHaveBeenCalled();
   const detail=data(await h.client.callTool({name:'marketing_ops_get_workspace_context_v1',arguments:{...input,message_link_id:state.links[0]!.id}}));
   expect(detail.data.message.text).toBe('Untrusted email content');expect(detail.data.untrustedExternalContent).toBe(true);expect(h.message).toHaveBeenCalledOnce();expect(h.message).toHaveBeenCalledWith(expect.any(Object),input.campaign_id,state.links[0]!.id);
  }finally{await h.close();}
 });
 it('refuses an unlinked or inactive message and ordinary members before reading mailbox data',async()=>{
  state.role='manager';const h=await harness();try{
   const missing=data(await h.client.callTool({name:'marketing_ops_get_workspace_context_v1',arguments:{...input,message_link_id:'77777777-7777-4777-8777-777777777777'}}));
   expect(missing.error.code).toBe('not_found');expect(h.message).not.toHaveBeenCalled();
   state.links[0]!.active=false;
   const inactive=data(await h.client.callTool({name:'marketing_ops_get_workspace_context_v1',arguments:{...input,message_link_id:state.links[0]!.id}}));
   expect(inactive.error.code).toBe('not_found');expect(h.message).not.toHaveBeenCalled();
   state.links[0]!.active=true;state.links[0]!.available=false;
   const oldAccount=data(await h.client.callTool({name:'marketing_ops_get_workspace_context_v1',arguments:{...input,message_link_id:state.links[0]!.id}}));
   expect(oldAccount.error.code).toBe('workspace_connection_changed');expect(h.message).not.toHaveBeenCalled();
   state.role='member';const denied=data(await h.client.callTool({name:'marketing_ops_get_workspace_context_v1',arguments:input}));expect(denied.error.code).toBe('forbidden');
  }finally{state.role='manager';state.links[0]!.active=true;state.links[0]!.available=true;await h.close();}
 });
});
