import {CareError} from './care.mjs';

const forecasts=new Map();
async function json(url,fetchImpl) {
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('weather service unavailable');
  return response.json();
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
export async function weather(location,{fetchImpl=fetch,now=Date.now()}={}) {
  const key=location.latitude.toFixed(3)+','+location.longitude.toFixed(3);
  const saved=forecasts.get(key);
  if (saved && now-saved.time<30*60*1000 && now-Date.parse(saved.value.observed_at)<=3*60*60*1000) return saved.value;
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.search=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),
    current:'temperature_2m,relative_humidity_2m,cloud_cover,is_day',
    daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',forecast_days:'2',timezone:'auto'}).toString();
  try {
    const data=await json(url,fetchImpl);
    const c=data.current;
    if (!c || !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.relative_humidity_2m) ||
        !Number.isFinite(c.cloud_cover) || c.relative_humidity_2m<0 || c.relative_humidity_2m>100 || c.cloud_cover<0 || c.cloud_cover>100 || ![0,1].includes(c.is_day)) throw new Error('invalid weather');
    // API timestamps are local to the returned timezone; use the response offset.
    const measuredAt=Date.parse(c.time+'Z')-(data.utc_offset_seconds??0)*1000;
    if (!Number.isFinite(measuredAt) || Math.abs(now-measuredAt)>3*60*60*1000) throw new Error('stale weather');
    const value={status:'available',source:'Open-Meteo',location:location.name,
      fetched_at:new Date(now).toISOString(),observed_at:new Date(measuredAt).toISOString(),
      temperature_c:c.temperature_2m,humidity_pct:c.relative_humidity_2m,cloud_cover_pct:c.cloud_cover,
      is_day:c.is_day===1,daily:data.daily??{},note:'Outdoor weather context; not measured indoor conditions.'};
    forecasts.set(key,{time:now,value});
    if (forecasts.size>100) forecasts.delete(forecasts.keys().next().value);
    return value;
  } catch {
    return {status:'unavailable',source:'Open-Meteo',location:location.name,fetched_at:new Date(now).toISOString(),
      note:'Weather could not be verified. Do not invent weather measurements.'};
  }
}
