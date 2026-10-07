// Renders the Windows icon: `npx electron scripts/build-ico.cjs <out.ico>`. Reads static/icon.png.
const { app, nativeImage } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const source = nativeImage.createFromPath(
  join(__dirname, '..', 'static/icon.png'),
);

app.whenReady().then(() => {
  const images = sizes.map((size) =>
    source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  );
  // ICO: a header, one directory entry per image, then the PNG data (supported since Vista).
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  writeFileSync(
    process.argv[process.argv.length - 1],
    Buffer.concat([header, ...images]),
  );
  app.quit();
});
