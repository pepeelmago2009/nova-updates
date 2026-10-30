// Pruebas de la logica del lanzador con un "internet" falso (no necesita Mojang, Fabric ni Modrinth).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-test-'));
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const JAR = Buffer.from('fake jar bytes');
const routes = {};
let calls = [];

global.fetch = async (url) => {
  calls.push(url);
  const key = Object.keys(routes).find((k) => url.startsWith(k));
  if (!key) return { ok: false, status: 404, headers: new Map() };
  const body = routes[key];
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return {
    ok: true, status: 200,
    headers: { get: (h) => (h === 'content-length' ? String(buf.length) : null) },
    json: async () => JSON.parse(buf.toString()),
    body: (async function* () { yield buf.subarray(0, 5); yield buf.subarray(5); })(),
  };
};

global.fetch.isMock = true;
const settings = require('../src/settings');
const fabric = require('../src/fabric');
const mods = require('../src/mods');
const net = require('../src/net');
const game = require('../src/game');

async function run() {
  // ---- ajustes
  const c = settings.clean({ username: 'a b', ramGB: 99, ramAuto: false, lang: 'xx', version: '1.8.9', theme: 9 }, 8);
  assert.strictEqual(c.username, 'Player');
  assert.strictEqual(c.ramGB, 8);
  assert.strictEqual(c.lang, 'es');
  assert.strictEqual(c.version, '1.21.4');
  assert.strictEqual(c.theme, 5);
  assert.ok(settings.clean({ ramGB: 12 }, 32).ramGB <= 6, 'sin tocar la RAM, la elige el lanzador');
  const f = path.join(tmp, 's.json');
  settings.save(f, { username: 'Steve_99', ramGB: 6 }, 16);
  assert.strictEqual(settings.load(f, 16).username, 'Steve_99');
  assert.strictEqual(settings.load(path.join(tmp, 'nope.json'), 16).username, 'Player');

  // ---- descarga con sha1
  routes['https://x.test/file.jar'] = JAR;
  const dest = path.join(tmp, 'd', 'file.jar');
  let progress = 0;
  await net.download('https://x.test/file.jar', dest, { sha1: sha1(JAR), onProgress: (d) => { progress = d; } });
  assert.ok(fs.readFileSync(dest).equals(JAR));
  assert.strictEqual(progress, JAR.length);
  await assert.rejects(net.download('https://x.test/file.jar', path.join(tmp, 'bad.jar'), { sha1: 'deadbeef' }), /corrupto/);
  assert.ok(!fs.existsSync(path.join(tmp, 'bad.jar')) && !fs.existsSync(path.join(tmp, 'bad.jar.part')));

  // ---- Fabric
  const root = path.join(tmp, 'root');
  routes['https://meta.fabricmc.net/v2/versions/loader/1.21.4/0.16.10/profile/json'] = { id: 'fabric-loader-0.16.10-1.21.4', inheritsFrom: '1.21.4' };
  routes['https://meta.fabricmc.net/v2/versions/loader/1.21.4'] = [{ loader: { version: '0.17.0-beta', stable: false } }, { loader: { version: '0.16.10', stable: true } }];
  const id = await fabric.ensureFabric(root, '1.21.4');
  assert.strictEqual(id, 'fabric-loader-0.16.10-1.21.4');
  assert.ok(fs.existsSync(path.join(root, 'versions', id, id + '.json')));
  delete routes['https://meta.fabricmc.net/v2/versions/loader/1.21.4'];
  assert.strictEqual(await fabric.ensureFabric(root, '1.21.4'), id, 'sin internet usa el instalado');

  // ---- mods
  const res = path.join(tmp, 'res');
  fs.mkdirSync(res, { recursive: true });
  fs.writeFileSync(path.join(res, 'nova-1.21.4.jar'), 'nova');
  assert.deepStrictEqual(mods.novaVersions(res), ['1.21.4']);
  const { PERFORMANCE_MODS } = require('../src/versions');
  const rel = (slug, deps = []) => ({ version_type: 'release', project_id: slug + '-id', dependencies: deps,
    files: [{ primary: true, url: 'https://x.test/file.jar', filename: `${slug}-1.jar`, hashes: { sha1: sha1(JAR) } }] });
  for (const slug of ['fabric-api', ...PERFORMANCE_MODS, 'cloth-config']) {
    const deps = slug === 'moreculling' ? [{ project_id: 'cloth-config-id', dependency_type: 'required' }]
      : slug === 'entityculling' ? [{ project_id: 'fabric-api-id', dependency_type: 'required' }, { project_id: 'x-id', dependency_type: 'optional' }] : [];
    routes[`https://api.modrinth.com/v2/project/${slug}/version`] = [
      { version_type: 'beta', project_id: slug + '-id', dependencies: [], files: [{ primary: true, url: 'https://x.test/beta.jar', filename: `${slug}-beta.jar`, hashes: {} }] },
      rel(slug, deps),
    ];
    routes[`https://api.modrinth.com/v2/project/${slug}-id/version`] = [rel(slug)];
  }
  const inst = path.join(root, 'instances', '1.21.4');
  fs.mkdirSync(path.join(inst, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(inst, 'mods', 'mio-del-usuario.jar'), 'x');
  // el usuario ya instalo Lithium por su cuenta: el cliente no lo repite
  fs.writeFileSync(path.join(inst, 'mods', 'mi-lithium.jar'), 'x');
  fs.writeFileSync(path.join(inst, 'mods', mods.USER), JSON.stringify([{ projectId: 'lithium-id', slug: 'lithium', filename: 'mi-lithium.jar' }]));
  let r = await mods.syncMods(inst, '1.21.4', { nova: true, perf: true }, res);
  assert.strictEqual(r.nova, true);
  let list = fs.readdirSync(path.join(inst, 'mods')).filter((n) => n.endsWith('.jar')).sort();
  const expected = ['fabric-api', ...PERFORMANCE_MODS.filter((m) => m !== 'lithium'), 'cloth-config'].map((m) => m + '-1.jar')
    .concat(['mi-lithium.jar', 'mio-del-usuario.jar', 'nova-client.jar']).sort();
  assert.deepStrictEqual(list, expected, 'rendimiento + dependencia de moreculling, sin repetir Lithium ni Fabric API');
  r = await mods.syncMods(inst, '1.21.4', { nova: false, perf: false }, res);
  list = fs.readdirSync(path.join(inst, 'mods')).filter((n) => n.endsWith('.jar')).sort();
  assert.deepStrictEqual(list, ['fabric-api-1.jar', 'mi-lithium.jar', 'mio-del-usuario.jar'], 'quita solo lo que puso el lanzador');
  r = await mods.syncMods(path.join(root, 'instances', '1.21.8'), '1.21.8', { nova: true, perf: false }, res);
  assert.strictEqual(r.nova, false, 'no hay Nova para 1.21.8');

  // ---- Minecraft: reglas, rutas maven y descarga verificada (con archivos vacios de una descarga rota)
  const mcmod = require('../src/minecraft');
  const winOnly = [{ action: 'allow', os: { name: 'windows' } }];
  assert.strictEqual(mcmod.allowed(undefined), true);
  assert.strictEqual(mcmod.allowed(winOnly), process.platform === 'win32');
  assert.strictEqual(mcmod.allowed([{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }]), process.platform !== 'darwin');
  assert.strictEqual(mcmod.mavenPath('net.fabricmc:fabric-loader:0.16.10'), 'net/fabricmc/fabric-loader/0.16.10/fabric-loader-0.16.10.jar');
  assert.strictEqual(mcmod.mavenPath('org.lwjgl:lwjgl:3.3.3:natives-windows'), 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar');

  const ASSET = Buffer.from('asset bytes');
  const LIB = Buffer.from('library bytes');
  const CLIENT = Buffer.from('client jar bytes');
  const idx = { objects: { 'a/one.png': { hash: sha1(ASSET), size: ASSET.length }, 'b/same.png': { hash: sha1(ASSET), size: ASSET.length } } };
  const vjson = {
    downloads: { client: { url: 'https://x.test/client.jar', sha1: sha1(CLIENT), size: CLIENT.length } },
    assetIndex: { url: 'https://x.test/index.json', sha1: sha1(Buffer.from(JSON.stringify(idx))) },
    libraries: [
      { name: 'a:b:1', downloads: { artifact: { path: 'a/b/1/b-1.jar', url: 'https://x.test/lib.jar', sha1: sha1(LIB), size: LIB.length } } },
      { name: 'a:mac:1', downloads: { artifact: { path: 'a/mac/1/mac-1.jar', url: 'https://x.test/nope.jar', sha1: 'x', size: 1 } }, rules: [{ action: 'allow', os: { name: 'osx-nunca' } }] },
    ],
  };
  routes['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'] = { versions: [{ id: '1.21.4', url: 'https://x.test/1.21.4.json', sha1: sha1(Buffer.from(JSON.stringify(vjson))) }] };
  routes['https://x.test/1.21.4.json'] = vjson;
  routes['https://x.test/index.json'] = idx;
  routes['https://x.test/client.jar'] = CLIENT;
  routes['https://x.test/lib.jar'] = LIB;
  routes['https://resources.download.minecraft.net/'] = ASSET;
  routes['https://maven.fabricmc.net/'] = LIB;
  const mroot = path.join(tmp, 'mroot');
  const cid = 'fabric-loader-0.16.10-1.21.4';
  fs.mkdirSync(path.join(mroot, 'versions', cid), { recursive: true });
  fs.writeFileSync(path.join(mroot, 'versions', cid, cid + '.json'), JSON.stringify({ libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.10', url: 'https://maven.fabricmc.net/', sha1: sha1(LIB), size: LIB.length }] }));
  const assetFile = path.join(mroot, 'assets', 'objects', sha1(ASSET).slice(0, 2), sha1(ASSET));
  fs.mkdirSync(path.dirname(assetFile), { recursive: true });
  fs.writeFileSync(assetFile, ''); // archivo vacio, como los que deja MCLC cuando falla una descarga
  let last = [0, 0];
  const r1 = await mcmod.ensureMinecraft(mroot, cid, '1.21.4', (d, t) => { last = [d, t]; });
  assert.strictEqual(r1.downloaded, 4, 'jar + 1 libreria + loader + 1 asset (repetido y el de mac no)');
  assert.ok(fs.readFileSync(assetFile).equals(ASSET), 'repara el asset vacio');
  assert.ok(fs.readFileSync(path.join(mroot, 'versions', cid, cid + '.jar')).equals(CLIENT));
  assert.ok(fs.existsSync(path.join(mroot, 'libraries', 'net', 'fabricmc', 'fabric-loader', '0.16.10', 'fabric-loader-0.16.10.jar')));
  assert.ok(fs.existsSync(path.join(mroot, 'assets', 'indexes', cid + '.json')), 'indice con el id que usa MCLC');
  assert.deepStrictEqual(last, [r1.bytes, r1.bytes]);
  calls = [];
  const r2 = await mcmod.ensureMinecraft(mroot, cid, '1.21.4');
  assert.strictEqual(r2.downloaded, 0, 'la segunda vez no baja nada');
  assert.strictEqual(calls.length, 0, 'ni siquiera consulta internet');
  routes['https://x.test/lib.jar'] = Buffer.from('otra cosa');
  fs.rmSync(path.join(mroot, 'libraries', 'a'), { recursive: true });
  await assert.rejects(mcmod.ensureMinecraft(mroot, cid, '1.21.4'), /No se pudieron descargar 1 archivos/, 'si el hash no cuadra, avisa');

  // ---- reparar
  game.repair(root, '1.21.4');
  assert.ok(!fs.existsSync(path.join(root, 'versions', id)));
  assert.deepStrictEqual(fs.readdirSync(path.join(inst, 'mods')).sort(), [mods.USER, 'mi-lithium.jar', 'mio-del-usuario.jar'].sort());

  // ---- cuentas de Microsoft (todo el camino Microsoft -> Xbox -> XSTS -> Minecraft con respuestas falsas)
  const accounts = require('../src/accounts');
  routes['https://login.live.com/oauth20_token.srf'] = { access_token: 'ms-acc', refresh_token: 'ms-ref' };
  routes['https://user.auth.xboxlive.com/'] = { Token: 'xbl', DisplayClaims: { xui: [{ uhs: 'u1' }] } };
  routes['https://xsts.auth.xboxlive.com/'] = { Token: 'xsts', DisplayClaims: { xui: [{ uhs: 'u1', xid: '42' }] } };
  routes['https://api.minecraftservices.com/authentication/'] = { access_token: 'mc-tok', expires_in: 86400 };
  routes['https://api.minecraftservices.com/minecraft/profile'] = { id: 'abc123', name: 'Steve', skins: [{ state: 'ACTIVE', url: 'http://textures.minecraft.net/texture/x' }] };
  const enc = { encrypt: (x) => 'E' + x, decrypt: (x) => x.slice(1) };
  const accFile = path.join(tmp, 'accounts.json');
  const store = new accounts.Store(accFile, enc);
  assert.ok(accounts.authUrl().includes('client_id=00000000402b5328'));
  const listed = await accounts.addFromCode(store, 'code-1');
  assert.deepStrictEqual(listed.accounts, [{ id: 'abc123', name: 'Steve', skin: 'https://textures.minecraft.net/texture/x', type: 'microsoft' }]);
  assert.strictEqual(listed.active, 'abc123');
  assert.ok(!fs.readFileSync(accFile, 'utf8').includes('"mc-tok"'), 'los tokens se guardan cifrados');
  const auth = await accounts.authFor(new accounts.Store(accFile, enc), 'Offline', (n) => ({ name: n }));
  assert.strictEqual(auth.access_token, 'mc-tok');
  assert.strictEqual(auth.name, 'Steve');
  assert.strictEqual(auth.meta.type, 'msa');
  // token vencido: se renueva con el refresh token
  const st2 = new accounts.Store(accFile, enc);
  st2.data.accounts[0].mcExpires = 0;
  routes['https://api.minecraftservices.com/authentication/'] = { access_token: 'mc-tok-2', expires_in: 86400 };
  assert.strictEqual((await accounts.authFor(st2, 'Offline', (n) => ({ name: n }))).access_token, 'mc-tok-2');
  // sin premium
  st2.select('offline');
  assert.deepStrictEqual(await accounts.authFor(st2, 'Pepe', (n) => ({ name: n })), { name: 'Pepe' });
  // cuenta sin Minecraft comprado
  delete routes['https://api.minecraftservices.com/minecraft/profile'];
  await assert.rejects(accounts.addFromCode(st2, 'code-2'), (e) => e.key === 'noGame');
  assert.deepStrictEqual(st2.remove('abc123').accounts, []);

  // ---- ajustes de los mods de FPS (una sola vez, sin pisar cambios del jugador)
  const perfconfig = require('../src/perfconfig');
  const pinst = path.join(tmp, 'perfinst');
  fs.mkdirSync(path.join(pinst, 'config'), { recursive: true });
  fs.writeFileSync(path.join(pinst, 'config', 'sodium-options.json'), JSON.stringify({ quality: { weather_quality: 'DEFAULT', leaves_quality: 'DEFAULT', enable_vignette: true }, performance: { chunk_builder_threads: 0 } }));
  fs.writeFileSync(path.join(pinst, 'config', 'moreculling.toml'), 'version = 1\nendGatewayCulling = false\n');
  const t1 = perfconfig.tune(pinst);
  assert.deepStrictEqual(t1.sort(), ['entityculling.json', 'immediatelyfast.json', 'moreculling.toml', 'sodium-options.json']);
  const sod = JSON.parse(fs.readFileSync(path.join(pinst, 'config', 'sodium-options.json'), 'utf8'));
  assert.strictEqual(sod.quality.leaves_quality, 'FAST');
  assert.strictEqual(sod.performance.chunk_builder_threads, 0, 'no borra lo demas');
  assert.ok(fs.readFileSync(path.join(pinst, 'config', 'moreculling.toml'), 'utf8').includes('endGatewayCulling = true'));
  sod.quality.leaves_quality = 'FANCY'; // el jugador lo cambia a mano
  fs.writeFileSync(path.join(pinst, 'config', 'sodium-options.json'), JSON.stringify(sod));
  assert.deepStrictEqual(perfconfig.tune(pinst), [], 'la segunda vez no toca nada');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(pinst, 'config', 'sodium-options.json'), 'utf8')).quality.leaves_quality, 'FANCY');

  // ---- version de Minecraft que pide cada mod
  const { mcMatches } = require('../src/mods');
  assert.ok(mcMatches('~1.21.4', '1.21.4') && !mcMatches('~1.21.4', '1.21.3'));
  assert.ok(mcMatches('>=1.21 <1.21.2', '1.21.1') && !mcMatches('>=1.21 <1.21.2', '1.21.2'));
  assert.ok(!mcMatches('1.21.1', '1.21') && mcMatches(['1.21', '1.21.1'], '1.21'));
  assert.ok(mcMatches('1.21.x', '1.21.5') && mcMatches(undefined, '1.21'));
  // ---- rendimiento segun el equipo
  const hw = require('../src/hardware');
  assert.strictEqual(hw.gpuKind(['NVIDIA GeForce MX100']), 'dedicated');
  assert.strictEqual(hw.gpuKind(['Intel(R) UHD Graphics 620']), 'integrated');
  assert.strictEqual(hw.gpuKind(['Intel(R) UHD Graphics 620', 'NVIDIA GeForce MX100']), 'dedicated');
  assert.deepStrictEqual([4, 8, 16, 32].map(hw.recommendedRam), [2, 3, 4, 6]);
  assert.strictEqual(hw.profileFor({ ramGB: 8, threads: 4, gpuKind: 'dedicated' }), 'performance');
  assert.strictEqual(hw.profileFor({ ramGB: 32, threads: 16, gpuKind: 'dedicated' }), 'quality');
  assert.ok(hw.jvmArgs(3).includes('-XX:G1HeapRegionSize=8M') && !hw.jvmArgs(3).includes('-XX:+AlwaysPreTouch'));
  const vinst = path.join(tmp, 'video'); fs.mkdirSync(vinst);
  fs.writeFileSync(path.join(vinst, 'options.txt'), 'renderDistance:32\nlang:es_es\n');
  assert.strictEqual(hw.applyVideo(vinst, 'performance'), 'performance');
  const opts = fs.readFileSync(path.join(vinst, 'options.txt'), 'utf8');
  assert.ok(opts.includes('renderDistance:8') && !opts.includes('renderDistance:32') && opts.includes('lang:es_es'));
  assert.strictEqual(hw.applyVideo(vinst, 'quality'), null, 'solo la primera vez');
  // ---- servidores: ping con el protocolo de Minecraft contra un servidor falso local
  const servers = require('../src/servers');
  const netm = require('net');
  const fake = netm.createServer((sock) => {
    let got = Buffer.alloc(0);
    sock.on('data', (d) => {
      got = Buffer.concat([got, d]);
      const [l1, p1] = servers.readVarint(got, 0);
      if (got.length < p1 + l1 + 2) return; // saludo + pedido de estado
      const json = Buffer.from(JSON.stringify({ version: { name: '1.21.4' }, players: { online: 42, max: 100 }, description: { text: '§aHola ', extra: [{ text: 'Nova' }] } }));
      const body = Buffer.concat([servers.varint(0), servers.varint(json.length), json]);
      sock.write(Buffer.concat([servers.varint(body.length), body]));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const st = await servers.ping('127.0.0.1:' + fake.address().port);
  fake.close();
  assert.strictEqual(st.online, 42); assert.strictEqual(st.max, 100);
  assert.strictEqual(st.version, '1.21.4'); assert.strictEqual(st.motd, 'Hola Nova');
  assert.deepStrictEqual(servers.parseAddress('Play.Example.net:25570'), { host: 'play.example.net', port: 25570, explicitPort: true });
  assert.strictEqual(servers.parseAddress('mal ip'), null);
  assert.strictEqual(servers.clean([{ address: 'a.com' }, { address: 'A.com' }, { address: '' }]).length, 1);
  console.log('OK: todas las pruebas del lanzador pasaron');
}

run().catch((e) => { console.error(e); process.exit(1); }).finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
