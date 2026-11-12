#!/usr/bin/env node
// dsh-plugin-docker-doctor — audita Dockerfile y compose sin construir.
// Tools: status, scan.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'docker-doctor', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'docker-doctor');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.venv', 'venv', '__pycache__', 'vendor', 'target']);
const SKIP_FILES = ['node_modules', '.git'];
const log = (m) => process.stderr.write(`[dockerdoc] ${m}\n`);

function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { allowedPaths: [] }; }
function allowedRoots() { const configured = loadConfig().allowedPaths; return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item)); }
function isAllowed(target) { const resolved = path.resolve(target); return allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }

function findDockerFiles(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_FILES.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1); continue; }
      if (/^(Dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$/i.test(entry.name)) found.push(full);
    }
  };
  walk(root, 1);
  return found;
}
function auditDockerfile(file, relative) {
  const findings = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const add = (severity, line, message) => findings.push({ severity, file: relative, line, message });
  let hasUser = false;
  let hasHealthcheck = false;
  let hasCmd = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const lineNumber = index + 1;
    if (!line || line.startsWith('#')) continue;
    const from = line.match(/^FROM\s+(\S+)/i);
    if (from) {
      const image = from[1];
      if (/:latest$/i.test(image) || !/:/.test(image)) add('warn', lineNumber, `imagen sin versión fija (${image}); usa un tag/digest`);
    }
    if (/^USER\s+/i.test(line)) hasUser = true;
    if (/^HEALTHCHECK\s+/i.test(line)) hasHealthcheck = true;
    if (/^(CMD|ENTRYPOINT)\s+/i.test(line)) hasCmd = true;
    if (/^ADD\s+/i.test(line)) add('warn', lineNumber, 'ADD puede descomprimir/descargar; prefiere COPY');
    if (/^(ENV|ARG)\s+.*\b(PASSWORD|PASSWD|TOKEN|SECRET|API[_-]?KEY|PRIVATE[_-]?KEY)\b\s*=/i.test(line) || (/^(ENV|ARG)\s+.*\b(PASSWORD|PASSWD|TOKEN|SECRET|API[_-]?KEY)\b/i.test(line) && /=/.test(line))) add('error', lineNumber, 'posible secreto en ENV/ARG: usa secretos del runtime, no de la imagen');
    if (/RUN\s+.*(curl|wget).*\|\s*(sh|bash)/i.test(line)) add('error', lineNumber, 'descarga y ejecución en RUN: fija versión y verifica checksum');
    if (/apt-get\s+update/i.test(line) && !/apt-get\s+install/i.test(line)) add('warn', lineNumber, 'apt-get update separado de install: puede quedar cache obsoleta');
    if (/chmod\s+777/i.test(line)) add('warn', lineNumber, 'chmod 777: permisos excesivos');
    if (/--no-check-certificate/.test(line)) add('error', lineNumber, 'deshabilita verificación TLS');
  }
  if (!hasUser) add('warn', null, 'sin directiva USER: el contenedor corre como root');
  if (!hasHealthcheck) add('info', null, 'sin HEALTHCHECK');
  if (!hasCmd) add('error', null, 'sin CMD/ENTRYPOINT: la imagen no arranca por sí sola');
  return findings;
}
function scan(rootInner) {
  const root = path.resolve(rootInner);
  if (!existsSync(root)) throw new Error(`la ruta no existe: ${root}`);
  if (!statSync(root).isDirectory()) throw new Error(`no es un directorio: ${root}`);
  if (!isAllowed(root)) throw new Error(`ruta no permitida: ${root} (revisa allowedPaths)`);
  const files = findDockerFiles(root);
  if (files.length === 0) return { root, files: [], findings: [] };
  const findings = [];
  for (const file of files) findings.push(...auditDockerfile(file, path.relative(root, file)));
  return { root, files: files.map((file) => path.relative(root, file)), findings };
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Docker Doctor: audita Dockerfile/compose de un proyecto local.',
    '',
    'Herramientas: status, scan.',
    '',
    'Reglas:',
    '- Solo lectura: no construye, no ejecuta docker y no modifica archivos.',
    '- Reporta hallazgos reales con archivo y línea; sin inventar.',
    '- Respeta allowedPaths.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-docker-doctor', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool(
    'status',
    { title: 'Estado', description: 'Rutas permitidas y modo.', inputSchema: z.object({}) },
    async () => textResult([`Rutas permitidas: ${allowedRoots().join(', ')}`, 'Modo: solo lectura'].join('\n')),
  );
  server.registerTool(
    'scan',
    { title: 'Auditar Docker', description: 'Audita Dockerfile/compose del proyecto.', inputSchema: z.object({ path: z.string().min(2) }) },
    async (args) => {
      const result = scan(args.path);
      if (result.files.length === 0) return textResult(`Sin Dockerfile/compose en ${result.root}.`);
      const errors = result.findings.filter((finding) => finding.severity === 'error').length;
      return textResult([
        `Archivos: ${result.files.join(', ')}`,
        `Hallazgos: ${result.findings.length} (errores: ${errors})`,
        '',
        ...(result.findings.length ? result.findings.map((finding) => `${finding.severity === 'error' ? '❌' : finding.severity === 'warn' ? '⚠️' : 'ℹ️'} ${finding.file}${finding.line ? `:${finding.line}` : ''} · ${finding.message}`) : ['✅ Sin hallazgos.']),
      ].join('\n'));
    },
  );
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log('docker-doctor listo');
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
