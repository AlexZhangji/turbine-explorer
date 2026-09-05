import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist-labs', { recursive: true });
await copyFile('hosting/labs.html', 'dist-labs/index.html');
await copyFile('hosting/404.html', 'dist-labs/404.html');
await copyFile('hosting/_headers', 'dist-labs/_headers');
await copyFile('docs/preview.png', 'dist-labs/gas-turbine-preview.png');
await copyFile('hosting/robots.txt', 'dist-labs/robots.txt');
await copyFile('hosting/sitemap.xml', 'dist-labs/sitemap.xml');
console.log('Labs landing and /gas-turbine/ are ready in dist-labs/.');
