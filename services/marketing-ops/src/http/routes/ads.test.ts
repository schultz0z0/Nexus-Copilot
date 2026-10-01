import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerAds } from './ads.js';
import type { AdsIntegrationService } from '../../domain/ads.js';
import { AppError } from '../../errors.js';

function setup(write = true) {
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.actor={userId:'22222222-2222-4222-8222-222222222222',tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tenantSlug:'ens',role:'manager'}; req.correlationId='12345678-1234-4234-8234-123456789abc'; next(); });
  const service = { setup: vi.fn(async()=>({provider:'google',mode:'empty',version:1})),saveSetup:vi.fn(async()=>({provider:'google',mode:'managed',version:2})),list:vi.fn(async()=>[{provider:'google',status:'unprepared'}]), authorize:vi.fn(async()=>({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth'})), callback:vi.fn(async()=>({provider:'google',status:'pending_account',version:2})), selectAccount:vi.fn(async()=>({version:3,status:'connected'})), sync:vi.fn(async()=>({status:'completed'})) };
  registerAds(app,service as unknown as AdsIntegrationService,{read:true,write});
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{ res.status(error instanceof AppError ? error.status : 400).json({error:{code:error instanceof AppError?error.code:'validation_error'}}); });
  return { app,service };
}
describe('Ads HTTP contracts',()=>{
  it('exposes versioned administrative setup and requires both mutation headers',async()=>{
    const {app,service}=setup(); const path='/v1/ads-integrations/google/setup';
    const read=await request(app).get(path); expect(read.status).toBe(200); expect(read.headers.etag).toBe('"1"');
    const body={clientId:'company-client',clientSecret:'private-secret',apiVersion:'v25',scopes:['https://www.googleapis.com/auth/adwords']};
    expect((await request(app).post(path).send(body)).status).toBe(428);
    expect((await request(app).post(path).set('If-Match','"1"').send(body)).status).toBe(400);
    expect(service.saveSetup).not.toHaveBeenCalled();
    const saved=await request(app).post(path).set('If-Match','"1"').set('Idempotency-Key','setup1').send(body);
    expect(saved.status).toBe(200); expect(saved.headers.etag).toBe('"2"');
    expect(service.saveSetup).toHaveBeenCalledWith(expect.any(Object),'google',1,body,'setup1');
    expect((await request(app).post(path).set('If-Match','"1"').set('Idempotency-Key','setup2').send({...body,redirectUri:'https://evil.invalid'})).status).toBe(400);
  });
  it('lists prepared states and requires an internal session binding before authorization',async()=>{
    const {app,service}=setup(); expect((await request(app).get('/v1/ads-integrations')).body.data[0]?.status).toBe('unprepared');
    expect((await request(app).post('/v1/ads-integrations/google/authorize').send({})).status).toBe(400);
    expect(service.authorize).not.toHaveBeenCalled();
    const success = await request(app).post('/v1/ads-integrations/google/authorize').set('X-ENS-OAuth-Session','a'.repeat(64)).send({});
    expect(success.status).toBe(200); expect(success.body.data.authorizationUrl).toContain('accounts.google.com');
  });
  it('requires optimistic account versions and forbids arbitrary callback redirect parameters',async()=>{
    const {app,service}=setup(); expect((await request(app).post('/v1/ads-integrations/google/account').send({accountId:'123'})).status).toBe(428);
    expect((await request(app).post('/v1/ads-integrations/google/account').set('If-Match','"2"').send({accountId:'123'})).status).toBe(200);
    const invalid = await request(app).post('/v1/ads-integrations/google/callback').set('X-ENS-OAuth-Session','a'.repeat(64)).send({state:'s'.repeat(43),code:'code',redirectUri:'https://evil.invalid'});
    expect(invalid.status).toBe(400); expect(service.callback).not.toHaveBeenCalled();
  });
  it('keeps writes disabled and bounds explicit sync periods',async()=>{
    const disabled=setup(false); expect((await request(disabled.app).post('/v1/ads-integrations/google/authorize').send({})).status).toBe(503);
    const {app,service}=setup(); const path='/v1/campaigns/12345678-1234-4234-8234-123456789abc/ads-links/87654321-4321-4321-8321-123456789abc/sync';
    expect((await request(app).post(path).set('Idempotency-Key','job1').send({from:'2025-01-01',to:'2025-03-01'})).status).toBe(400);
    expect(service.sync).not.toHaveBeenCalled();
    expect((await request(app).post(path).set('Idempotency-Key','job1').send({from:'2025-01-01',to:'2025-01-01'})).status).toBe(200);
  });
});
