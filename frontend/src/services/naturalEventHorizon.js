import { Cartesian3, Cartesian4, Matrix4 } from 'cesium';

const RIM_STEPS = 384;
const rim = Array.from({ length: RIM_STEPS }, (_, index) => {
  const angle = index / RIM_STEPS * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
});
const frustumEdges = [p => p.w - 1e-6, p => p.w + p.x, p => p.w - p.x, p => p.w + p.y, p => p.w - p.y];

function clipEdge(vertices, signedDistance) {
  const clipped = [];
  let previous = vertices.at(-1);
  if (!previous) return clipped;
  let before = signedDistance(previous);
  for (const vertex of vertices) {
    const after = signedDistance(vertex);
    if ((before >= 0) !== (after >= 0)) clipped.push(Cartesian4.lerp(previous, vertex, before / (before - after), new Cartesian4()));
    if (after >= 0) clipped.push(vertex);
    previous = vertex;
    before = after;
  }
  return clipped;
}

// On the scaled unit sphere the tangent points form a circle in the plane
// dot(camera, surfacePoint) = 1. Project its conic through the actual frustum
// and clip in homogeneous space before dividing by w, including close views.
export function globeSilhouette(camera, ellipsoid, width, height) {
  const eye = ellipsoid.transformPositionToScaledSpace(camera.positionWC);
  const distance = Cartesian3.magnitude(eye);
  if (distance <= 1 || !camera.viewMatrix || !camera.frustum.projectionMatrix) return null;
  const facing = Cartesian3.divideByScalar(eye, distance, new Cartesian3());
  const axis = Cartesian3.mostOrthogonalAxis(facing, new Cartesian3());
  const east = Cartesian3.normalize(Cartesian3.cross(facing, axis, new Cartesian3()), new Cartesian3());
  const north = Cartesian3.cross(facing, east, new Cartesian3());
  const horizon = 1 / distance;
  const radius = Math.sqrt(1 - horizon ** 2);
  const center = Cartesian3.multiplyByScalar(facing, horizon, new Cartesian3());
  const { x: rx, y: ry, z: rz } = ellipsoid.radii;
  const matrix = Matrix4.multiply(camera.frustum.projectionMatrix, camera.viewMatrix, new Matrix4());
  const world = new Cartesian4(0, 0, 0, 1);
  const projected = rim.map(([cos, sin]) => {
    world.x = rx * (center.x + radius * (east.x * cos + north.x * sin));
    world.y = ry * (center.y + radius * (east.y * cos + north.y * sin));
    world.z = rz * (center.z + radius * (east.z * cos + north.z * sin));
    return Matrix4.multiplyByVector(matrix, world, new Cartesian4());
  });
  const polygon = frustumEdges.reduce(clipEdge, projected).map(p => ({ x: (1 + p.x / p.w) * width / 2, y: (1 - p.y / p.w) * height / 2 }));
  const scaled = new Cartesian3();
  return {
    polygon,
    depth(point) {
      return Cartesian3.dot(facing, ellipsoid.transformPositionToScaledSpace(point, scaled)) - horizon;
    },
  };
}

export function pointInsideSilhouette(polygon, x, y) {
  let inside = false;
  let previous = polygon.at(-1);
  for (const next of polygon) {
    if ((previous.y > y) !== (next.y > y) && x < (next.x - previous.x) * (y - previous.y) / (next.y - previous.y) + previous.x) inside = !inside;
    previous = next;
  }
  return inside;
}
