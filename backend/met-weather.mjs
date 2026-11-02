const agent='Sprout-Plant-Care/3.1 (https://github.com/alhamadaniamir/Automated-IoT-Indoor-Plant-Monitoring-System-with-AI-assisted-Plant-Care)';
const daylight=entry=>{
  const symbol=entry?.data?.next_1_hours?.summary?.symbol_code??'';
  return symbol.endsWith('_day')?true:symbol.endsWith('_night')?false:null;
};
export async function metWeather(location,{get,now}) {
  const url=new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
  url.search=new URLSearchParams({lat:location.latitude.toFixed(4),lon:location.longitude.toFixed(4)}).toString();
  const data=await get(url,{'User-Agent':agent,Accept:'application/json'});
  const units=data.properties?.meta?.units;
  if (units?.air_temperature!=='celsius' || units?.relative_humidity!=='%' || units?.cloud_area_fraction!=='%') throw new Error('invalid_data');
  const series=data.properties?.timeseries;
  if (!Array.isArray(series) || !series.length) throw new Error('invalid_data');
  const issued=Date.parse(data.properties?.meta?.updated_at);
  if (!Number.isFinite(issued) || now-issued>6*3600000 || issued-now>3600000) throw new Error('stale_data');
  const candidates=series.filter(e=>Number.isFinite(Date.parse(e.time))).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const entry=candidates.filter(e=>Date.parse(e.time)<=now).at(-1)??candidates[0];
  if (!entry || Math.abs(now-Date.parse(entry.time))>3*3600000) throw new Error('stale_data');
  const current=entry.data?.instant?.details;
  if (!current || !Number.isFinite(current.air_temperature) ||
      !Number.isFinite(current.relative_humidity) || current.relative_humidity<0 || current.relative_humidity>100 ||
      !Number.isFinite(current.cloud_area_fraction) || current.cloud_area_fraction<0 || current.cloud_area_fraction>100) throw new Error('invalid_data');
  const hourly=candidates.filter(e=>Date.parse(e.time)>=now && Date.parse(e.time)<=now+12*3600000)
    .filter(e=>[e.data?.instant?.details?.air_temperature,e.data?.instant?.details?.relative_humidity,e.data?.instant?.details?.cloud_area_fraction].every(Number.isFinite))
    .map(e=>({time:e.time,temperature_c:e.data.instant.details.air_temperature,
      humidity_pct:e.data.instant.details.relative_humidity,cloud_cover_pct:e.data.instant.details.cloud_area_fraction,is_day:daylight(e)}));
  return {status:'available',source:'MET Norway',attribution:'MET Norway — CC BY 4.0',
    source_url:'https://www.met.no/',license_url:'https://creativecommons.org/licenses/by/4.0/',
    location:location.name,fetched_at:new Date(now).toISOString(),observed_at:new Date(entry.time).toISOString(),
    forecast_updated_at:new Date(issued).toISOString(),temperature_c:current.air_temperature,
    humidity_pct:current.relative_humidity,cloud_cover_pct:current.cloud_area_fraction,is_day:daylight(entry),
    daily:{},hourly,note:'Outdoor forecast context from MET Norway; not an indoor measurement. Daylight uses the forecast day/night symbol. Unprovided daily statistics and sunrise times must not be invented.'};
}
