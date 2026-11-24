const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'deployment-zips');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function copySync(src, dest) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  }
}

// 1. HMS Frontend
console.log('1. Packaging hms-frontend-dist.zip...');
const hmsFrontDist = path.join(rootDir, 'HMS Software', 'frontend', 'dist');
const hmsFrontZip = path.join(outDir, 'hms-frontend-dist.zip');
run(`powershell -NoProfile -Command "Compress-Archive -Path '${hmsFrontDist}\\*' -DestinationPath '${hmsFrontZip}' -Force"`);

// 2. Pharmacy Frontend
console.log('2. Packaging pharmacy-frontend-dist.zip...');
const pharmFrontDist = path.join(rootDir, 'Pharmacy Software', 'frontend', 'dist');
const pharmFrontZip = path.join(outDir, 'pharmacy-frontend-dist.zip');
run(`powershell -NoProfile -Command "Compress-Archive -Path '${pharmFrontDist}\\*' -DestinationPath '${pharmFrontZip}' -Force"`);

// 3. HMS Backend
console.log('3. Packaging hms-backend-prod.zip (strictly excluding .env and node_modules)...');
const hmsBackDir = path.join(rootDir, 'HMS Software', 'backend');
const hmsBackZip = path.join(outDir, 'hms-backend-prod.zip');
const hmsStage = path.join(outDir, 'temp_hms_backend');
if (fs.existsSync(hmsStage)) fs.rmSync(hmsStage, { recursive: true, force: true });
fs.mkdirSync(hmsStage, { recursive: true });

copySync(path.join(hmsBackDir, 'dist'), path.join(hmsStage, 'dist'));
copySync(path.join(hmsBackDir, 'api'), path.join(hmsStage, 'api'));
copySync(path.join(hmsBackDir, 'prisma'), path.join(hmsStage, 'prisma'));
copySync(path.join(hmsBackDir, 'package.json'), path.join(hmsStage, 'package.json'));
copySync(path.join(hmsBackDir, 'package-lock.json'), path.join(hmsStage, 'package-lock.json'));
copySync(path.join(hmsBackDir, 'app.js'), path.join(hmsStage, 'app.js'));

run(`powershell -NoProfile -Command "Compress-Archive -Path '${hmsStage}\\*' -DestinationPath '${hmsBackZip}' -Force"`);
fs.rmSync(hmsStage, { recursive: true, force: true });

// 4. Pharmacy Backend
console.log('4. Packaging pharmacy-backend-prod.zip (strictly excluding .env and node_modules)...');
const pharmBackDir = path.join(rootDir, 'Pharmacy Software', 'backend');
const pharmBackZip = path.join(outDir, 'pharmacy-backend-prod.zip');
const pharmStage = path.join(outDir, 'temp_pharm_backend');
if (fs.existsSync(pharmStage)) fs.rmSync(pharmStage, { recursive: true, force: true });
fs.mkdirSync(pharmStage, { recursive: true });

copySync(path.join(pharmBackDir, 'dist'), path.join(pharmStage, 'dist'));
copySync(path.join(pharmBackDir, 'api'), path.join(pharmStage, 'api'));
copySync(path.join(pharmBackDir, 'prisma'), path.join(pharmStage, 'prisma'));
copySync(path.join(pharmBackDir, 'package.json'), path.join(pharmStage, 'package.json'));
copySync(path.join(pharmBackDir, 'package-lock.json'), path.join(pharmStage, 'package-lock.json'));

run(`powershell -NoProfile -Command "Compress-Archive -Path '${pharmStage}\\*' -DestinationPath '${pharmBackZip}' -Force"`);
fs.rmSync(pharmStage, { recursive: true, force: true });

console.log('\n--- SUCCESS! All 4 production zip packages ready in deployment-zips/ ---');
