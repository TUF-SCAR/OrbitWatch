const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const DAY_MS = 86400000;

export const PLANETS = [
  { name: 'Mercury', color: '#9b948b', radius: 3.1, a:[0.38709927,0.00000037], e:[0.20563593,0.00001906], i:[7.00497902,-0.00594749], L:[252.25032350,149472.67411175], peri:[77.45779628,0.16047689], node:[48.33076593,-0.12534081] },
  { name: 'Venus', color: '#d8b77d', radius: 4.5, a:[0.72333566,0.00000390], e:[0.00677672,-0.00004107], i:[3.39467605,-0.00078890], L:[181.97909950,58517.81538729], peri:[131.60246718,0.00268329], node:[76.67984255,-0.27769418] },
  { name: 'Earth', color: '#55a9ff', radius: 5.1, a:[1.00000261,0.00000562], e:[0.01671123,-0.00004392], i:[-0.00001531,-0.01294668], L:[100.46457166,35999.37244981], peri:[102.93768193,0.32327364], node:[0,0] },
  { name: 'Mars', color: '#dc7a59', radius: 4.0, a:[1.52371034,0.00001847], e:[0.09339410,0.00007882], i:[1.84969142,-0.00813131], L:[-4.55343205,19140.30268499], peri:[-23.94362959,0.44441088], node:[49.55953891,-0.29257343] },
  { name: 'Jupiter', color: '#d7b08b', radius: 8.6, a:[5.20288700,-0.00011607], e:[0.04838624,-0.00013253], i:[1.30439695,-0.00183714], L:[34.39644051,3034.74612775], peri:[14.72847983,0.21252668], node:[100.47390909,0.20469106] },
  { name: 'Saturn', color: '#e0c98d', radius: 7.7, a:[9.53667594,-0.00125060], e:[0.05386179,-0.00050991], i:[2.48599187,0.00193609], L:[49.95424423,1222.49362201], peri:[92.59887831,-0.41897216], node:[113.66242448,-0.28867794], rings:true },
  { name: 'Uranus', color: '#8fd8df', radius: 6.2, a:[19.18916464,-0.00196176], e:[0.04725744,-0.00004397], i:[0.77263783,-0.00242939], L:[313.23810451,428.48202785], peri:[170.95427630,0.40805281], node:[74.01692503,0.04240589] },
  { name: 'Neptune', color: '#587ff2', radius: 6.0, a:[30.06992276,0.00026291], e:[0.00859048,0.00005105], i:[1.77004347,0.00035372], L:[-55.12002969,218.45945325], peri:[44.96476227,-0.32241464], node:[131.78422574,-0.00508664] },
];

export const MOONS = [
  {name:'Moon',parent:'Earth',a:384400,e:.0554,w:318.15,M:135.27,i:5.16,node:125.08,p:27.322,size:2.5,label:true},
  {name:'Phobos',parent:'Mars',a:9375,e:.015,w:216.3,M:189.7,i:1.1,node:169.2,p:.3187,size:1.25},
  {name:'Deimos',parent:'Mars',a:23457,e:0,w:0,M:205,i:1.8,node:54.3,p:1.2625,size:1.1},
  {name:'Io',parent:'Jupiter',a:421800,e:.004,w:49.1,M:330.9,i:0,node:0,p:1.762732,size:2.1,label:true},
  {name:'Europa',parent:'Jupiter',a:671100,e:.009,w:45,M:345.4,i:.5,node:184,p:3.525463,size:2,label:true},
  {name:'Ganymede',parent:'Jupiter',a:1070400,e:.001,w:198.3,M:324.8,i:.2,node:58.5,p:7.155588,size:2.35,label:true},
  {name:'Callisto',parent:'Jupiter',a:1882700,e:.007,w:43.8,M:87.4,i:.3,node:309.1,p:16.69044,size:2.2,label:true},
  {name:'Amalthea',parent:'Jupiter',a:181400,e:.003,w:180.1,M:310.6,i:.4,node:282.9,p:.499918,size:1.1},
  {name:'Mimas',parent:'Saturn',a:186000,e:.020,w:160.4,M:275.3,i:1.6,node:66.2,p:.942422,size:1.15},
  {name:'Enceladus',parent:'Saturn',a:238400,e:.005,w:119.5,M:57,i:0,node:0,p:1.370218,size:1.6,label:true},
  {name:'Tethys',parent:'Saturn',a:295000,e:.001,w:335.3,M:0,i:1.1,node:273,p:1.887802,size:1.55},
  {name:'Dione',parent:'Saturn',a:377700,e:.002,w:116,M:212,i:0,node:0,p:2.736916,size:1.55},
  {name:'Rhea',parent:'Saturn',a:527200,e:.001,w:44.3,M:31.5,i:.3,node:133.7,p:4.517503,size:1.75},
  {name:'Titan',parent:'Saturn',a:1221900,e:.029,w:78.3,M:11.7,i:.3,node:78.6,p:15.945448,size:2.45,label:true},
  {name:'Iapetus',parent:'Saturn',a:3561700,e:.028,w:254.5,M:74.8,i:7.6,node:86.5,p:79.331002,size:1.7,label:true},
  {name:'Miranda',parent:'Uranus',a:129846,e:.001,w:154.8,M:73,i:4.4,node:100.9,p:1.413479,size:1.25},
  {name:'Ariel',parent:'Uranus',a:190929,e:.001,w:9.6,M:193.5,i:0,node:0,p:2.520379,size:1.55,label:true},
  {name:'Umbriel',parent:'Uranus',a:265986,e:.004,w:183.4,M:253,i:.1,node:174.8,p:4.144177,size:1.5},
  {name:'Titania',parent:'Uranus',a:436298,e:.002,w:184,M:68.1,i:.1,node:29.5,p:8.705869,size:1.8,label:true},
  {name:'Oberon',parent:'Uranus',a:583511,e:.002,w:132.2,M:143.6,i:.1,node:76.8,p:13.463237,size:1.75,label:true},
  {name:'Triton',parent:'Neptune',a:354800,e:0,w:0,M:63,i:157.3,node:178.1,p:5.876994,size:2.1,label:true},
  {name:'Proteus',parent:'Neptune',a:117600,e:0,w:0,M:276.8,i:0,node:0,p:1.122315,size:1.3},
  {name:'Nereid',parent:'Neptune',a:5513900,e:.751,w:296.8,M:318.5,i:5.1,node:319.5,p:360.133039,size:1.3,label:true,epoch:2458849.5},
];

export const PLUTO_MOONS = [
  {name:'Charon',parent:'Pluto',a:19600,e:0,w:0,M:304.1,i:0,node:0,p:6.387222,size:2.0,label:true},
  {name:'Styx',parent:'Pluto',a:43200,e:.025,w:322.5,M:358.1,i:0,node:0,p:20.16,size:1.0},
  {name:'Nix',parent:'Pluto',a:49300,e:.015,w:31.4,M:338.2,i:0,node:0,p:24.85,size:1.2,label:true},
  {name:'Kerberos',parent:'Pluto',a:58300,e:.010,w:32.1,M:276.1,i:.4,node:314.3,p:32.17,size:1.0},
  {name:'Hydra',parent:'Pluto',a:65200,e:.009,w:139.3,M:335.0,i:.3,node:114.3,p:38.20,size:1.25,label:true},
];

export const SMALL_BODY_NAMES = ['Pluto','Ceres','Vesta','Pallas','Hygiea','Eris','Haumea','Makemake','Gonggong','Quaoar','Orcus','Sedna','Psyche','Eros','Bennu','Apophis','Ryugu','Arrokoth'];

export function julianDate(date = new Date()) { return date.getTime()/DAY_MS + 2440587.5; }
function mod360(v){ return ((v%360)+360)%360; }
function solveKepler(M,e){ let E=M; for(let n=0;n<12;n++){ const d=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E)); E-=d; if(Math.abs(d)<1e-10) break; } return E; }
function rotateOrbital(xp,yp,i,node,w){
  const I=i*DEG,O=node*DEG,W=w*DEG;
  const cO=Math.cos(O),sO=Math.sin(O),cI=Math.cos(I),sI=Math.sin(I),cW=Math.cos(W),sW=Math.sin(W);
  return {
    x:(cW*cO-sW*sO*cI)*xp+(-sW*cO-cW*sO*cI)*yp,
    y:(cW*sO+sW*cO*cI)*xp+(-sW*sO+cW*cO*cI)*yp,
    z:(sW*sI)*xp+(cW*sI)*yp,
  };
}

export function planetElements(planet,date=new Date()){
  const T=(julianDate(date)-J2000)/36525;
  return {a:planet.a[0]+planet.a[1]*T,e:planet.e[0]+planet.e[1]*T,i:planet.i[0]+planet.i[1]*T,L:planet.L[0]+planet.L[1]*T,peri:planet.peri[0]+planet.peri[1]*T,node:planet.node[0]+planet.node[1]*T};
}
export function planetPosition(planet,date=new Date()){
  const q=planetElements(planet,date), M=mod360(q.L-q.peri)*DEG, E=solveKepler(M,q.e);
  const xp=q.a*(Math.cos(E)-q.e), yp=q.a*Math.sqrt(1-q.e*q.e)*Math.sin(E);
  return rotateOrbital(xp,yp,q.i,q.node,q.peri-q.node);
}
export function planetOrbitPoints(planet,date=new Date(),steps=96){
  const q=planetElements(planet,date), pts=[];
  for(let k=0;k<=steps;k++){ const E=(k/steps)*Math.PI*2; const xp=q.a*(Math.cos(E)-q.e), yp=q.a*Math.sqrt(1-q.e*q.e)*Math.sin(E); pts.push(rotateOrbital(xp,yp,q.i,q.node,q.peri-q.node)); }
  return pts;
}
export function moonPosition(moon,date=new Date()){
  const epoch=moon.epoch ?? J2000;
  const days=julianDate(date)-epoch;
  const M=mod360(moon.M + 360*days/moon.p)*DEG, E=solveKepler(M,moon.e);
  const xp=moon.a*(Math.cos(E)-moon.e), yp=moon.a*Math.sqrt(1-moon.e*moon.e)*Math.sin(E);
  return rotateOrbital(xp,yp,moon.i,moon.node,moon.w);
}
export function smallBodyPosition(body,date=new Date()){
  const jd=julianDate(date); const M=mod360(body.ma + body.n*(jd-body.epoch))*DEG; const E=solveKepler(M,body.e);
  const xp=body.a*(Math.cos(E)-body.e), yp=body.a*Math.sqrt(1-body.e*body.e)*Math.sin(E);
  return rotateOrbital(xp,yp,body.i,body.om,body.w);
}
