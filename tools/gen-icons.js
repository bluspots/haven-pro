/* Icon generator for Haven Pro PWA
 *
 * Reads the founder-provided mark PNG and emits:
 * - icon-192.png
 * - icon-512.png
 * - apple-touch-icon.png (180x180)
 *
 * The artwork must fill the canvas edge-to-edge (no nested bubble).
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  // Prefer the workspace image path; fall back to uploads path
  const candidates = [
    path.join(repoRoot, 'haven-pro-logo-mark.png'),
    path.join(process.env.HOME || '/home/ubuntu', '.cursor', 'projects', 'workspace', 'uploads', 'haven-pro-logo-mark_abdd.png'),
  ];
  const sourcePath = candidates.find(p => fs.existsSync(p));
  if (!sourcePath) {
    throw new Error('Logo mark PNG not found in expected locations.');
  }

  const outputs = [
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
    { name: 'apple-touch-icon.png', size: 180 },
  ];

  await Promise.all(outputs.map(async ({ name, size }) => {
    const outPath = path.join(repoRoot, name);
    await sharp(sourcePath)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9, quality: 100 })
      .toFile(outPath);
    console.log(`Wrote ${name} (${size}x${size})`);
  }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

