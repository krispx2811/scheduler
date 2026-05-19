// Copies third-party assets we ship with the renderer so the packaged app
// doesn't need to reach into node_modules at runtime.
const fs = require('fs');
const path = require('path');

const vendorDir = path.join(__dirname, '..', 'renderer', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

const copies = [
  {
    from: path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
    to: path.join(vendorDir, 'chart.umd.js'),
  },
];

for (const { from, to } of copies) {
  if (!fs.existsSync(from)) {
    console.warn(`[copy-vendor] missing source: ${from}`);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`[copy-vendor] ${path.basename(to)} ready`);
}
