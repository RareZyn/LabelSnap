// Renders a synthetic photo of a food label on a dark bench, for manual and e2e testing.
import sharp from 'sharp';
const W = 1600, H = 1200;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3632"/><stop offset="1" stop-color="#1d1b19"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <g transform="translate(800 600) rotate(-6) translate(-520 -300)">
    <rect width="1040" height="600" rx="8" fill="#f7f5ef"/>
    <text x="60" y="120" font-family="Arial" font-weight="700" font-size="72" fill="#1a1a1a">GREEK YOGURT PLAIN</text>
    <text x="60" y="210" font-family="Arial" font-size="38" fill="#222">INGREDIENTS: Cultured pasteurized milk,</text>
    <text x="60" y="262" font-family="Arial" font-size="38" fill="#222">live active cultures</text>
    <text x="60" y="420" font-family="Arial" font-size="44" fill="#111">NET WT 150 g   LOT FT-2024-118</text>
    <text x="60" y="500" font-family="Arial" font-weight="700" font-size="44" fill="#111">BEST BEFORE 2025-11-02</text>
  </g>
</svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile('tests/fixtures/label.jpg');
console.log('tests/fixtures/label.jpg');
