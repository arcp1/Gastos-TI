"use strict";
// PostgreSQL embebido: se usa cuando no hay DATABASE_URL configurada.
// Descarga los binarios de PostgreSQL con npm (paquete embedded-postgres) y guarda
// los datos en la carpeta pgdata/ del proyecto. No requiere instalar nada más.
const fs = require("fs");
const path = require("path");

const USER = "gastos";
const PASSWORD = process.env.EMBEDDED_PG_PASSWORD || "gastos-local";
const DBNAME = "gastos_ti";

async function startEmbedded(log = console.log) {
  let EmbeddedPostgres;
  try {
    const mod = require("embedded-postgres");
    EmbeddedPostgres = mod.default || mod;
  } catch (e) {
    throw new Error("Falta el paquete embedded-postgres. Ejecuta: npm install");
  }
  const dir = path.resolve(process.env.PGDATA_DIR || path.join(__dirname, "..", "pgdata"));
  const port = Number(process.env.EMBEDDED_PG_PORT) || 5433;
  const fresh = !fs.existsSync(path.join(dir, "PG_VERSION"));
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: USER,
    password: PASSWORD,
    authMethod: "scram-sha-256",
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    createPostgresUser: isRoot,
    onLog: () => {},
    onError: m => { const s = String(m && m.message || m).trim(); if (s && !/^\s*$/.test(s)) log("[postgres] " + s); },
  });

  // Si quedó un PostgreSQL corriendo (o un postmaster.pid huérfano) de un apagado brusco, se detiene o se limpia.
  const pidFile = path.join(dir, "postmaster.pid");
  const vivo = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; } };
  const espera = ms => new Promise(r => setTimeout(r, ms));
  if (!fresh && fs.existsSync(pidFile)) {
    const pid = Number((fs.readFileSync(pidFile, "utf8").split(/\r?\n/)[0] || "").trim());
    if (pid && vivo(pid)) {
      log(`Hay un PostgreSQL embebido corriendo (pid ${pid}); se detiene para arrancar limpio...`);
      try {
        const plat = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform] || process.platform;
        const pkgDir = path.dirname(require.resolve(`@embedded-postgres/${plat}-${process.arch}/package.json`));
        const pgCtl = path.join(pkgDir, "native", "bin", process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
        require("child_process").spawnSync(pgCtl, ["-D", dir, "stop", "-m", "fast", "-t", "20"], { stdio: "ignore", timeout: 30000 });
      } catch {}
      for (let i = 0; i < 30 && vivo(pid); i++) await espera(500);
      if (vivo(pid)) { try { process.kill(pid, "SIGINT"); } catch {} for (let i = 0; i < 20 && vivo(pid); i++) await espera(500); }
      if (vivo(pid)) throw new Error(`No se pudo detener el PostgreSQL embebido anterior (pid ${pid}). Ciérralo desde el Administrador de tareas y vuelve a intentar.`);
      log("PostgreSQL anterior detenido.");
    }
    if (fs.existsSync(pidFile)) { try { fs.rmSync(pidFile, { force: true }); log("Se limpió un postmaster.pid huérfano."); } catch {} }
  }
  if (fresh) {
    log(`Creando la base de datos PostgreSQL embebida en ${dir} ...`);
    fs.mkdirSync(dir, { recursive: true });
    await pg.initialise();
  }
  await pg.start();
  if (fresh) await pg.createDatabase(DBNAME);

  const url = `postgres://${USER}:${encodeURIComponent(PASSWORD)}@127.0.0.1:${port}/${DBNAME}`;
  process.env.DATABASE_URL = url;

  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    try { await pg.stop(); } catch {}
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, async () => { await stop(); process.exit(0); });
  process.on("exit", () => { /* embedded-postgres también detiene el proceso al salir */ });

  log(`PostgreSQL embebido listo en 127.0.0.1:${port} (datos en ${dir})`);
  return { pg, stop, url };
}

module.exports = { startEmbedded };
