// Marching squares on node values. Missing cells are never bridged; horizontal
// edge identities wrap so stitching remains topological at the antimeridian.
export function splitAntimeridian(points){
  if(points.length<2)return [];
  const paths=[];let path=[points[0]];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(Math.abs(b[0]-a[0])>180){
      const adjusted=b[0]+(b[0]<a[0]?360:-360),boundary=b[0]<a[0]?180:-180;
      const latitude=a[1]+(b[1]-a[1])*(boundary-a[0])/(adjusted-a[0]);
      path.push([boundary,latitude]);if(path.length>1)paths.push(path);
      path=[[-boundary,latitude],b];
    }else path.push(b);
  }
  if(path.length>1)paths.push(path);
  return paths;
}

export function pressureContours(field,{interval=4,wrap=true}={}){
  const {width,height,west,north,step}=field.grid,values=field.values;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||!Number.isFinite(step)||step<=0||
    !Number.isFinite(west)||!Number.isFinite(north)||values?.length!==width*height||!Number.isFinite(interval)||interval<=0)throw Error('Invalid pressure contour grid');
  let minimum=Infinity,maximum=-Infinity;
  for(const value of values)if(Number.isFinite(value)){minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}
  if(minimum===maximum||!Number.isFinite(minimum))return [];
  const contours=[],columns=wrap?width:width-1;
  for(let level=Math.ceil(Math.max(800,minimum)/interval)*interval;level<=Math.min(1200,maximum);level+=interval){
    const nodes=new Map(),edges=[],links=new Map();
    const node=(key,x,y)=>{
      if(!nodes.has(key))nodes.set(key,[((west+x*step+180)%360+360)%360-180,north-y*step]);
      return key;
    };
    const link=(a,b,middle=[])=>{
      const index=edges.length;edges.push([a,b,middle]);
      for(const key of [a,b]){if(!links.has(key))links.set(key,[]);links.get(key).push(index);}
    };
    for(let y=0;y<height-1;y++)for(let x=0;x<columns;x++){
      const next=(x+1)%width,a=values[y*width+x],b=values[y*width+next],c=values[(y+1)*width+next],d=values[(y+1)*width+x];
      if(![a,b,c,d].every(Number.isFinite))continue;
      const crosses=[];
      if((a>level)!==(b>level))crosses.push(node(`h:${y}:${x}`,x+(level-a)/(b-a),y));
      if((b>level)!==(c>level))crosses.push(node(`v:${y}:${next}`,x+1,y+(level-b)/(c-b)));
      if((d>level)!==(c>level))crosses.push(node(`h:${y+1}:${x}`,x+(level-d)/(c-d),y+1));
      if((a>level)!==(d>level))crosses.push(node(`v:${y}:${x}`,x,y+(level-a)/(d-a)));
      const connect=(first,last)=>{
        const middle=[],cross=a-b+c-d;
        if(Math.abs(cross)>1e-8){
          const local=key=>{const [lon,lat]=nodes.get(key);return [((lon-west-x*step)%360+360)%360/step,(north-y*step-lat)/step];};
          const start=local(first),end=local(last),horizontal=Math.abs(end[0]-start[0])>=Math.abs(end[1]-start[1]);
          for(const fraction of [1/3,2/3]){
            let px=start[0]+(end[0]-start[0])*fraction,py=start[1]+(end[1]-start[1])*fraction;
            // Samples on the actual bilinear isosurface, not an unconstrained
            // spline that could shift an isobar away from its pressure value.
            const denominator=horizontal?d-a+cross*px:b-a+cross*py;
            if(Math.abs(denominator)<1e-10)continue;
            if(horizontal)py=(level-a-(b-a)*px)/denominator;
            else px=(level-a-(d-a)*py)/denominator;
            if(px<0||px>1||py<0||py>1)continue;
            middle.push([((west+(x+px)*step+180)%360+360)%360-180,north-(y+py)*step]);
          }
        }
        link(first,last,middle);
      };
      if(crosses.length===2)connect(...crosses);
      else if(crosses.length===4){
        // Bilinear asymptotic decider, including a deterministic exact saddle.
        const q=(a-level)*(c-level)-(b-level)*(d-level);
        for(const [i,j] of q>=0?[[0,1],[2,3]]:[[0,3],[1,2]])connect(crosses[i],crosses[j]);
      }
    }
    const used=new Uint8Array(edges.length);
    const trace=start=>{
      const points=[nodes.get(start)];let current=start;
      while(true){
        const edge=links.get(current).find(index=>!used[index]);if(edge===undefined)break;
        used[edge]=1;const [a,b,middle]=edges[edge],forward=current===a;
        points.push(...(forward?middle:[...middle].reverse()));current=forward?b:a;points.push(nodes.get(current));
        if(current===start)break;
      }
      for(const path of splitAntimeridian(points)){
        const clean=path.filter((point,index)=>index===0||Math.hypot(point[0]-path[index-1][0],point[1]-path[index-1][1])>1e-9);
        if(clean.length>1)contours.push({level,points:clean});
      }
    };
    for(const [key,adjacent] of links)if(adjacent.length===1&&!used[adjacent[0]])trace(key);
    for(let i=0;i<edges.length;i++)if(!used[i])trace(edges[i][0]);
  }
  return contours;
}

export function pressureExtrema(field,{radius=3,prominence=1,limit=24}={}){
  const {width,height,west,north,step}=field.grid,values=field.values,candidates=[];
  for(let y=radius;y<height-radius;y++){
    const latitude=north-y*step;if(Math.abs(latitude)>80)continue;
    for(let x=0;x<width;x++){
      const center=values[y*width+x];if(!Number.isFinite(center))continue;
      let high=true,low=true,valid=true,drop=0,rise=0,strictHigh=true,strictLow=true;
      for(let dy=-radius;dy<=radius&&valid;dy++)for(let dx=-radius;dx<=radius;dx++){
        if(!dx&&!dy)continue;
        const value=values[(y+dy)*width+((x+dx)%width+width)%width];
        if(!Number.isFinite(value)){valid=false;break;}
        high&&=center>=value;low&&=center<=value;
        if(Math.max(Math.abs(dx),Math.abs(dy))===1){strictHigh&&=center>value;strictLow&&=center<value;}
        if(Math.max(Math.abs(dx),Math.abs(dy))===radius){drop=Math.max(drop,center-value);rise=Math.max(rise,value-center);}
      }
      const type=valid&&high&&strictHigh&&drop>=prominence?'H':valid&&low&&strictLow&&rise>=prominence?'L':null;
      if(type)candidates.push({type,value:center,longitude:west+x*step,latitude,prominence:type==='H'?drop:rise});
    }
  }
  candidates.sort((a,b)=>b.prominence-a.prominence||a.latitude-b.latitude||a.longitude-b.longitude);
  const accepted=[];
  for(const candidate of candidates){
    if(accepted.some(other=>Math.hypot(Math.min(Math.abs(candidate.longitude-other.longitude),360-Math.abs(candidate.longitude-other.longitude))*Math.cos(candidate.latitude*Math.PI/180),candidate.latitude-other.latitude)<8))continue;
    accepted.push(candidate);if(accepted.length===limit)break;
  }
  return accepted;
}

export const pressureInterval=height=>height>14e6?16:height>8e6?8:4;
export function selectPressureLabels(candidates,width,height,limit=48){
  const accepted=[];
  for(const candidate of candidates){
    const half=candidate.type?26:24,vertical=candidate.type?25:13;
    const {x,y}=candidate;
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<half+12||x>width-half-12||y<vertical+12||y>height-vertical-12)continue;
    if(accepted.some(other=>Math.abs(x-other.x)<half+other.half+28&&Math.abs(y-other.y)<vertical+other.vertical+20))continue;
    accepted.push({...candidate,half,vertical});if(accepted.length===limit)break;
  }
  return accepted;
}
