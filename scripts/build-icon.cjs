// Renders the app icon: `npx electron scripts/build-icon.cjs`. Reads static/app-icon.svg, writes static/icon.png.
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const SIZE = 1024;
// macOS app icons keep a margin around the squircle so the dock can cast its shadow.
const INSET = 100;
const BODY = SIZE - INSET * 2;
const RADIUS = BODY * 0.2237;

const artwork = readFileSync(join(root, 'static/app-icon.svg'), 'utf8');

const svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
<filter id="drop" x="0" y="0" width="${SIZE}" height="${SIZE}" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect x="${INSET}" y="${INSET + 18}" width="${BODY}" height="${BODY}" rx="${RADIUS}" fill="#000" opacity="0.55" filter="url(#drop)"/>
${artwork.replace('<svg ', `<svg x="${INSET}" y="${INSET}" width="${BODY}" height="${BODY}" `)}
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`;
  await win.loadURL(
    `data:text/html;base64,${Buffer.from(html).toString('base64')}`,
  );
  await new Promise((done) => setTimeout(done, 300));
  const image = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: SIZE,
    height: SIZE,
  });
  writeFileSync(join(root, 'static/icon.png'), image.toPNG());
  app.quit();
});
