// Builds the published game into dist/: all game code joined into one closure (nothing reachable
// from the browser console), minified and name-mangled, with cache-busting file names.
// Usage: npm run build
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { minify } from 'terser';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const html = read('index.html');
const scripts = [...html.matchAll(/<script src="(src\/[^"]+\.js)"><\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('No game scripts found in index.html');

const joined = scripts.map((f) => `// ${f}\n${read(f)}`).join('\n');
const out = await minify(`(function () {\n${joined}\n})();`, {
  compress: { passes: 2, drop_debugger: true },
  mangle: true,
  format: { comments: false },
});
if (!out.code) throw new Error('Minify failed');
const appName = `app.${hash(out.code)}.js`;
fs.writeFileSync(path.join(dist, appName), out.code);

const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').trim();
const cssName = `style.${hash(css)}.css`;
fs.writeFileSync(path.join(dist, cssName), css);

const block = /<script src="config\.js"><\/script>[\s\S]*<script src="src\/main\.js"><\/script>/;
if (!block.test(html)) throw new Error('Script block markers not found in index.html');
const page = html
  .replace(block, `<script src="config.js"></script>\n<script src="${appName}"></script>`)
  .replace('href="style.css"', `href="${cssName}"`);
fs.writeFileSync(path.join(dist, 'index.html'), page);

const copy = (p) => {
  const src = path.join(root, p), dst = path.join(dist, p);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};
for (const p of ['config.js', 'manifest.webmanifest', 'icons', 'vendor', '.nojekyll']) copy(p);

const assets = ['./', 'index.html', appName, cssName, 'config.js', 'manifest.webmanifest', 'vendor/supabase.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
const sw = read('tools/sw.template.js')
  .replace('__CACHE__', `neon-swarm-${hash(out.code + css)}`)
  .replace('__ASSETS__', JSON.stringify(assets));
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`Built dist/: ${appName} (${kb(out.code.length)} from ${scripts.length} files, ${kb(joined.length)} source), ${cssName}`);
