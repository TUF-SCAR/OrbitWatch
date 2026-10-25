import { Buffer, BufferUsage, VertexArray, ComponentDatatype, ShaderProgram, DrawCommand, RenderState, BlendingState, Pass, PrimitiveType, BoundingSphere, Cartesian3 } from 'cesium';
import { WIND_STYLE } from './windConfig.js';

// One instanced, depth-tested draw; persistent buffers, no entities or per-frame materials.
const vertexShaderSource = `
in vec2 corner;
in vec3 startPosition;
in vec3 endPosition;
in vec2 opacity;
uniform float strokeWidth;
out vec2 v_stroke;
out float v_alpha;
out float v_night;
void main() {
  vec4 a = czm_projection * vec4(czm_viewRotation * (startPosition - czm_viewerPositionWC), 1.0);
  vec4 b = czm_projection * vec4(czm_viewRotation * (endPosition - czm_viewerPositionWC), 1.0);
  vec2 delta = (b.xy / b.w - a.xy / a.w) * czm_viewport.zw;
  vec2 normal = vec2(-delta.y, delta.x) / max(length(delta), .001);
  vec4 p = mix(a, b, corner.x);
  p.xy += normal * corner.y * (strokeWidth + 1.0) * czm_pixelRatio / czm_viewport.zw * p.w;
  gl_Position = p;
  v_stroke = vec2(corner.y, strokeWidth);
  v_alpha = mix(opacity.x, opacity.y, corner.x);
  if (a.w <= 0.0 || b.w <= 0.0) v_alpha = 0.0;
  v_night = 1.0 - smoothstep(-.15, .15, dot(normalize(mix(startPosition, endPosition, corner.x)), czm_sunDirectionWC));
  czm_vertexLogDepth();
}`;
const fragmentShaderSource = `
in vec2 v_stroke;
in float v_alpha;
in float v_night;
uniform float brightness;
uniform float nightGlow;
void main() {
  float coverage = 1.0 - smoothstep(v_stroke.y / (v_stroke.y + 1.0), 1.0, abs(v_stroke.x));
  out_FragColor = vec4(.82, .95, .96, v_alpha * coverage * (brightness + nightGlow * v_night));
  czm_writeLogDepth();
}`;
export class WindPrimitive {
  constructor(capacity) {
    this.data = new Float32Array(capacity * 8); this.count = 0; this.dirty = true;
    this.show = true; this.destroyed = false; this.alpha = 1;
  }
  update(frameState) {
    if (!this.show || !this.count || !frameState.passes.render) return;
    if (!this.command) {
      const context = frameState.context;
      this.buffer = Buffer.createVertexBuffer({ context, sizeInBytes: this.data.byteLength, usage: BufferUsage.DYNAMIC_DRAW });
      const corners = Buffer.createVertexBuffer({context,typedArray:new Float32Array([0,-1,1,-1,1,1,0,-1,1,1,0,1]),usage:BufferUsage.STATIC_DRAW});
      this.va = new VertexArray({ context, attributes: [
        {index:0,vertexBuffer:corners,componentsPerAttribute:2,componentDatatype:ComponentDatatype.FLOAT},
        ...[3,3,2].map((size,i)=>({index:i+1,vertexBuffer:this.buffer,componentsPerAttribute:size,componentDatatype:ComponentDatatype.FLOAT,strideInBytes:32,offsetInBytes:[0,12,24][i],instanceDivisor:1})),
      ] });
      this.shader = ShaderProgram.fromCache({context,vertexShaderSource,fragmentShaderSource,attributeLocations:{corner:0,startPosition:1,endPosition:2,opacity:3}});
      this.command = new DrawCommand({owner:this,vertexArray:this.va,shaderProgram:this.shader,primitiveType:PrimitiveType.TRIANGLES,count:6,
        boundingVolume:new BoundingSphere(Cartesian3.ZERO,6400000),pass:Pass.TRANSLUCENT,
        renderState:RenderState.fromCache({depthTest:{enabled:true},depthMask:false,blending:BlendingState.ALPHA_BLEND,cull:{enabled:false}}),
        uniformMap:{strokeWidth:()=>WIND_STYLE.thickness,brightness:()=>WIND_STYLE.brightness*this.alpha,nightGlow:()=>WIND_STYLE.nightGlow*this.alpha},
      });
    }
    if (this.dirty) { this.buffer.copyFromArrayView(this.data.subarray(0,this.count*8)); this.dirty = false; }
    this.command.instanceCount = this.count; frameState.commandList.push(this.command);
  }
  isDestroyed() { return this.destroyed; }
  destroy() { if(this.destroyed)return; this.va?.destroy(); this.shader?.destroy(); this.command=null;this.destroyed=true; }
}
