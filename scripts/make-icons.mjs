// Generates the PWA icon set from logo concept A ("Snap Bracket"), recoloured to the wireframe palette.
// Run with: npm run icons
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');
await mkdir(out, { recursive: true });

const ACCENT = '#7B1E2C';
const PAPER = '#FDFCF8';
const PINK = '#E7A3AE';
const INK = '#37352F';

const bracket = 'M36 36H82V176H186V220H36Z';
const corner = 'M144 36H220V112H186V70H144Z';

// Symbol on transparent background (favicon, in-app use).
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <path d="${bracket}" fill="${INK}"/><path d="${corner}" fill="${ACCENT}"/>
</svg>`;

// App icon: rounded maroon tile, symbol scaled into the safe zone.
const appIcon = (scale, radius) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" rx="${radius}" fill="${ACCENT}"/>
  <g transform="translate(128 128) scale(${scale}) translate(-128 -128)">
    <path d="${bracket}" fill="${PAPER}"/><path d="${corner}" fill="${PINK}"/>
  </g>
</svg>`;

await writeFile(join(out, 'favicon.svg'), symbol);
await writeFile(join(out, 'icon.svg'), appIcon(0.72, 56));

const render = (svg, size, file) =>
  sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(join(out, file));

await render(symbol, 32, 'favicon-32.png');
await render(appIcon(0.72, 56), 192, 'icon-192.png');
await render(appIcon(0.72, 56), 512, 'icon-512.png');
// Maskable: full-bleed square, symbol inside the 80% safe zone.
await render(appIcon(0.6, 0), 512, 'icon-maskable-512.png');
// Apple touch icon: iOS rounds corners itself.
await render(appIcon(0.66, 0), 180, 'apple-touch-icon.png');

console.log('Icons written to public/icons');
