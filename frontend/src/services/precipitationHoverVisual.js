// Original vector weather symbols: consistent shapes/colour on every OS,
// without platform emoji fonts or external icon/image requests.
const sun='<circle cx="8" cy="8" r="3" fill="#ffdc45"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5 13 13M3 13l1.5-1.5M11.5 4.5 13 3" stroke="#ffdc45" stroke-width="1.5" stroke-linecap="round"/>';
const cloud=color=>`<path d="M6 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 16 6a4.5 4.5 0 0 1 1 9Z" fill="${color}"/>`;
const drops=count=>Array.from({length:count},(_,i)=>`<path d="m${6+i*3.3} 18-1 2.5" stroke="#a7d9ff" stroke-width="1.6" stroke-linecap="round"/>`).join('');
const flakes=count=>Array.from({length:count},(_,i)=>{const x=6+i*5;return `<path d="M${x} 17v5m-2-3.8 4 2.6m-4 0 4-2.6" stroke="#a5edf6" stroke-width="1.1" stroke-linecap="round"/>`;}).join('');
const symbols={sun,moon:'<path d="M16 3A9 9 0 1 0 21 17 8 8 0 0 1 16 3Z" fill="#e7eefa"/>',cloud:cloud('#f5f8fc'),partly:sun+cloud('#f5f8fc'),showers:sun+cloud('#b1dcff')+drops(2),drop:'<path d="M12 2S5 11 5 15a7 7 0 0 0 14 0C19 11 12 2 12 2Z" fill="#acd9ff"/>'};
symbols.freezing_rain=cloud('#d4baff')+drops(2)+'<path d="m17 17 2 2-2 2-2-2Z" fill="#e7d5ff"/>';
symbols.ice_pellets=cloud('#a2f3d2')+'<path d="m7 18 2 2-2 2-2-2Zm8 0 2 2-2 2-2-2Z" fill="#a2f3d2"/>';
symbols.mixed=cloud('#eec1e9')+drops(1)+flakes(2);
for(const [intensity,count] of [['light',2],['moderate',3],['heavy',4]]){
  symbols[`rain-${intensity}`]=cloud('#acd9ff')+drops(count);
  symbols[`snow-${intensity}`]=cloud('#b9f4fa')+flakes(Math.min(count,3));
}
const icons=Object.fromEntries(Object.entries(symbols).map(([key,body])=>[key,`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`)}")`]));

export function precipitationAppearance(condition){
  const intensity=condition.title.startsWith('Heavy')?'heavy':condition.title.startsWith('Moderate')?'moderate':'light';
  const color=condition.kind==='dry'?'#f5f7fa':condition.kind==='snow'?{light:'#baf4f8',moderate:'#9feaf5',heavy:'#80dff4'}[intensity]:{light:'#a8d5fa',moderate:'#efc4e5',heavy:'#fff2a6'}[intensity];
  const icon=condition.kind==='snow'?`snow-${intensity}`:condition.kind==='rain'?(condition.title==='Sunshine & Showers'?'showers':`rain-${intensity}`):condition.kind!=='dry'?'drop':condition.title.includes('Sunny')?'sun':condition.title.includes('Clear')?(condition.light==='night'?'moon':null):condition.title==='Partly Cloudy'?(condition.light==='day'?'partly':'cloud'):condition.title==='Cloudy'?'cloud':null;
  const phaseIcon=['freezing_rain','ice_pellets','mixed'].includes(condition.kind)?condition.kind:icon;
  const phaseColor=({freezing_rain:'#d4baff',ice_pellets:'#a2f3d2',mixed:'#eec1e9'})[condition.kind]||color;
  return {color:phaseColor,icon:phaseIcon,image:phaseIcon?icons[phaseIcon]:null};
}

export function renderPrecipitationHover(bubble,reading,doc){
  const appearance=precipitationAppearance(reading),primary=doc.createElement('span'),title=doc.createElement('span');
  primary.className='weather-hover__condition';title.textContent=reading.title;
  if(appearance.image){
    const icon=doc.createElement('span');icon.className='weather-hover__icon';icon.setAttribute('aria-hidden','true');
    icon.style.setProperty('background-image',appearance.image);primary.append(icon);
  }
  primary.append(title);
  const children=[primary];
  if(reading.secondary){const secondary=doc.createElement('span');secondary.className='weather-hover__forecast';secondary.textContent=reading.secondary;children.push(secondary);}
  bubble.replaceChildren(...children);
  bubble.style.setProperty('--precipitation-foreground',appearance.color);
}
