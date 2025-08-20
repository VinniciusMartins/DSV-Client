// build/make-ico.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Support CJS/ESM export shapes for png-to-ico
function getPngToIco() {
    const mod = require('png-to-ico');
    return mod && (mod.default || mod);
}

(async () => {
    const src = path.resolve(__dirname, '../assets/printer.png');
    const out = path.resolve(__dirname, '../assets/app-icon.ico');

    if (!fs.existsSync(src)) {
        console.error('Source PNG not found:', src);
        process.exit(1);
    }

    try {
        const pngToIco = getPngToIco();

        // Load the source once
        const input = sharp(src).png();

        // Ensure square + transparent padding if needed, then generate sizes
        const sizes = [256, 128, 64, 48, 32, 24, 16];
        const buffers = [];
        for (const size of sizes) {
            const buf = await input
                .resize(size, size, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .png({ compressionLevel: 9 })
                .toBuffer();
            buffers.push(buf);
        }

        const icoBuf = await pngToIco(buffers);
        fs.writeFileSync(out, icoBuf);
        console.log('ICO generated:', out);
    } catch (e) {
        console.error('ICO generation failed:', e?.message || e);
        process.exit(2);
    }
})();
