/**
 * Dev-only: a miniature Obsidian-style vault written into the OPFS vault root —
 * frontmatter, inline #tags, nested folders, a .url link and a .dash dashboard.
 * The step-3 exit test runs against this.
 */
import type { VaultFs } from '@waffle/core';

const FILES: Record<string, string> = {
  'inbox.md': `Quick capture note, no frontmatter. Remember the #inbox things.\n`,

  'Recipes/pasta-alla-norma.md': `---
rating: 4.5
time_min: 45
tags: [recipes, italy]
---
# Pasta alla Norma

Fried aubergine, tomato, ricotta salata. The Catania classic — see [[tiramisu]] for dessert.

Kitchen voice memo:

![[nota-de-voz.wav]]
`,

  'Recipes/desserts/tiramisu.md': `---
rating: 5
tags: [recipes, dessert]
---
# Tiramisù

Savoiardi, mascarpone, espresso. No cream, ever. #italy
`,

  'Trips/puglia-2027.md': `---
start: 2027-06-12
budget: 3500
booked: false
tags: [travel, italy]
---
# Puglia 2027

Masserie shortlist, trulli day, linen packing list lives in [[linen-shirt]].

\`\`\`mermaid
graph LR
    BRI[Bari] --> POL[Polignano] --> MON[Monopoli] --> OST[Ostuni] --> LEC[Lecce]
    OST --> MAS[Masseria stay]
\`\`\`
`,

  'Trips/masseria-torre.url': `[InternetShortcut]\nURL=https://www.masseriatorremaizza.com/en/rooms\n`,

  'Wardrobe/linen-shirt.md': `---
price: 49
color: white
shop: https://example-store.com/linen-shirt
---
White linen shirt for the #wedding. Pairs with the tan loafers.
`,

  'Wardrobe/wedding-looks.md': `Collected looks for the Italian #wedding — mood: #summer, breathable fabrics.

![[look-1.png]]
`,

  'Finances/net-worth.dash': `{ "widgets": [] }\n`,
};

/** Generated test photos (pixel colors are data, not component styling). */
const IMAGES: Array<{ path: string; w: number; h: number; bg: string; fg: string }> = [
  { path: 'Wardrobe/look-1.png', w: 640, h: 420, bg: '#e8ddd0', fg: '#7a6a55' },
  { path: 'Wardrobe/look-2.png', w: 420, h: 640, bg: '#d5dde4', fg: '#4e6a80' },
  { path: 'Trips/beach.png', w: 720, h: 360, bg: '#cde3e6', fg: '#3e7d86' },
  { path: 'Recipes/plating.png', w: 500, h: 500, bg: '#e6d5cd', fg: '#8a5a44' },
];

async function makeImage(w: number, h: number, bg: string, fg: string): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.arc(w * 0.35, h * 0.45, Math.min(w, h) * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.fillRect(w * 0.55, h * 0.2, w * 0.3, h * 0.6);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Tiny valid WAV (fading sine) so audio embeds are testable without a microphone. */
function makeWav(seconds = 0.6, freq = 440): Uint8Array {
  const rate = 8000;
  const n = Math.floor(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * (1 - i / n), true);
  return new Uint8Array(buf);
}

export async function createFixtureVault(fs: VaultFs): Promise<number> {
  const encoder = new TextEncoder();
  for (const [path, content] of Object.entries(FILES)) {
    await fs.write(path, encoder.encode(content));
  }
  for (const img of IMAGES) {
    await fs.write(img.path, await makeImage(img.w, img.h, img.bg, img.fg));
  }
  await fs.write('Recipes/nota-de-voz.wav', makeWav());
  return Object.keys(FILES).length + IMAGES.length + 1;
}
