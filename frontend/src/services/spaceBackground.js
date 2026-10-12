import { SkyBox } from "cesium";
import { generateStars, populationQuality } from "../data/proceduralPopulations.js";

const FACES = ["positiveX","negativeX","positiveY","negativeY","positiveZ","negativeZ"];
export function starCubeDirection(face, u, v, result = new Float64Array(3)) {
  const axes = [[1,-v,-u],[-1,-v,u],[u,1,v],[u,-1,-v],[u,-v,1],[-u,-v,-1]];
  const direction = axes[face], length = Math.hypot(...direction);
  for (let n = 0; n < 3; n++) result[n] = direction[n] / length;
  return result;
}

export function galacticDensity(x, y, z) {
  const latitude = -.5267826876 * y + .85 * z;
  const longitude = Math.atan2(.85 * y + .5267826876 * z, x);
  const structure = .65 + .18 * Math.cos(longitude * 2 + .8) + .12 * Math.cos(longitude * 5 - 1.2);
  return Math.exp(-((latitude / .14) ** 2)) * structure + .22 * Math.exp(-((latitude / .4) ** 2));
}

function paintDensity(context, face, size) {
  // Low frequency, seam-consistent unit-sphere density, not a tiled wallpaper.
  const canvas = document.createElement("canvas"), resolution = 128;
  canvas.width = canvas.height = resolution;
  const coarse = canvas.getContext("2d"), pixels = coarse.createImageData(resolution, resolution);
  const direction = new Float64Array(3);
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    starCubeDirection(face, (x + .5) * 2 / resolution - 1, (y + .5) * 2 / resolution - 1, direction);
    const density = galacticDensity(...direction), offset = (y * resolution + x) * 4;
    pixels.data.set([1 + density * 4, 3 + density * 4, 9 + density * 6, 255], offset);
  }
  coarse.putImageData(pixels, 0, 0);
  context.drawImage(canvas, 0, 0, size, size);
}
export function starCubeProjection(x,y,z) {
  const ax=Math.abs(x), ay=Math.abs(y), az=Math.abs(z);
  if (ax >= ay && ax >= az) return x >= 0 ? [0,-z/ax,-y/ax] : [1,z/ax,-y/ax];
  if (ay >= az) return y >= 0 ? [2,x/ay,z/ay] : [3,x/ay,-z/ay];
  return z >= 0 ? [4,x/az,-y/az] : [5,-x/az,-y/az];
}

export function createSpaceBackground(quality, memoryGb = 8) {
  const profile=populationQuality(quality,memoryGb), size=profile === "performance" ? 256 : profile === "quality" ? 1024 : 512;
  const sources={}, contexts=[];
  for (const [index, face] of FACES.entries()) {
    const canvas=document.createElement("canvas"); canvas.width=size; canvas.height=size;
    const context=canvas.getContext("2d");
    if (!context) throw new Error("Star cube canvas unavailable");
    paintDensity(context,index,size);
    sources[face]=canvas; contexts.push(context);
  }
  const stars=generateStars();
  for (let i=0;i<stars.length;i+=5) {
    const [face,u,v]=starCubeProjection(stars[i],stars[i+1],stars[i+2]);
    const brightness=stars[i+3], warm=stars[i+4], context=contexts[face];
    const x=(u+1)*size/2,y=(v+1)*size/2;
    const radius=(.22+brightness*.56)*size/512;
    const intensity=Math.round(90+brightness*140);
    context.fillStyle=`rgba(${Math.round(intensity*(warm>.92 ? 1 : .91))},${Math.round(intensity*.96)},${Math.round(intensity*(warm<.08 ? 1.08 : 1))},${.40+brightness*.45})`;
    context.beginPath(); context.arc(x,y,Math.max(.35,radius),0,Math.PI*2); context.fill();
    if (brightness>.90) {
      const halo=context.createRadialGradient(x,y,0,x,y,radius*3);
      halo.addColorStop(0,"rgba(185,203,220,.10)"); halo.addColorStop(1,"rgba(185,203,220,0)");
      context.fillStyle=halo; context.fillRect(x-radius*3,y-radius*3,radius*6,radius*6);
    }
  }
  const background = new SkyBox({ sources });
  background.orbitwatchBackground = { profile, faceSize:size, stars:stars.length/5 };
  return background;
}
