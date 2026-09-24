/* Сборка сайта для гостей.

   Исходники с комментариями лежат в DearBoxV1 — их правим, по ним читается
   README. Гостю уходит папка public: те же файлы, но без комментариев и
   сжатые. Корень сайта на хостинге — public.

   Запуск:
     npm run build            — собрать public заново
     node tools/build.mjs --check
                              — ничего не менять, только проверить, что
                                public совпадает со свежей сборкой
                                (так делает git перед каждым коммитом)

   Что делается с файлами:
     index.html, 404.html — комментарии убраны, пробелы схлопнуты, встроенные
                            стили и скрипт сжаты, блок menu-data пересобран
                            через JSON.parse → JSON.stringify (заодно
                            проверка, что в меню нет синтаксической ошибки);
     app.js, admin.js     — terser: без комментариев, имена укорочены;
     styles.css           — clean-css: без комментариев и лишних пробелов;
     всё остальное        — копируется как есть. PHP — тоже: его
                            выполняет сервер, гость видит только результат.
                            И stock.json — запасное наличие на случай, если
                            stock.php не ответит. */

import { readFile, writeFile, mkdir, rm, readdir, copyFile, mkdtemp } from 'node:fs/promises';
import { join, dirname, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { minify as minifyJs } from 'terser';
import { minify as minifyHtml } from 'html-minifier-terser';
import CleanCSS from 'clean-css';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'DearBoxV1');
const OUT = join(ROOT, 'public');
const CHECK = process.argv.includes('--check');

async function listFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFiles(p));
    else out.push(p);
  }
  return out.sort();
}

async function js(code) {
  const r = await minifyJs(code, {
    compress: true,
    mangle: true,
    format: { comments: false }
  });
  return r.code;
}

function css(code) {
  const r = new CleanCSS({ level: 1 }).minify(code);
  if (r.errors.length) throw new Error('styles.css: ' + r.errors.join('; '));
  return r.styles;
}

async function html(code, name) {
  // Меню — JSON внутри <script>. Минификатор HTML его не трогает, поэтому
  // сжимаем сами. Если в данных ошибка (лишняя запятая, «ёлочки»),
  // сборка остановится здесь, а не сломает сайт у гостей.
  code = code.replace(
    /(<script id="menu-data" type="application\/json">)([\s\S]*?)(<\/script>)/,
    (m, open, body, close) => {
      let data;
      try { data = JSON.parse(body); }
      catch (e) { throw new Error(name + ': ошибка в блоке menu-data — ' + e.message); }
      return open + JSON.stringify(data) + close;
    }
  );
  return minifyHtml(code, {
    removeComments: true,
    collapseWhitespace: true,
    conservativeCollapse: true,   // один пробел между словами остаётся всегда
    minifyCSS: true,
    minifyJS: true,
    keepClosingSlash: true
  });
}

/* Проверка результата: ни одного комментария не должно уехать гостю. */
function assertClean(file, text) {
  const ext = extname(file);
  if (ext === '.html' && /<!--/.test(text)) throw new Error(file + ': остался HTML-комментарий');
  if (ext === '.css' && /\/\*/.test(text)) throw new Error(file + ': остался CSS-комментарий');
  if (ext === '.js' && /\/\*|^\s*\/\//m.test(text)) throw new Error(file + ': остался JS-комментарий');
}

async function build(dest) {
  await rm(dest, { recursive: true, force: true });
  for (const src of await listFiles(SRC)) {
    const rel = relative(SRC, src);
    const to = join(dest, rel);
    await mkdir(dirname(to), { recursive: true });
    const ext = extname(src);
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      const text = await readFile(src, 'utf8');
      const out = ext === '.html' ? await html(text, rel)
                : ext === '.js' ? await js(text)
                : css(text);
      assertClean(rel, out);
      await writeFile(to, out, 'utf8');
    } else {
      await copyFile(src, to);
    }
  }
}

async function sameTree(a, b) {
  const la = (await listFiles(a)).map(p => relative(a, p));
  let lb;
  try { lb = (await listFiles(b)).map(p => relative(b, p)); } catch { return false; }
  if (la.join('\n') !== lb.join('\n')) return false;
  for (const rel of la) {
    const [x, y] = await Promise.all([readFile(join(a, rel)), readFile(join(b, rel))]);
    if (!x.equals(y)) return false;
  }
  return true;
}

if (CHECK) {
  const tmp = await mkdtemp(join(tmpdir(), 'dearbox-build-'));
  await build(tmp);
  const ok = await sameTree(tmp, OUT);
  await rm(tmp, { recursive: true, force: true });
  if (!ok) {
    console.error('public устарела: исходники в DearBoxV1 менялись после сборки.\n' +
                  'Запустите npm run build, добавьте public в коммит и повторите.');
    process.exit(1);
  }
  console.log('public совпадает со свежей сборкой.');
} else {
  await build(OUT);
  const size = async d => (await Promise.all((await listFiles(d)).map(p => readFile(p)))).reduce((n, b) => n + b.length, 0);
  console.log('Собрано в public. Исходники: ' + Math.round(await size(SRC) / 1024) +
              ' КБ, для гостей: ' + Math.round(await size(OUT) / 1024) + ' КБ.');
}
