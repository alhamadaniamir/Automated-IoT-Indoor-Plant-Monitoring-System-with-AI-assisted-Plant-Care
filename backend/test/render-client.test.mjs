import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderClient,renderService,cloudBranch,plantRepository} from '../render-client.mjs';
test('cloud deployment is restricted to the free plant service and server-side credentials',()=>{
 const value=renderService('tea-test123',{GEMINI_API_KEY:'test-model-key',SPROUT_APP_TOKEN:'test-private-app-token-12345678',SPROUT_MODEL:'gemini-3.5-flash-lite'});
 assert.equal(value.serviceDetails.plan,'free');assert.equal(value.serviceDetails.numInstances,1);
 assert.equal(value.repo,plantRepository);assert.equal(value.branch,cloudBranch);assert.equal(value.autoDeployTrigger,'off');
 const env=Object.fromEntries(value.envVars.map(v=>[v.key,v.value]));
 assert.equal(env.GEMINI_API_KEY,'test-model-key');assert.equal(env.SPROUT_DEPLOYMENT,'cloud');assert.equal('SPROUT_PORT' in env,false);
 assert.throws(()=>renderService('not-an-owner',{}));
});
test('Render API errors redact credentials and never follow redirects',async()=>{
 const secret='test-render-secret';
 const client=new RenderClient(secret,{fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.render.com/v1/services');assert.equal(options.redirect,'error');
  return new Response(JSON.stringify({message:'Refused '+secret+' model-secret'}),{status:400});
 },secrets:['model-secret']});
 await assert.rejects(client.request('/services'),error=>!error.message.includes(secret)&&!error.message.includes('model-secret')&&error.message.includes('400'));
});
