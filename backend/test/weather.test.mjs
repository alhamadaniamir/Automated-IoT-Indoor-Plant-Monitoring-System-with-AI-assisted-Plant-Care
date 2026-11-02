import test from 'node:test';
import assert from 'node:assert/strict';
import {weather,validateWeatherLocation} from '../weather.mjs';
import {createCareServer} from '../server.mjs';
import {metWeather} from '../met-weather.mjs';

const time=Date.UTC(2026,10,2,19,20);
const metFixture=()=>({properties:{meta:{updated_at:'2026-11-02T19:10:00Z',units:{air_temperature:'celsius',relative_humidity:'%',cloud_area_fraction:'%'}},timeseries:[
  {time:'2026-11-02T19:00:00Z',data:{instant:{details:{air_temperature:25,relative_humidity:88,cloud_area_fraction:20}},next_1_hours:{summary:{symbol_code:'fair_night'}}}},
  {time:'2026-11-02T22:00:00Z',data:{instant:{details:{air_temperature:26,relative_humidity:85,cloud_area_fraction:30}},next_1_hours:{summary:{symbol_code:'fair_day'}}}},
]}});

test('a cloud rate limit falls back to attributed, fresh weather and backs off the primary',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push(String(url));
    if(new URL(url).host==='api.open-meteo.com')return new Response('limited',{status:429});
    assert.match(options.headers['User-Agent'],/Sprout-Plant-Care.*github/);
    return Response.json(metFixture());
  };
  const location={name:'Cagayan de Oro',latitude:8.48222,longitude:124.64722};
  const value=await weather(location,{fetchImpl,now:time});
  assert.equal(value.status,'available');assert.equal(value.source,'MET Norway');
  assert.equal(value.primary_failure_reason,'http_429');assert.equal(value.temperature_c,25);
  assert.equal(value.humidity_pct,88);assert.equal(value.is_day,false);
  assert.equal(value.hourly[0].is_day,true);assert.match(value.attribution,/CC BY 4.0/);
  assert.deepEqual(value.daily,{});assert.equal('precipitation_probability_max' in value,false);
  await weather(location,{fetchImpl,now:time+1000});assert.equal(requests.length,2);
  await weather({...location,latitude:8.49},{fetchImpl,now:time+2000});
  assert.equal(requests.filter(u=>new URL(u).host==='api.open-meteo.com').length,1);
});

test('backup weather cannot silently accept wrong units, stale forecasts, saturation or a missing daylight symbol',async()=>{
  for(const mutate of [d=>d.properties.meta.units.air_temperature='fahrenheit',d=>d.properties.meta.updated_at='2000-01-01T00:00:00Z',d=>d.properties.timeseries[0].data.instant.details.relative_humidity=101]){
    const data=metFixture();mutate(data);
    await assert.rejects(metWeather({name:'test',latitude:10,longitude:20},{now:time,get:async()=>data}));
  }
  const data=metFixture();delete data.properties.timeseries[0].data.next_1_hours;
  const value=await metWeather({name:'test',latitude:10,longitude:20},{now:time,get:async()=>data});
  assert.equal(value.is_day,null);
});

test('weather failures expose a bounded reason without leaking provider text or invented measurements',async()=>{
  const cases=[
    [async()=>new Response('provider text that must stay private',{status:429}),'http_429'],
    [async()=>{throw new DOMException('request detail','TimeoutError');},'timeout'],
    [async()=>{throw new Error('private network detail');},'network_error'],
    [async()=>new Response('broken JSON'),'invalid_response'],
    [async()=>new Response('{}'),'invalid_data'],
    [async()=>Response.json({current:{time:'2000-01-01T00:00',temperature_2m:25,relative_humidity_2m:70,cloud_cover:25,is_day:1},utc_offset_seconds:0}),'stale_data'],
  ];
  for (let i=0;i<cases.length;i++) {
    const [fetchImpl,reason]=cases[i];
    const result=await weather({name:'test',latitude:20+i,longitude:10},{fetchImpl,allowFallback:false});
    assert.equal(result.status,'unavailable');assert.equal(result.failure_reason,reason);
    assert.equal('temperature_c' in result,false);assert.doesNotMatch(JSON.stringify(result),/private|provider text/);
  }
});

test('weather checks validate locations and require app authentication without invoking Gemini',async(t)=>{
  for (const location of [null,{name:'test',latitude:'8',longitude:124},{name:'test',latitude:91,longitude:124}])
    assert.throws(()=>validateWeatherLocation(location));
  const token='test-weather-access-token-12345';let calls=0;
  const server=createCareServer({env:{SPROUT_APP_TOKEN:token},
    generateImpl:async()=>{throw Error('Weather checks must not invoke Gemini');},
    weatherImpl:async(location)=>{calls++;return {status:'available',source:'test',location:location.name};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/api/weather';
  const request=(value,authorized=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value)});
  const value={location:{name:'Cagayan de Oro',latitude:8.48222,longitude:124.64722}};
  assert.equal((await request(value,false)).status,401);
  assert.equal((await request({location:{name:'invalid',latitude:200,longitude:0}})).status,400);
  const response=await request(value);assert.equal(response.status,200);
  assert.equal((await response.json()).location,'Cagayan de Oro');assert.equal(calls,1);
});
