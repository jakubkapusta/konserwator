import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Writes dist/sw.js. Precaches the app shell, the catalog and the thumbnails; the heavy per-painting files
 * (image.jpg, region maps) are cached the first time a painting is opened (runtime cache in the SW).
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'konserwator-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const heavy = (f: string) => /^p\/[^/]+\/(?!thumb\.jpg$)/.test(f);
      const list = files.filter((f) => f !== 'sw.js' && !heavy(f) && !/(cyrillic|greek|vietnamese)/.test(f) && !/\.woff$/.test(f));
      const hash = createHash('sha1');
      for (const f of files.filter((f) => f !== 'sw.js').sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 10);
      const sw = readFileSync('src/sw.template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(['./', ...list.map((f) => './' + f)]));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

/** Dev only: POST a PNG data URL to /__shot?name=x and it lands in work/shots/x.png (agent screenshots). */
function shots(): Plugin {
  return {
    name: 'konserwator-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          mkdirSync('work/shots', { recursive: true });
          writeFileSync(`work/shots/${name}.png`, Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2020', assetsInlineLimit: 0 },
  server: { port: 5196 },
  plugins: [serviceWorker(), shots()],
});
