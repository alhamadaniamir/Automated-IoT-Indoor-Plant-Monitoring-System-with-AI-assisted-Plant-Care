import {timingSafeEqual} from 'node:crypto';
import {CareError} from './care.mjs';

const idPattern=/^[a-zA-Z0-9_-]{8,80}$/;
const fieldsByPath={
  '/api/manual':['plant','token'], '/api/manual/renew':['plant','token'],
  '/api/stop':['plant'], '/api/plant':['plant','species','schedule','hour','minute','seconds'],
  '/api/time':['epoch','offset'], '/api/approved-water':['plant','token','request_id','seconds','expires'],
};
export function deviceConfigured(env) {
  return /^plantcare-[a-z0-9-]{1,40}$/.test(env.SPROUT_DEVICE_ID??'') &&
    /^[A-Za-z0-9_-]{32,128}$/.test(env.SPROUT_DEVICE_TOKEN??'') && env.SPROUT_DEVICE_TOKEN!==env.SPROUT_APP_TOKEN;
}
export function authorizeDevice(req,env) {
  if(!deviceConfigured(env))throw new CareError(503,'Online plant connection is not configured yet.');
  const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+env.SPROUT_DEVICE_TOKEN);
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new CareError(401,'Device authentication failed.');
}
function integer(value,min,max) {return Number.isSafeInteger(value)&&value>=min&&value<=max;}
export function validateTelemetry(value,deviceId) {
  if(!value||value.schema_version!==1||value.source!=='device'||value.device_id!==deviceId||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(value.boot_id??'')||
    !['sample_sequence','sample_age_ms','control_sequence','control_age_ms'].every(k=>integer(value[k],0,0xffffffff))||
    !['clock_synced','pump_outputs_enabled','manual_on_off','approved_watering'].every(k=>typeof value[k]==='boolean')||
    !integer(value.max_schedule_seconds,1,20)||!Array.isArray(value.plants)||value.plants.length!==3)
    throw new CareError(400,'Invalid plant telemetry.');
  if(new Set(value.plants.map(p=>p.id)).size!==3)throw new CareError(400,'Invalid plant channels.');
  for(const p of value.plants) {
    if(!integer(p.id,1,3)||!['chinese_bamboo','pandakaki','calathea'].includes(p.species)||
      !(p.soil_raw===null||integer(p.soil_raw,0,4095))||typeof p.calibrated!=='boolean'||
      !(p.soil_moisture_pct===null||(Number.isFinite(p.soil_moisture_pct)&&p.soil_moisture_pct>=0&&p.soil_moisture_pct<=100&&p.calibrated))||
      !(typeof p.pump_running==='boolean'||(!value.pump_outputs_enabled&&p.pump_running===null))||
      typeof p.schedule_enabled!=='boolean'||!integer(p.schedule_hour,0,23)||!integer(p.schedule_minute,0,59)||
      !integer(p.watering_seconds,1,20)||!integer(p.sensor_pin,0,48)||!integer(p.relay_pin,0,48)||
      !integer(p.cooldown_remaining_ms,0,60000)||!/^[a-zA-Z0-9_-]{1,96}$/.test(p.manual_token??'')||
      !Array.isArray(p.faults)||p.faults.length>8||p.faults.some(x=>typeof x!=='string'||!/^[a-z_]{1,64}$/.test(x)))
      throw new CareError(400,'Invalid plant readings.');
  }
  return structuredClone(value);
}

// A single paired prototype device. Only live commands are held in memory;
// schedules and settings are acknowledged after the ESP32 saves them in NVS.
// A restart drops pending commands, never replays an old ON, and requires a
// new device sync before accepting controls. The phone retains care history.
export function createDeviceRelay({env,now=Date.now,commandTimeout=6500}={}) {
  let latest=null,received=0;
  const commands=new Map();
  const fail=(status,message)=>({status,body:{error:message}});
  function finish(item,result) {
    if(item.result)return;
    item.result=result;clearTimeout(item.timer);item.resolve(result);
  }
  function prune() {
    for(const [id,item] of commands) {
      if(!item.result&&now()>=item.expires)finish(item,fail(504,'No confirmation from the ESP32. Check its status before trying again.'));
      if(now()-item.created>30000&&item.result)commands.delete(id);
    }
  }
  function fresh() {
    if(!latest||now()-received+latest.control_age_ms>5000)throw new CareError(503,'Your plant system is offline. Check its power and Internet Wi-Fi.');
    return latest;
  }
  function telemetry() {
    prune();const value=structuredClone(fresh()),age=Math.max(0,now()-received);
    value.sample_age_ms=Math.min(0xffffffff,value.sample_age_ms+age);
    value.control_age_ms=Math.min(0xffffffff,value.control_age_ms+age);
    value.transport='cloud';value.relay_age_ms=age;
    return value;
  }
  function sync(input) {
    prune();
    const value=validateTelemetry(input?.telemetry,env.SPROUT_DEVICE_ID);
    if(!integer(input.sent_at_ms,1735689600000,2145916799000)||!integer(input.snapshot_age_ms,0,30000)||
      input.sent_at_ms-now()>5000||now()-input.sent_at_ms>30000)throw new CareError(400,'Device time or telemetry freshness is invalid.');
    // Include time spent in TLS/DNS/upload and waiting in the device worker.
    // Receiving a delayed packet must never make an old reading fresh again.
    const transit=Math.max(0,now()-input.sent_at_ms)+input.snapshot_age_ms;
    value.sample_age_ms=Math.min(0xffffffff,value.sample_age_ms+transit);
    value.control_age_ms=Math.min(0xffffffff,value.control_age_ms+transit);
    if(!Array.isArray(input.acks)||input.acks.length>16||input.acks.some(a=>!idPattern.test(a.id??'')||
      !integer(a.status,200,599)||typeof a.error!=='string'||a.error.length>240))throw new CareError(400,'Invalid command confirmations.');
    if(latest&&latest.boot_id!==value.boot_id) {
      for(const item of commands.values())if(!item.result)finish(item,fail(409,'The plant system restarted. Refresh before controlling it.'));
    }
    latest=value;received=now();
    for(const ack of input.acks) {
      const item=commands.get(ack.id);
      if(item&&!item.result&&item.delivered&&item.boot===value.boot_id) {
        finish(item,ack.status===200?{status:200,body:{ok:true,confirmed_by:'device',command_id:item.id}}:
          fail(ack.status>=400?ack.status:409,ack.error||'The ESP32 rejected this request.'));
      }
    }
    const outgoing=[...commands.values()].filter(c=>!c.result&&!c.delivered&&c.boot===value.boot_id)
      .sort((a,b)=>Number(b.path==='/api/stop')-Number(a.path==='/api/stop')).slice(0,8);
    for(const item of outgoing)item.delivered=true; // At most once, including a lost sync response.
    return {commands:outgoing.map(c=>({id:c.id,boot_id:c.boot,path:c.path,fields:c.fields,expires:Math.floor(c.expires/1000)}))};
  }
  function command(input) {
    prune();
    if(!input||!idPattern.test(input.id??'')||!Object.hasOwn(fieldsByPath,input.path)||!input.fields||typeof input.fields!=='object'||Array.isArray(input.fields))
      throw new CareError(400,'Invalid plant command.');
    const fields=Object.fromEntries(Object.entries(input.fields).sort(([a],[b])=>a.localeCompare(b)));
    if(Object.keys(fields).length!==fieldsByPath[input.path].length||fieldsByPath[input.path].some(k=>typeof fields[k]!=='string'||fields[k].length>100)||
      Object.keys(fields).some(k=>!fieldsByPath[input.path].includes(k))||
      (input.path!=='/api/time'&&!/^[123]$/.test(fields.plant)))throw new CareError(400,'Invalid command fields.');
    const signature=JSON.stringify([input.boot_id,input.path,fields]);
    const duplicate=commands.get(input.id);
    if(duplicate) {
      if(duplicate.signature!==signature)throw new CareError(409,'Command identifier was already used.');
      return duplicate.promise;
    }
    const live=fresh();
    if(input.boot_id!==live.boot_id)throw new CareError(409,'The plant system restarted. Refresh before controlling it.');
    if(commands.size>=256)throw new CareError(429,'Too many requests. Wait before trying again.');
    if(input.path==='/api/stop') {
      for(const item of commands.values())if(!item.result&&item.fields.plant===fields.plant)
        finish(item,fail(409,'Watering request cancelled by Water Off.'));
    } else if([...commands.values()].filter(c=>!c.result).length>=12)throw new CareError(429,'Wait for the current device requests to finish.');
    const item={id:input.id,path:input.path,fields,boot:live.boot_id,signature,created:now(),expires:now()+commandTimeout,delivered:false};
    item.promise=new Promise(resolve=>{item.resolve=resolve;});
    item.timer=setTimeout(()=>finish(item,fail(504,'No confirmation from the ESP32. Check its status before trying again.')),commandTimeout);
    item.timer.unref?.();commands.set(item.id,item);
    return item.promise;
  }
  return {telemetry,sync,command,close(){for(const item of commands.values())finish(item,fail(503,'The plant service restarted. Refresh your connection.'));}};
}
