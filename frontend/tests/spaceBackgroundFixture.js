import { createSpaceBackground } from "../src/services/spaceBackground.js";

export function createSpaceBackgroundForTest(run) {
  const previous=globalThis.document, canvases=[];
  globalThis.document={ createElement() {
    const canvas={width:0,height:0,getContext:()=>({
      createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),
      putImageData(){},drawImage(){},beginPath(){},arc(){},fill(){},fillRect(){},
      createRadialGradient:()=>({addColorStop(){}}),
    })}; canvases.push(canvas); return canvas;
  } };
  try { run(createSpaceBackground,canvases); } finally { globalThis.document=previous; }
}
