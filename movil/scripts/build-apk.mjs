// Genera un APK instalable sin abrir Android Studio.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const android = path.join(root, 'android');
const windows = process.platform === 'win32';

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const gradleArgs = [':app:assembleDebug', '--max-workers=2', '--console=plain'];
// En Termux, usa un AAPT2 compatible con ARM y con el SDK del proyecto.
if (process.env.AAPT2_PATH) {
  const aapt2 = path.resolve(root, process.env.AAPT2_PATH);
  fs.accessSync(aapt2, fs.constants.X_OK);
  gradleArgs.push(`-Pandroid.aapt2FromMavenOverride=${aapt2}`);
}

// Ejecutar las CLI con Node también funciona en Windows sin un shell extra.
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
const capacitor = ['node_modules/@capacitor/cli/bin/capacitor'];
if (!fs.existsSync(path.join(android, 'app/build.gradle'))) {
  run(process.execPath, [...capacitor, 'add', 'android']);
}
run(process.execPath, ['scripts/patch-android.mjs']);
run(process.execPath, [...capacitor, 'sync', 'android']);
if (windows) {
  run('cmd.exe', ['/d', '/c', 'gradlew.bat', ...gradleArgs], android);
} else {
  run('sh', ['./gradlew', ...gradleArgs], android);
}

console.log(`\n✔ APK generado: ${path.join(android, 'app/build/outputs/apk/debug/app-debug.apk')}`);
