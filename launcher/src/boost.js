const { execFile } = require('child_process');

/**
 * Ajustes de Windows para mas FPS (no hacen nada en otros sistemas):
 * - Usa la tarjeta grafica dedicada para Java (en laptops Windows suele elegir la integrada, que da muchos menos FPS).
 * - Sube la prioridad del juego para que Windows le de mas tiempo de CPU.
 */
function preferDedicatedGpu(javaPath) {
  if (process.platform !== 'win32' || !javaPath) return;
  const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
  const exes = [javaPath, javaPath.replace(/java\.exe$/i, 'javaw.exe')];
  for (const exe of exes) {
    execFile('reg', ['add', key, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { windowsHide: true }, () => {});
  }
}

function raisePriority(pid) {
  if (process.platform !== 'win32' || !pid) return;
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `try { (Get-Process -Id ${Number(pid)}).PriorityClass = 'AboveNormal' } catch {}`], { windowsHide: true }, () => {});
}

module.exports = { preferDedicatedGpu, raisePriority };
