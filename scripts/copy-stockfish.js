const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../node_modules/stockfish/src');
const destDir = path.join(__dirname, '../public');

try {
  fs.mkdirSync(destDir, { recursive: true });

  const jsFile = 'stockfish-nnue-16-single.js';
  const wasmFile = 'stockfish-nnue-16-single.wasm';

  if (fs.existsSync(path.join(srcDir, jsFile))) {
    fs.copyFileSync(path.join(srcDir, jsFile), path.join(destDir, 'stockfish.js'));
    fs.copyFileSync(path.join(srcDir, wasmFile), path.join(destDir, wasmFile));
    console.log('Stockfish files copied to public/');
  }
} catch (e) {
  console.warn('Could not copy stockfish files:', e.message);
}
