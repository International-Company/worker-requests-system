// Generates the PWA icons and the in-app alert sound. Outputs are committed to /public.
//   npm run assets
// The icon is a neutral glyph (not a company logo). The alert sound is synthesised here
// (original, royalty-free): a short two-tone chime repeated twice.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const pub = join(import.meta.dirname, '..', 'public');
mkdirSync(join(pub, 'icons'), { recursive: true });
mkdirSync(join(pub, 'sounds'), { recursive: true });

const BLUE = '#1f5fbf';
// Clipboard with a check mark — "a request to handle".
const glyph = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <rect x="146" y="118" width="220" height="290" rx="30"/>
    <path d="M206 118v-14a22 22 0 0 1 22-22h56a22 22 0 0 1 22 22v14"/>
    <path d="M196 268l44 44 80-88"/>
  </g>`;
const svg = (rounded, scale) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${BLUE}"/>${glyph(scale)}</svg>`);
// Monochrome badge for the Android status bar (white on transparent).
const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${glyph(1.05)}</svg>`);

const out = async (buf, size, name) => sharp(buf).resize(size, size).png().toFile(join(pub, 'icons', name));
await out(svg(true, 1), 192, 'icon-192.png');
await out(svg(true, 1), 512, 'icon-512.png');
await out(svg(false, 0.78), 512, 'icon-maskable-512.png'); // safe zone for adaptive icons
await out(svg(false, 0.9), 180, 'apple-touch-icon.png');
await out(badge, 96, 'badge-96.png');

// --- alert.wav: 22.05 kHz mono 16-bit PCM
const rate = 22050;
const tones = [
  [880, 0.16],
  [0, 0.05],
  [1175, 0.22],
  [0, 0.18],
  [880, 0.16],
  [0, 0.05],
  [1175, 0.3],
];
const samples = [];
for (const [freq, dur] of tones) {
  const n = Math.round(rate * dur);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, i / (rate * 0.01)) * Math.min(1, (n - i) / (rate * 0.04)); // click-free edges
    const v = freq ? env * (0.6 * Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(4 * Math.PI * freq * t)) : 0;
    samples.push(Math.max(-1, Math.min(1, v * 0.8)));
  }
}
const data = Buffer.alloc(samples.length * 2);
samples.forEach((s, i) => data.writeInt16LE(Math.round(s * 32767), i * 2));
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(join(pub, 'sounds', 'alert.wav'), Buffer.concat([header, data]));

console.log('Generated icons and alert sound in public/');
