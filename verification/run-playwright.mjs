import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = process.argv[2];
if (!config) {
  console.error('Usage: node verification/run-playwright.mjs <playwright-config>');
  process.exit(2);
}

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });

const port = await freePort();
const child = spawn(
  process.execPath,
  [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config', config, ...process.argv.slice(3)],
  {
    cwd: root,
    env: { ...process.env, MATCHRADAR_VERIFY_PORT: String(port) },
    stdio: 'inherit',
  },
);
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
