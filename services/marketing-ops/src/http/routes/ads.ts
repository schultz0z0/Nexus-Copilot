import type { Router,Request } from 'express';
import { z } from 'zod';
import type { AdsIntegrationService } from '../../domain/ads.js';
import { AdsAccountInputSchema, AdsCallbackSchema, AdsLinkInputSchema, AdsPeriodSchema, AdsProviderSchema } from '../../domain/adsContracts.js';
import { appError } from '../../errors.js';
import { actorFrom, asyncRoute, parseIfMatch, requireFeature, requireIdempotencyKey } from '../middleware.js';
import { adsSetupSchema } from '../../domain/adsSetupContracts.js';
import type { WebAnalyticsService } from '../../domain/webAnalytics.js';

const params = z.object({id:z.string().uuid(),linkId:z.string().uuid().optional()});
const empty = z.object({}).strict();
function session(request:Request):string {
  const value=request.header('x-ens-oauth-session');
  if (!value || !/^[0-9a-f]{64}$/.test(value)) throw appError('oauth_session_required',400,'An internal session binding is required');
  return value;
}
export function registerAds(router:Router,service:AdsIntegrationService,features:{read:boolean;write:boolean},analytics?:WebAnalyticsService):void {
  const context=(request:Request)=>({pool:service.pool,actor:actorFrom(request),correlationId:request.correlationId,origin:'rest' as const});
  const provider=(request:Request)=>AdsProviderSchema.parse(request.params.provider);
  router.get('/v1/ads-integrations',asyncRoute(async(req,res)=>{requireFeature(features.read,'read'); res.json({data:await service.list(context(req))});}));
  router.get('/v1/ads-integrations/:provider/setup',asyncRoute(async(req,res)=>{requireFeature(features.read,'read'); const data=await service.setup(context(req),provider(req)); res.setHeader('ETag',`"${data.version}"`).json({data});}));
  router.post('/v1/ads-integrations/:provider/setup',asyncRoute(async(req,res)=>{requireFeature(features.write,'write'); const selected=provider(req); const expected=parseIfMatch(req); const key=requireIdempotencyKey(req); const input=adsSetupSchema(selected).parse(req.body); const data=await service.saveSetup(context(req),selected,expected,input,key); res.setHeader('ETag',`"${data.version}"`).json({data});}));
  router.post('/v1/ads-integrations/:provider/authorize',asyncRoute(async(req,res)=>{requireFeature(features.write,'write'); empty.parse(req.body); res.json({data:await service.authorize(context(req),provider(req),session(req))});}));
  router.post('/v1/ads-integrations/:provider/callback',asyncRoute(async(req,res)=>{requireFeature(features.write,'write'); const input=AdsCallbackSchema.parse(req.body);const selected=provider(req);const current=context(req);const bound=session(req);if(selected==='google'&&analytics&&await analytics.ownsState(current,bound,input.state)){res.setHeader('x-ens-oauth-intent','ga4');res.json({data:await analytics.callback(current,bound,input)});return;} res.json({data:await service.callback(current,selected,bound,input)});}));
  router.get('/v1/ads-integrations/:provider/accounts',asyncRoute(async(req,res)=>{requireFeature(features.read,'read'); res.json({data:await service.accounts(context(req),provider(req))});}));
  router.post('/v1/ads-integrations/:provider/account',asyncRoute(async(req,res)=>{requireFeature(features.write,'write'); const data=await service.selectAccount(context(req),provider(req),parseIfMatch(req),AdsAccountInputSchema.parse(req.body)); res.setHeader('ETag',`"${data.version}"`).json({data});}));
  router.post('/v1/ads-integrations/:provider/disconnect',asyncRoute(async(req,res)=>{requireFeature(features.write,'write'); empty.parse(req.body); const data=await service.disconnect(context(req),provider(req),parseIfMatch(req)); res.setHeader('ETag',`"${data.version}"`).json({data});}));
  router.get('/v1/ads-integrations/:provider/campaigns',asyncRoute(async(req,res)=>{requireFeature(features.read,'read'); res.json({data:await service.externalCampaigns(context(req),provider(req))});}));
  router.get('/v1/campaigns/:id/ads-links',asyncRoute(async(req,res)=>{requireFeature(features.read,'read'); res.json({data:await service.listLinks(context(req),params.parse(req.params).id)});}));
  router.post('/v1/campaigns/:id/ads-links',asyncRoute(async(req,res)=>{requireFeature(features.write,'write'); const data=await service.createLink(context(req),params.parse(req.params).id,AdsLinkInputSchema.parse(req.body),requireIdempotencyKey(req)); res.status(201).setHeader('ETag',`"${data.version}"`).json({data});}));
  router.post('/v1/campaigns/:id/ads-links/:linkId/disable',asyncRoute(async(req,res)=>{requireFeature(features.write,'write'); empty.parse(req.body); const {id,linkId}=params.parse(req.params); const data=await service.disableLink(context(req),id,linkId!,parseIfMatch(req),requireIdempotencyKey(req)); res.setHeader('ETag',`"${data.version}"`).json({data});}));
  router.post('/v1/campaigns/:id/ads-links/:linkId/sync',asyncRoute(async(req,res)=>{requireFeature(features.write,'write'); const {id,linkId}=params.parse(req.params); res.json({data:await service.sync(context(req),id,linkId!,AdsPeriodSchema.parse(req.body),requireIdempotencyKey(req))});}));
  router.get('/v1/campaigns/:id/ads-links/:linkId/results',asyncRoute(async(req,res)=>{requireFeature(features.read,'read'); const {id,linkId}=params.parse(req.params); res.json({data:await service.results(context(req),id,linkId!)});}));
}
