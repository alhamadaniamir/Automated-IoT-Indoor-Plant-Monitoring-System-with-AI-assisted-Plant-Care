import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInput,wateringEligible,validatePlan,modelContext} from '../care.mjs';
import {generate} from '../providers.mjs';
import {weather} from '../weather.mjs';
import {createCareServer} from '../server.mjs';

export function fixture() {
  return {device_id:'plantcare-test',context_revision:1,supports_timed_care:true,location:{name:'Cagayan de Oro, Philippines',latitude:8.48222,longitude:124.64722},
    plants:['chinese_bamboo','pandakaki','calathea'].map((species,i)=>({id:i+1,species,
      profile:{taxon:['lucky_bamboo','pandacaqui','calathea_group'][i],placement:'Indoors beside a window',light_exposure:'Filtered morning light',soil_mix:'Draining potting mix',pot_size_cm:'15',fertilizer:'User-recorded product label',last_fertilized_at:'2026-09-01T00:00:00Z',max_water_seconds:15},
      reading:{raw:3000,percent:20,calibrated:true,faults:[],age_ms:10,boot_id:'boot-test'},history:[],
    }))};
}
export function modelOutput() {
  const task={decision:'notify',summary:'Example test recommendation',reason:'Test-only provider output.',confidence:'medium'};
  return {plants:[1,2,3].map(plant_id=>({plant_id,water:{...task,decision:'water',seconds:15},fertilizer:{...task},light:{...task},missing_information:[]}))};
}
const outside={status:'available',source:'test-weather',observed_at:new Date().toISOString()};
test('AI times preserve UTC offsets and future watering remains a check',()=>{
  const now=Date.UTC(2026,10,3,0);
  const output=modelOutput();
  for (const p of output.plants) for (const task of ['water','fertilizer','light'])
    Object.assign(p[task],{remind_at:'2026-11-03T15:33:00+08:00',reminder_kind:'care',timing_basis:'Forecast daylight window.'});
  const forecast={...outside,hourly:[{time:'2026-11-03T08:00:00Z'}]};
  const plan=validatePlan(output,fixture(),forecast,{now});
  assert.equal(plan.plants[0].light.remind_at,'2026-11-03T07:33:00.000Z');
  assert.equal(plan.plants[0].light.reminder_kind,'care');
  assert.equal(plan.plants[0].water.reminder_kind,'check');
  assert.match(plan.plants[0].water.summary,/soil moisture/);
});
test('early day flags cannot become confident bright-light exposure advice at 6 AM',()=>{
  const now=Date.UTC(2026,10,2,20), input=fixture(), output=modelOutput();
  input.phone_time={utc_epoch_seconds:now/1000,utc_offset_minutes:480};
  Object.assign(output.plants[2].light,{remind_at:'2026-11-03T06:00:00+08:00',reminder_kind:'care',timing_basis:'The day flag is true.'});
  const result=validatePlan(output,input,{...outside,hourly:[{time:'2026-11-03T02:00:00Z',is_day:true}]},{now});
  assert.equal(result.plants[2].light.reminder_kind,'check');
  assert.match(result.plants[2].light.timing_basis,/does not establish adequate brightness/);
});
test('generic preparation headings use the same AI explanation as a direct plant-specific summary',()=>{
  const output=modelOutput();
  output.plants[2].fertilizer.summary='Review starter feeding guidance';
  output.plants[2].fertilizer.reason='Check feeding needs during active growth. Follow the product label before application.';
  const result=validatePlan(output,fixture(),outside);
  assert.equal(result.plants[2].fertilizer.summary,'Calathea: Check feeding needs during active growth.');
  assert.equal(result.plants[2].fertilizer.reason,output.plants[2].fertilizer.reason);
});
test('older app versions cannot silently receive future actions as immediate alerts',()=>{
  const input=fixture();delete input.supports_timed_care;
  const output=modelOutput();Object.assign(output.plants[0].light,{remind_at:'2026-11-03T15:33:00+08:00',reminder_kind:'care',timing_basis:'Test'});
  assert.equal(modelContext(validateInput(input),outside).timed_reminders_supported,false);
  assert.equal(validatePlan(output,input,outside).plants[0].light.remind_at,null);
  assert.throws(()=>validateInput({...fixture(),supports_timed_care:1}));
});
test('invalid, past, excessive or unexplained AI reminder dates are rejected',()=>{
  const now=Date.UTC(2026,10,3,0);
  for(const remind_at of ['tomorrow','2026-11-02T00:00:00Z','2027-11-03T00:00:00Z',123]) {
    const output=modelOutput();Object.assign(output.plants[0].light,{remind_at,reminder_kind:'care',timing_basis:'Test'});
    assert.throws(()=>validatePlan(output,fixture(),outside,{now}));
  }
  const output=modelOutput();Object.assign(output.plants[0].light,{remind_at:'2026-11-03T01:00:00Z',timing_basis:''});
  assert.throws(()=>validatePlan(output,fixture(),outside,{now}));
});
test('a light time beyond the verified forecast becomes a daylight check rather than a sunshine claim',()=>{
  const now=Date.UTC(2026,10,3,0), output=modelOutput();
  Object.assign(output.plants[0].light,{remind_at:'2026-11-05T07:33:00Z',reminder_kind:'care',timing_basis:'Test suggestion'});
  const result=validatePlan(output,fixture(),{...outside,hourly:[{time:'2026-11-03T02:00:00Z'}]},{now});
  assert.equal(result.plants[0].light.reminder_kind,'check');
  assert.match(result.plants[0].light.timing_basis,/does not cover/);
});

test('all three species can receive combined care tasks; watering stays a proposal',()=>{
  const input=validateInput(fixture());
  const plan=validatePlan(modelOutput(),input,outside,{provider:'test',model:'test-model'});
  assert.equal(plan.source,'ai');assert.equal(plan.plants.length,3);
  assert.equal(plan.context_revision,1);
  assert.equal(plan.plants[0].water.seconds,15);
  assert.equal(plan.plants[0].fertilizer.decision,'notify');assert.equal(plan.plants[0].light.decision,'notify');
  assert.ok(plan.plants[0].sources[0].startsWith('https://plants.ces.ncsu.edu/'));
  assert.equal(plan.plants[0].reading_at_review.boot_id,'boot-test');
  assert.equal('command' in plan,false);
});
test('model cannot override faulty, stale, missing or uncalibrated soil data',()=>{
  for(const change of [p=>p.reading.faults=['adc_saturated'],p=>p.reading.age_ms=120001,p=>p.reading=null,p=>p.reading.calibrated=false,p=>p.reading.raw=4095]){
    const input=fixture();change(input.plants[0]);
    assert.equal(wateringEligible(input.plants[0]),false);
    const plan=validatePlan(modelOutput(),input,outside);
    assert.equal(plan.plants[0].water.decision,'check');assert.equal(plan.plants[0].water.seconds,null);
    assert.equal(plan.plants[1].water.decision,'water');
  }
});
test('watering guards remain while optional feeding history and light observations allow reminders',()=>{
  const input=fixture();input.plants[0].profile.taxon='';input.plants[1].profile.last_fertilized_at='';input.plants[2].profile.light_exposure='';
  const plan=validatePlan(modelOutput(),input,outside);
  assert.equal(plan.plants[0].water.decision,'check');assert.equal(plan.plants[0].light.decision,'notify');
  assert.equal(plan.plants[1].fertilizer.decision,'notify');assert.equal(plan.plants[2].light.decision,'notify');
});
test('starter fertilizer advice works for every selected pot without fabricating a feeding record',()=>{
  const input=fixture();
  input.plants.forEach(p=>{p.profile.last_fertilized_at='';p.profile.fertilizer='';});
  const before=structuredClone(input);
  const context=modelContext(validateInput(input),outside);
  assert.ok(context.plants.every(p=>p.feeding_context.guidance_mode==='starter' &&
    p.feeding_context.history_recorded===false && p.feeding_context.product_recorded===false));
  const output=modelOutput();
  const plan=validatePlan(output,input,outside);
  assert.ok(plan.plants.every(p=>p.fertilizer.decision==='notify'));
  assert.deepEqual(input,before);
  input.plants[1].profile.last_fertilized_at='2026-11-01T00:00:00Z';
  const later=modelContext(input,outside);
  assert.equal(later.plants[0].feeding_context.guidance_mode,'starter');
  assert.equal(later.plants[1].feeding_context.guidance_mode,'history_aware');
  assert.equal(later.plants[2].feeding_context.guidance_mode,'starter');
});
test('user-reported water and light timestamps reach the AI on their own pot and old clients still work',()=>{
  const input=fixture();
  validateInput(input);
  input.plants[0].profile.last_watered_at='2026-11-02T20:00:00Z';
  input.plants[1].profile.last_light_adjusted_at='2026-11-02T21:00:00Z';
  input.plants[0].history.push({kind:'watered',at:input.plants[0].profile.last_watered_at,source:'user_reported'});
  const context=modelContext(validateInput(input),outside);
  assert.equal(context.plants[0].profile.last_watered_at,'2026-11-02T20:00:00Z');
  assert.equal(context.plants[1].profile.last_watered_at,undefined);
  assert.equal(context.plants[1].profile.last_light_adjusted_at,'2026-11-02T21:00:00Z');
  assert.equal(context.plants[0].history[0].source,'user_reported');
  assert.equal('command' in context.plants[0],false);
});
test('duplicate IDs, unbounded duration, malformed output and wrong identity are rejected',()=>{
  const input=fixture();input.plants[0].profile.taxon='divaricata';assert.throws(()=>validateInput(input));
  for(const change of [r=>r.plants[0].water.seconds=21,r=>r.plants[1].plant_id=1,r=>r.plants[0].light.decision='switch_relay']){
    const output=modelOutput();change(output);assert.throws(()=>validatePlan(output,fixture(),outside));
  }
});
test('one or two selected pots use their chosen species rather than the channel number',()=>{
  for (const ids of [[3],[1,3]]) {
    const input=fixture();
    input.plants=input.plants.filter(p=>ids.includes(p.id)).map(p=>({...p,species:'calathea',profile:{...p.profile,taxon:'calathea_group'}}));
    validateInput(input);
    const context=modelContext(input,outside);
    assert.deepEqual(context.plants.map(p=>p.id),ids);
    assert.ok(context.plants.every(p=>p.identity.name==='Calathea / Goeppertia group'));
    const output=modelOutput();output.plants=output.plants.filter(p=>ids.includes(p.plant_id));
    const result=validatePlan(output,input,outside);
    assert.deepEqual(result.plants.map(p=>p.plant_id),ids);
    assert.ok(result.plants.every(p=>p.sources[0]==='https://www.rhs.org.uk/plants/calathea/growing-guide'));
  }
});
test('empty requests, unselected model output and missing selected pots are rejected',()=>{
  const input=fixture();input.plants=[input.plants[2]];
  assert.throws(()=>validateInput({...input,plants:[]}));
  assert.throws(()=>validatePlan(modelOutput(),input,outside));
  const wrong=modelOutput();wrong.plants=[wrong.plants[0]];
  assert.throws(()=>validatePlan(wrong,input,outside));
});
test('Gemini context uses the phone clock across local midnight and fractional offsets',()=>{
  const input=fixture();
  input.phone_time={utc_epoch_seconds:Date.UTC(2026,10,2,16,5)/1000,utc_offset_minutes:480};
  validateInput(input);
  assert.equal(modelContext(input,outside).phone_time.local_datetime,'2026-11-03T00:05:00+08:00');
  input.phone_time.utc_offset_minutes=-330;
  assert.equal(modelContext(input,outside).phone_time.local_datetime,'2026-11-02T10:35:00-05:30');
  input.phone_time.utc_offset_minutes=345;
  assert.equal(modelContext(input,outside).phone_time.local_datetime,'2026-11-02T21:50:00+05:45');
  delete input.phone_time;
  assert.equal(modelContext(input,outside).phone_time,null);
});
test('invalid phone timestamps or offsets cannot become care timing instructions',()=>{
  for (const phone_time of [
    {utc_epoch_seconds:'tomorrow',utc_offset_minutes:480},
    {utc_epoch_seconds:Date.UTC(2026,10,2)/1000,utc_offset_minutes:841},
    {utc_epoch_seconds:0,utc_offset_minutes:480},
    {utc_epoch_seconds:Date.UTC(2026,10,2)/1000,utc_offset_minutes:480.5},
  ]) assert.throws(()=>validateInput({...fixture(),phone_time}));
});
test('missing model credentials never produce rules labeled as AI',async()=>{
  let called=false;
  await assert.rejects(generate({}, {env:{SPROUT_PROVIDER:'gemini',SPROUT_MODEL:'test'},fetchImpl:async()=>{called=true;}}),/not configured/);
  assert.equal(called,false);
});
test('Gemini adapter sends a schema and accepts only complete model responses',async()=>{
  let payload,headers;
  const env={SPROUT_PROVIDER:'gemini',SPROUT_MODEL:'test-model',GEMINI_API_KEY:'test-not-a-real-key'};
  const fetchImpl=async(url,options)=>{
    payload=JSON.parse(options.body);headers=options.headers;
    assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'));
    return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(modelOutput())}]}}]}));
  };
  const value=await generate(modelContext(fixture(),outside),{env,fetchImpl});
  assert.equal(value.plants.length,3);assert.equal(headers['x-goog-api-key'],'test-not-a-real-key');
  assert.equal(payload.generationConfig.responseMimeType,'application/json');assert.ok(payload.generationConfig.responseJsonSchema);
  await assert.rejects(generate({}, {env,fetchImpl:async()=>new Response('{"candidates":[{"finishReason":"MAX_TOKENS"}]}')}));
});
test('weather verifies timestamps/units and discloses unavailable data',async()=>{
  const now=Date.UTC(2026,9,24,4,0);
  const valid={utc_offset_seconds:28800,current:{time:'2026-10-24T12:00',temperature_2m:30,relative_humidity_2m:70,cloud_cover:40,is_day:1},daily:{}};
  const result=await weather({name:'test',latitude:1,longitude:2},{now,fetchImpl:async()=>new Response(JSON.stringify(valid))});
  assert.equal(result.status,'available');assert.equal(result.observed_at,'2026-10-24T04:00:00.000Z');
  const missing=await weather({name:'other',latitude:3,longitude:4},{now,fetchImpl:async()=>{throw Error('offline');}});
  assert.equal(missing.status,'unavailable');assert.equal('temperature_c' in missing,false);
});
test('HTTP care route requires app auth, caches reviews, and exposes no pump route',async(t)=>{
  const token='test-app-token-123456789012345';let calls=0;
  const server=createCareServer({env:{SPROUT_APP_TOKEN:token,SPROUT_PROVIDER:'test',SPROUT_MODEL:'test'},
    generateImpl:async()=>{calls++;return modelOutput();},weatherImpl:async()=>outside});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const send=(path,auth,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  assert.equal((await send('/api/care/evaluate',false,fixture())).status,401);
  const first=await send('/api/care/evaluate',true,fixture());assert.equal(first.status,200);const a=await first.json();
  const second=await send('/api/care/evaluate',true,fixture());assert.equal((await second.json()).plan_id,a.plan_id);assert.equal(calls,1);
  assert.equal((await send('/api/water',true,{})).status,404);
});

test('all three pots retain their chosen names and species notes when varieties are unknown',()=>{
  const input=fixture();
  const choices=['calathea','chinese_bamboo','pandakaki'];
  input.plants.forEach((p,i)=>{p.species=choices[i];p.profile.taxon='';p.profile.light_exposure='';p.reading=null;});
  const context=modelContext(validateInput(input),outside);
  assert.deepEqual(context.plants.map(p=>p.selected_plant),['Calathea','Chinese bamboo','Pandakaki']);
  assert.deepEqual(context.plants.map(p=>p.identity.name),context.plants.map(p=>p.selected_plant));
  assert.ok(context.plants.every(p=>p.identity.possible_identities.length>0));
  const plan=validatePlan(modelOutput(),input,outside);
  plan.plants.forEach((p,i)=>{
    assert.equal(p.water.decision,'check');
    assert.ok(p.water.summary.includes(context.plants[i].selected_plant));
    assert.equal(p.light.decision,'notify');
    assert.ok(p.sources.length>0);
  });
});
