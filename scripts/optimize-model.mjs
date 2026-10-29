// 模型壓縮：移除重複零件 → 去重 → 焊接頂點 → 貼圖轉 WebP → 量化 + meshopt 幾何壓縮
// 用法：npm run optimize:model（來源固定讀 assets/source 的原始備份，可重複執行）
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const SRC = 'assets/source/f1-car.original.glb';
const OUT = 'public/models/f1-car.glb';
// 跟 src/config.js 的 model.hideNodes 相同：動態模糊輪圈、低精度座艙、另一組安全帶
const HIDE = /^(RIM_BLUR_|COCKPIT_LR$|CINTURE_ON$)/;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(SRC);
const root = doc.getRoot();

// 1) 移除重複版本的節點（連同子節點）
const disposeTree = (node) => {
  node.listChildren().forEach(disposeTree);
  node.dispose();
};
let removed = 0;
for (const node of root.listNodes()) {
  if (!node.isDisposed() && HIDE.test(node.getName())) {
    disposeTree(node);
    removed++;
  }
}

// 2) 壓縮
await doc.transform(
  dedup(),
  prune(),
  weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

await io.write(OUT, doc);

const mb = (f) => (fs.statSync(f).size / 1e6).toFixed(2);
console.log(`移除 ${removed} 個重複節點`);
console.log(`${SRC}  ${mb(SRC)} MB  →  ${OUT}  ${mb(OUT)} MB`);
console.log(`網格 ${root.listMeshes().length}、材質 ${root.listMaterials().length}、貼圖 ${root.listTextures().length}`);
