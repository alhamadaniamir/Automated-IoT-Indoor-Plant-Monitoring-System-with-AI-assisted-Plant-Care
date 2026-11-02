import {CareError} from './care.mjs';
import {metWeather} from './met-weather.mjs';

const forecasts=new Map();
const primaryCooldown=new WeakMap();
class WeatherSourceError extends Error {
  constructor(code) { super(code); this.code=code; }
}
export function validateWeatherLocation(location) {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      Math.abs(location.latitude)>90 || Math.abs(location.longitude)>180 ||
      typeof location.name!=='string' || !location.name.trim() || location.name.length>200)
    throw new CareError(400,'Choose a valid weather location.');
  return location;
}
async function json(url,fetchImpl,headers) {
  let response;
  try { response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),...(headers?{headers}:{})}); }
  catch (error) { throw new WeatherSourceError(error?.name==='TimeoutError' || error?.name==='AbortError' ? 'timeout' : 'network_error'); }
  if (!response.ok) throw new WeatherSourceError('http_'+response.status);
  try { return await response.json(); }
  catch { throw new WeatherSourceError('invalid_response'); }
}
export async function locations(query,{fetchImpl=fetch}={}) {
  if (typeof query!=='string' || query.trim().length<2 || query.length>100) throw new CareError(400,'Enter a city name.');
  const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search=new URLSearchParams({name:query.trim(),count:'8',language:'en',format:'json'}).toString();
  try {
    const data=await json(url,fetchImpl);
    return (data.results??[]).map(r=>({name:[r.name,r.admin1,r.country].filter(Boolean).join(', '),latitude:r.latitude,longitude:r.longitude,timezone:r.timezone}));
  } catch { throw new CareError(503,'Weather location search is unavailable. Try again later.'); }
}
export async function weather(location,{fetchImpl=fetch,now=Date.now(),allowFallback=true}={}) {
  validateWeatherLocation(location);
  const key=location.latitude.toFixed(3)+','+location.longitude.toFixed(3);
  const saved=forecasts.get(key);
  if (saved && now-saved.time<30*60*1000 && now-Date.parse(saved.value.observed_at)<=3*60*60*1000) return saved.value;
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.search=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),
    current:'temperature_2m,relative_humidity_2m,cloud_cover,is_day',
    daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',forecast_days:'2',timezone:'auto'}).toString();
  try {
    if ((primaryCooldown.get(fetchImpl)??0)>now) throw new WeatherSourceError('http_429');
    const data=await json(url,fetchImpl);
    const c=data.current;
    if (!c || !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.relative_humidity_2m) ||
        !Number.isFinite(c.cloud_cover) || c.relative_humidity_2m<0 || c.relative_humidity_2m>100 || c.cloud_cover<0 || c.cloud_cover>100 || ![0,1].includes(c.is_day)) throw new WeatherSourceError('invalid_data');
    // API timestamps are local to the returned timezone; use the response offset.
    const measuredAt=Date.parse(c.time+'Z')-(data.utc_offset_seconds??0)*1000;
    if (!Number.isFinite(measuredAt) || Math.abs(now-measuredAt)>3*60*60*1000) throw new WeatherSourceError('stale_data');
    const value={status:'available',source:'Open-Meteo',location:location.name,
      fetched_at:new Date(now).toISOString(),observed_at:new Date(measuredAt).toISOString(),
      temperature_c:c.temperature_2m,humidity_pct:c.relative_humidity_2m,cloud_cover_pct:c.cloud_cover,
      is_day:c.is_day===1,daily:data.daily??{},note:'Outdoor weather context; not measured indoor conditions.'};
    forecasts.set(key,{time:now,value});
    if (forecasts.size>100) forecasts.delete(forecasts.keys().next().value);
    return value;
  } catch (error) {
    const failure=error instanceof WeatherSourceError?error.code:'invalid_data';
    if (failure==='http_429') primaryCooldown.set(fetchImpl,now+15*60000);
    let backupFailure;
    if (allowFallback) {
      try {
        const value=await metWeather(location,{now,get:(address,headers)=>json(address,fetchImpl,headers)});
        value.fallback_from='Open-Meteo';value.primary_failure_reason=failure;
        forecasts.set(key,{time:now,value});
        if (forecasts.size>100) forecasts.delete(forecasts.keys().next().value);
        return value;
      } catch (backup) {
        backupFailure=backup instanceof WeatherSourceError?backup.code:
          ['invalid_data','stale_data'].includes(backup.message)?backup.message:'invalid_data';
      }
    }
    return {status:'unavailable',source:'Open-Meteo',location:location.name,fetched_at:new Date(now).toISOString(),
      failure_reason:failure,...(backupFailure?{fallback_source:'MET Norway',fallback_failure_reason:backupFailure}:{}),
      note:'Weather could not be verified. Do not invent weather measurements.'};
  }
}
