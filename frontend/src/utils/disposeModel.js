// Models loaded for an inspector own their textures. Texture.dispose releases
// GPU storage, but ImageBitmap-backed glTF images also need explicit closing.
export function disposeModel(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    const data = texture.source?.data;
    for (const image of Array.isArray(data) ? data : [data]) if (typeof image?.close === "function") images.add(image);
    texture.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const image of images) image.close();
}
