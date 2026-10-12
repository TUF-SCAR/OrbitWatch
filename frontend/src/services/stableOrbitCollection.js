import { ArcType, Cartesian3, GeometryInstance, Matrix4, PolylineGeometry, PolylineMaterialAppearance, Primitive } from "cesium";

const RASTER_WIDTH = 4;

// PolylineCollection reuploads its entire vertex array when modelMatrix changes.
// A Primitive keeps geometry resident while its model matrix advances in time.
// Dimensionless vertices also avoid the high-bit RTE precision loss at AU scale.
export function normalizedOrbitGeometry(positions) {
  const scale = Math.max(1, ...positions.map(point => Cartesian3.magnitude(point)));
  return { scale, positions: positions.map(point => Cartesian3.divideByScalar(point, scale, new Cartesian3())) };
}

export class StableOrbitCollection {
  constructor() {
    this.modelMatrix = Matrix4.clone(Matrix4.IDENTITY);
    this.show = true;
    this.lines = [];
    this.destroyed = false;
  }
  get length() { return this.lines.length; }
  get(index) { return this.lines[index]; }
  add(options) {
    const line = { show: true, width: 2.5, ...options, primitive: null, geometryRevision: 0 };
    this.lines.push(line);
    return line;
  }
  remove(line) {
    const index = this.lines.indexOf(line);
    if (index < 0) return false;
    line.primitive?.destroy();
    line.material.destroy();
    this.lines.splice(index, 1);
    return true;
  }
  update(frameState) {
    if (!this.show) return;
    for (const line of this.lines) {
      if (!line.show) { if (line.primitive) line.primitive.show = false; continue; }
      if (line.uploadedPositions !== line.positions) {
        const normalized = normalizedOrbitGeometry(line.positions);
        const next = new Primitive({ geometryInstances: new GeometryInstance({
          id: line.id, geometry: new PolylineGeometry({ positions: normalized.positions, width: RASTER_WIDTH,
            arcType: ArcType.NONE, vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT }),
        }), appearance: new PolylineMaterialAppearance({ material: line.material,
          renderState: { depthTest: { enabled: true }, depthMask: false, cull: { enabled: false } },
        }), asynchronous: false, allowPicking: line.pickable ?? false, compressVertices: false });
        line.primitive?.destroy();
        line.primitive = next;
        line.scale = normalized.scale;
        line.uploadedPositions = line.positions;
        line.geometryRevision++;
        next.orbitwatchOrbit = { id: line.id?.id, revision: line.geometryRevision };
      }
      const primitive = line.primitive;
      primitive.show = true;
      Matrix4.multiplyByUniformScale(line.modelMatrix || this.modelMatrix, line.scale, primitive.modelMatrix);
      // Keep the padded quad immutable. Selection/LOD affect uniforms only.
      line.material.uniforms.glowPower = (line.width + 0.5) * (line.core ?? 0.45) / (RASTER_WIDTH + 0.5);
      primitive.update(frameState);
    }
  }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    for (const line of [...this.lines]) this.remove(line);
    this.destroyed = true;
  }
}
