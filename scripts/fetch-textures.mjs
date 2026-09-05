import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Public CC0 assets. Sources and exact bytes are retained in the manifest.
const assets = [
  ['stone', 'medieval_blocks_02'],
  ['ground', 'forest_floor'],
  ['rock', 'rock_boulder_cracked'],
  ['wood', 'rough_wood'],
  ['moss', 'mossy_cobblestone'],
  ['bark', 'bark_brown_02'],
];
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'public/textures');
await mkdir(output, { recursive: true });
await mkdir(resolve(root, 'licenses'), { recursive: true });
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.json();
}
const catalog = await json('https://api.polyhaven.com/assets?t=textures');
const manifest = { source: 'Poly Haven', license: 'CC0-1.0', licenseUrl: 'https://polyhaven.com/license', downloaded: new Date().toISOString(), assets: [] };
for (const [name, id] of assets) {
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  const maps = [['color', 'diffuse'], ['normal', 'nor_gl'], ['roughness', 'rough']];
  const asset = { name, id, title: catalog[id].name, authors: Object.keys(catalog[id].authors), source: `https://polyhaven.com/a/${id}`, resolution: '1k', normalConvention: 'OpenGL', files: [] };
  for (const [suffix, key] of maps) {
    const type = Object.keys(files).find(k => k.toLowerCase() === key);
    const file = files[type]?.['1k']?.jpg;
    if (!file) throw new Error(`${id}: no 1k ${key} JPEG`);
    const filename = `${name}-${suffix}.jpg`;
    let data;
    try {
      const previous = await readFile(resolve(output, filename));
      if (createHash('md5').update(previous).digest('hex') === file.md5) data = previous;
    } catch {}
    if (!data) {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`${response.status}: ${file.url}`);
      data = Buffer.from(await response.arrayBuffer());
    }
    if (data.length !== file.size || createHash('md5').update(data).digest('hex') !== file.md5) throw new Error(`Integrity mismatch: ${filename}`);
    if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error(`Not a JPEG: ${filename}`);
    await writeFile(resolve(output, filename), data);
    asset.files.push({ filename, url: file.url, bytes: data.length, md5: file.md5, sha256: createHash('sha256').update(data).digest('hex') });
    console.log(`${filename}: ${data.length.toLocaleString()} bytes, MD5 verified`);
  }
  manifest.assets.push(asset);
}
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const license = `# Surface texture credits\n\nThese texture maps are distributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Poly Haven explicitly permits use, modification, and redistribution, including commercial use: [Poly Haven asset license](https://polyhaven.com/license).\n\nThe files below were downloaded directly from Poly Haven at 1K resolution. Every file is verified against the original API byte size and MD5, and a SHA-256 is recorded in \`public/textures/manifest.json\`. Color maps use sRGB; the normal and roughness maps use linear color space. Normal maps use the OpenGL convention.\n\n| In-game set | Original asset | Author(s) | Maps |\n| --- | --- | --- | --- |\n${manifest.assets.map(a => `| ${a.name} | [${a.title}](${a.source}) | ${a.authors.join(', ')} | ${a.files.map(f => f.filename).join(', ')} |`).join('\n')}\n\nRetrieved ${manifest.downloaded.slice(0, 10)}. All creature, weapon, item, and prop geometry in \`src/models.ts\` is authored specifically for this adaptation.\n`;
await writeFile(resolve(root, 'licenses/textures.md'), license);
console.log(`Verified ${manifest.assets.reduce((n, a) => n + a.files.length, 0)} texture files.`);
