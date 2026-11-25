// Ajusta el proyecto Android después de "npx cap add android":
// - permisos para reproducir en segundo plano y mostrar la notificación
// - pide permiso de notificaciones al abrir (Android 13+)
import fs from 'fs';
import path from 'path';

const manifest = 'android/app/src/main/AndroidManifest.xml';
let xml = fs.readFileSync(manifest, 'utf8');
const perms = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK'
];
for (const p of perms) {
  if (!xml.includes(`"${p}"`)) xml = xml.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
}
fs.writeFileSync(manifest, xml);
console.log('✔ Permisos agregados al AndroidManifest');

const cfg = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
const pkgPath = path.join('android/app/src/main/java', ...cfg.appId.split('.'));
const activity = path.join(pkgPath, 'MainActivity.java');
fs.writeFileSync(activity, `package ${cfg.appId};

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Android 13+: permiso para mostrar los controles de música en la notificación
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1001);
        }
    }
}
`);
console.log('✔ MainActivity actualizado');

// Iconos propios: vector para Android 7 y adaptativo para Android 8+.
const res = 'android/app/src/main/res';
fs.copyFileSync('resources/icon-foreground.xml', `${res}/drawable/pixeldeck_foreground.xml`);
fs.copyFileSync('resources/icon-legacy.xml', `${res}/drawable/pixeldeck_launcher.xml`);
fs.writeFileSync(`${res}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#1ED760</color></resources>
`);
fs.mkdirSync(`${res}/mipmap-anydpi-v26`, { recursive: true });
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  fs.writeFileSync(`${res}/mipmap-anydpi-v26/${name}.xml`, `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/pixeldeck_foreground" />
    <monochrome android:drawable="@drawable/pixeldeck_foreground" />
</adaptive-icon>
`);
  fs.mkdirSync(`${res}/mipmap-anydpi`, { recursive: true });
  fs.copyFileSync('resources/icon-legacy.xml', `${res}/mipmap-anydpi/${name}.xml`);
}
console.log('✔ Logo e iconos de Pixel Deck aplicados');
