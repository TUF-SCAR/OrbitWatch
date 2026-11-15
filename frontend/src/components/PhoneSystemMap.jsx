import {CELESTIAL_BODIES} from '../data/celestialBodies.js';

const planets=[['mercury',38,-20],['venus',57,46],['earth',80,130],['mars',104,203],['jupiter',129,276],['saturn',151,335],['uranus',173,66],['neptune',197,153]];
export default function PhoneSystemMap({systemId,activeBodyId,onSelect,onBrowse,onBack}){
 const moons=Object.values(CELESTIAL_BODIES).filter(b=>b.type==='Moon'&&b.parent===systemId);
 const bodies=systemId?moons.map((b,i)=>[b.id,65+i*125/Math.max(1,moons.length-1),i*360/moons.length-90]):planets;
 const parent=CELESTIAL_BODIES[systemId||'sun'];
 const dot=(id,x,y,size=7)=>{const b=CELESTIAL_BODIES[id];return <g key={id} role="button" tabIndex="0" aria-label={`Visit ${b.name}`} aria-pressed={activeBodyId===id} onClick={()=>onBrowse(id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onBrowse(id);}}}>
  <circle className="planet-hit" cx={x} cy={y} r="22" fill="transparent"/>
  <circle className="planet-dot" cx={x} cy={y} r={size} fill={b.color} stroke={activeBodyId===id?'#c0f4ff':'#071019'} strokeWidth="2"/>
  <text x={x+(id===parent.id?-16:x>145?-12:12)} y={id===parent.id?6:y-10} textAnchor={id===parent.id||x>145?'end':'start'}>{b.name}</text>
 </g>;};
 return <div className="phone-system-diagram">
  {systemId&&<div className="phone-system-links"><button onClick={onBack}>← Solar System</button><button onClick={()=>onSelect(systemId)}>Visit {parent.name}</button></div>}
  <svg viewBox="-250 -245 500 490" preserveAspectRatio="xMidYMid meet" aria-label={systemId?`${parent.name} moons schematic`:'Solar System schematic'}>
   {bodies.map(([id,r])=><circle key={id} cx="0" cy="0" r={r} fill="none" stroke={CELESTIAL_BODIES[id].orbitColor||'#294453'} strokeWidth="1"/>)}
   {dot(parent.id,0,0,11)}
   {bodies.map(([id,r,deg])=>dot(id,Math.cos(deg*Math.PI/180)*r,Math.sin(deg*Math.PI/180)*r))}
  </svg><p>Schematic · sizes and spacing not to scale.</p>
 </div>;
}
