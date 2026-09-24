/* ==========================================================================
   Dear Box — сборка страницы из блока #menu-data в index.html
   Ни одной цены и ни одного названия в коде: всё приходит из этого блока.
   Без библиотек. Работает в любом современном браузере.

   Два языка. Русский основной, казахский лежит в тех же объектах в полях
   с суффиксом "_kk". За чтение отвечают две функции: t(ключ) — надписи
   интерфейса, tr(объект, поле) — данные. Обе сначала смотрят поле с
   суффиксом, а если его нет — берут русское. Перевода нет — страница
   просто остаётся русской, ничего не ломается.

   Здесь же живёт «рисовалка» напитков: по названию и разделу подбирается
   цвет, слои, тапиока, лёд и пенка — и собирается небольшая иллюстрация.
   Она видна там, где у позиции нет поля "img" или файл не загрузился;
   в остальных случаях в плитке стоит фотография из папки menu.
   ========================================================================== */
(function () {
  'use strict';

  var LS_THEME = 'dearbox:theme';
  var LS_LANG = 'dearbox:lang';
  var LS_CART = 'dearbox:cart';

  /* Языки сайта. Первый — основной: с него берутся данные, если перевода
     на втором ещё нет. Добавить третий — дописать код сюда и в index.html
     завести поля с этим суффиксом (name_xx, desc_xx и так далее). */
  var LANGS = ['ru', 'kk'];
  var lang = LANGS[0];

  /* Часовой пояс заведения зашит намеренно: меню должно показывать время
     Уральска, а не время на телефоне гостя. Asia/Almaty = UTC+5. */
  var TZ_OFFSET_MIN = 5 * 60;

  var D = null;
  var catIds = [];
  var visible = Object.create(null);
  var observer = null;
  var revealObs = null;
  var activeId = '';
  var collapsed = false;
  var docHeight = 0;

  /* Порог обязан совпадать с медиазапросом в styles.css: до 640px меню
     работает вкладками, с 640px — сплошной лентой с прокруткой. */
  var PHONE = 640;
  function isPhone() { return window.innerWidth < PHONE; }

  /* --- мелкие помощники -------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function icon(id, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls || 'ico');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  /* --- наличие ------------------------------------------------------------

     Что кончилось, лежит НЕ здесь и не в menu-data, а в отдельном файле
     stock.php — то, что отметили бариста в админке (/admin):

         { "updated": "2026-09-25T14:20:00+05:00", "out": ["Тайский Розовый Чай"] }

     Запасной вариант — stock.json рядом с сайтом, в том же формате (см.
     fetchStock ниже).

     Позиции названы так же, как в корзине и в блоке "first_time" — русским
     именем из меню. Отдельных номеров у позиций нет, заводить их только
     ради наличия не стоит: админка будет брать список из того же меню,
     поэтому имена всегда совпадут.

     "out_sizes" — задел: когда кончается не позиция, а один размер
     (стаканы 0,7 л есть, 0,5 л нет). Сейчас файл его не использует, но
     формат под это уже готов, и добавление не сломает ни старый файл,
     ни админку.

     Если файл не ответил — считаем, что есть всё. Отказ в безопасную
     сторону: пусть лучше бариста скажет «этого нет», чем сайт спрячет
     то, что на самом деле стоит на полке. */

  var STOCK = { out: {}, sizes: {} };

  function isOut(item) {
    return !!(item && STOCK.out[item.name]);
  }

  /* Пока всегда false — читает "out_sizes", которого в файле ещё нет. */
  function sizeOut(item, key) {
    var list = item && STOCK.sizes[item.name];
    return !!(list && list.indexOf(key) >= 0);
  }

  function readStock(raw) {
    var out = {}, sizes = {};
    if (raw && Array.isArray(raw.out)) {
      raw.out.forEach(function (name) {
        if (typeof name === 'string' && name) out[name] = true;
      });
    }
    if (raw && raw.out_sizes && typeof raw.out_sizes === 'object') {
      Object.keys(raw.out_sizes).forEach(function (name) {
        var v = raw.out_sizes[name];
        if (Array.isArray(v) && v.length) sizes[name] = v;
      });
    }
    var changed = JSON.stringify([STOCK.out, STOCK.sizes]) !== JSON.stringify([out, sizes]);
    STOCK.out = out;
    STOCK.sizes = sizes;
    return changed;
  }

  /* Запрос уходит сразу, а меню рисуется, не дожидаясь ответа: оно должно
     появляться на первом кадре, ради этого данные и лежат прямо в странице.
     Файл крошечный и с того же адреса, поэтому почти всегда успевает к
     первой отрисовке; если не успел — перерисуем, и только когда есть что
     менять (обычный день — пустой список, перерисовки не будет). */
  /* Сначала stock.php — то, что отметили бариста в админке (данные лежат
     вне корня сайта, напрямую их не прочитать). Если PHP не ответил или
     ответил не JSON-ом (сломался сервер, локальный просмотр без PHP) —
     stock.json из репозитория. Если и он не пришёл — всё в наличии. */
  function fetchStock() {
    function get(url) {
      return fetch(url, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); });
    }
    return get('stock.php').catch(function () { return get('stock.json'); });
  }

  function loadStock(done) {
    if (!window.fetch) { done(false); return; }
    var stop = setTimeout(function () { stop = null; done(false); }, 4000);
    fetchStock()
      .then(function (raw) {
        if (stop === null) return;          // уже ответили по таймауту
        clearTimeout(stop);
        done(readStock(raw));
      })
      .catch(function () {
        if (stop === null) return;
        clearTimeout(stop);
        done(false);
      });
  }

  /* Заголовок, у которого последнее слово подсвечено цветом. Так сделаны
     и тагланг на первом экране, и полоса «Таиланд в чашке»: в данных при
     этом лежит обычная строка без разметки, и её можно переводить, не
     заглядывая в код. Казахский порядок слов не мешает — подсвечивается
     то слово, которое в этом языке стоит последним. */
  function hlLast(node, text, cls) {
    node.textContent = '';
    var sp = String(text).lastIndexOf(' ');
    if (sp > 0) {
      node.appendChild(document.createTextNode(text.slice(0, sp + 1)));
      node.appendChild(el('span', cls, text.slice(sp + 1)));
    } else {
      node.appendChild(el('span', cls, text));
    }
  }

  /* Надпись интерфейса из раздела "texts". На неосновном языке сначала
     ищем ключ с суффиксом (skip_kk), и только потом падаем на русский —
     поэтому интерфейс можно переводить по одной строке. */
  function t(key) {
    if (!D || !D.texts) return '';
    if (lang !== LANGS[0] && D.texts[key + '_' + lang]) return D.texts[key + '_' + lang];
    return D.texts[key] || '';
  }

  /* Подстановка в надпись: у языков разный порядок слов. По-русски «от 930 ₸»
     и «откроем в 11:00», по-казахски «930 ₸ бастап» и «11:00-де ашыламыз» —
     число стоит с другой стороны. Поэтому место для него помечено в самой
     строке фигурными скобками, а не приклеивается к ней в коде. */
  function fill(tpl, value) {
    return String(tpl).replace(/\{\w+\}/, value);
  }

  /* Поле данных на текущем языке: tr(item, 'name') вернёт name_kk, если
     он заполнен, иначе — русское name. Ровно то же правило, что у t(). */
  function tr(obj, field) {
    if (!obj) return '';
    if (lang !== LANGS[0]) {
      var v = obj[field + '_' + lang];
      if (v != null && v !== '') return String(v);
    }
    return s(obj[field]);
  }

  /* Строка из данных. Пустое поле не должно превратиться в "undefined". */
  function s(v) { return v == null ? '' : String(v); }

  /* Подпись размера: гостю нужны литры, а не буквы. «M» и «L» остаются
     только ключами в данных и в корзине — на экран уходит объём из таблицы
     "sizes", а у позиции его можно переопределить полем "vols".

     Пустая строка в "vols" означает «объём не показывать»: у мороженого
     доли литра были бы прямой неправдой. Размера нет в таблице вообще —
     показываем ключ как раньше, чтобы новый «XL» ничего не сломал. */
  function sizeLabel(item, k) {
    var own = item && item.vols;
    if (own && Object.prototype.hasOwnProperty.call(own, k)) return s(own[k]);
    var table = (D && D.sizes) || {};
    return Object.prototype.hasOwnProperty.call(table, k) ? s(table[k]) : k;
  }

  function plural(n, one, few, many) {
    /* В казахском после числа существительное не меняется: 1 пікір,
       90 пікір. Русские формы «few» и «many» там просто не нужны. */
    if (lang !== LANGS[0]) return one;
    var d10 = n % 10, d100 = n % 100;
    if (d10 === 1 && d100 !== 11) return one;
    if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return few;
    return many;
  }

  function num(v) { return String(v).replace('.', ','); }

  function toMinutes(hhmm) {
    var p = String(hhmm || '').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function hoursOf() {
    var h = D.place.hours || {};
    return h.mon_sun || h[Object.keys(h)[0]] || { open: '00:00', close: '24:00' };
  }

  function splitAddress(addr) {
    var parts = String(addr || '').split(',').map(function (s) { return s.trim(); });
    if (parts.length < 2) return { street: addr || '', city: '' };
    var city = parts.pop();
    return { street: parts.join(', '), city: city };
  }

  /* --- тема -------------------------------------------------------------- */
  function setTheme(mode, save) {
    document.documentElement.setAttribute('data-theme', mode);
    var m = document.head.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', mode === 'dark' ? '#0E2A66' : '#163C8C');
    if (save) { try { localStorage.setItem(LS_THEME, mode); } catch (e) {} }
  }

  /* Выбранный язык запоминаем: гость вернулся по тому же QR — открылся
     тот язык, на котором он читал прошлый раз. */
  function initLang() {
    try {
      var saved = localStorage.getItem(LS_LANG);
      if (LANGS.indexOf(saved) > 0) lang = saved;
    } catch (e) {}
    bindLang();
  }

  /* На кнопке — текущий язык, а не тот, на который она переключит.
     Так надпись всегда совпадает с языком страницы и не может показаться
     ошибкой; что кнопка вообще переключает язык, видно по тому, что
     других языковых элементов на странице нет. */
  function renderLang() {
    var btn = $('#langBtn');
    $('#langTxt').textContent = t('lang_' + lang);
    btn.lang = lang;
    btn.setAttribute('aria-label', t('lang_switch'));
  }

  function bindLang() {
    $('#langBtn').addEventListener('click', function () {
      lang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
      try { localStorage.setItem(LS_LANG, lang); } catch (e) {}
      renderAll();
    });
  }

  function initTheme() {
    var btn = $('#themeBtn');
    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      setTheme(next, true);
      btn.setAttribute('aria-label', t('theme_toggle'));
    });
  }

  /* --- статус работы ----------------------------------------------------- */
  function placeNow() {
    var now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + TZ_OFFSET_MIN) * 60000);
  }

  function renderStatus() {
    var box = $('#status');
    var txt = $('#statusTxt');
    var h = hoursOf();
    var d = placeNow();
    var mins = d.getHours() * 60 + d.getMinutes();
    var open = toMinutes(h.open);
    var close = toMinutes(h.close);          // 24:00 -> 1440
    var state, label;

    if (mins < open || mins >= close) {
      state = 'closed';
      label = t('closed') + ' · ' + fill(t('opens_at'), h.open);
    } else if (close - mins <= 30) {
      /* За полчаса до закрытия называем время, а не «скоро»: человеку по
         дороге к стойке важно знать, успевает он или нет. */
      state = 'soon';
      label = t('open') + ' · ' + fill(t('closes_at'), h.close);
    } else {
      state = 'open';
      label = t('open');
    }
    box.setAttribute('data-state', state);
    txt.textContent = label;
  }

  /* --- шапка: схлопывание ------------------------------------------------ */
  /* Порог на схлопывание и на разворот разный: иначе шапка дёргается,
     когда палец стоит ровно на границе. */
  function onScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop;
    if (spyLocked) armSpyIdle();
    if (!collapsed && y > 30) {
      collapsed = true;
      document.documentElement.classList.add('is-collapsed');
    } else if (collapsed && y < 12) {
      collapsed = false;
      document.documentElement.classList.remove('is-collapsed');
    }
    // у самого низа страницы подсвечиваем последнюю категорию
    if (!spyLocked && !isPhone() && catIds.length && docHeight && y + window.innerHeight >= docHeight - 4) {
      setActive(catIds[catIds.length - 1]);
    }
  }

  function measureDoc() { docHeight = document.documentElement.scrollHeight; }

  /* --- иллюстрации напитков ---------------------------------------------- */
  /* Базовый цвет раздела. Внутри раздела его перебивает вкус из названия. */
  var ART_PAL = {
    'thai-milk-tea':    { base: '#D9812F', top: '#F6E2C4' },
    'jasmine-milk-tea': { base: '#CFE0A6', top: '#F5F1E0' },
    'thai-lemon-tea':   { base: '#EFB52E', top: '#FBE6A8' },
    'italian-coffee':   { base: '#4A2E1C', top: '#E7D2B6' },
    'fruit-americano':  { base: '#C6452F', top: '#F2A98D' },
    'fruit-mix':        { base: '#E87A2A', top: '#F8D79C' },
    'slush':            { base: '#79CFE6', top: '#E4F6FB' },
    'ice-cream':        { base: '#EFDDC2', top: '#FFF7EA' }
  };
  var ART_FALLBACK = { base: '#D9812F', top: '#F6E2C4' };

  /* Вкус ищется по названию позиции. */
  var ART_FLAVOR = [
    { re: /манго/i,         base: '#F2A22A', top: '#FFDD9B' },
    { re: /ананас/i,        base: '#EDC341', top: '#FAEDB2' },
    { re: /маракуй/i,       base: '#DE9018', top: '#F8D07B' },
    { re: /персик/i,        base: '#F0885F', top: '#FFCFB8' },
    { re: /виноград/i,      base: '#8A62C4', top: '#CDB4E9' },
    { re: /клубник/i,       base: '#DE4462', top: '#F6A9B8' },
    { re: /грейпфрут/i,     base: '#E2534A', top: '#F6A79C' },
    { re: /лимон/i,         base: '#E9C43F', top: '#F8ECA6' },
    { re: /зел[её]н/i,      base: '#79B067', top: '#D2E5C1' },
    { re: /розов/i,         base: '#E5738C', top: '#F8C3CE' },
    { re: /шоколад/i,       base: '#54301E', top: '#B98C64' },
    { re: /кокос/i,         base: '#E0D3BB', top: '#FFF8EE' },
    { re: /ванил/i,         base: '#E3CB9B', top: '#F9F0DB' },
    { re: /османтус/i,      base: '#DDAE4A', top: '#F5E1B0' },
    { re: /карамел|брюле/i, base: '#C07B2B', top: '#EFD5A8' },
    { re: /сливочн/i,       base: '#C99A5C', top: '#F6E8D2' },
    { re: /красн/i,         base: '#D2542F', top: '#F3B499' },
    { re: /жасмин/i,        base: '#CFE0A6', top: '#F5F1E0' }
  ];

  var STRAW = '#E85D75';
  var PEARL = '#35210F';
  var FOAM = '#FFFDF7';

  /* --- корзина ----------------------------------------------------------

     Лежит в localStorage и переживает перезагрузку. Позиция опознаётся по
     русскому названию плюс размер и температура: название — то же поле, по
     которому позиции ищет блок "first_time", так что отдельный код заводить
     не пришлось. Перевод на казахский ключ не меняет: в корзине хранится
     русское имя, а на экран уходит tr().

     Всё, что прочитано из хранилища, проверяется по текущему меню. Позицию
     сняли с продажи или переименовали — строка молча выпадает. Показать
     заказ, которого больше нет в меню, хуже, чем показать его без строки. */

  function cartKey(name, size, temp) {
    return name + '|' + (size || '') + '|' + (temp || '');
  }

  function cartRead() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_CART) || 'null'); } catch (e) {}
    if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return [];
    return raw.items.filter(function (r) {
      return r && typeof r.name === 'string' && r.qty > 0;
    });
  }

  function cartWrite(rows) {
    try {
      if (rows.length) localStorage.setItem(LS_CART, JSON.stringify({ v: 1, items: rows }));
      else localStorage.removeItem(LS_CART);
    } catch (e) {}
    renderCartBtn();
  }

  /* Строки корзины, сверенные с меню: цена и название берутся оттуда,
     из хранилища приходят только выбор и количество. */
  function cartLines() {
    var out = [];
    cartRead().forEach(function (r) {
      var found = findItem(r.name);
      if (!found) return;
      var price = (found.item.prices || {})[r.size];
      if (price == null) return;
      out.push({
        key: cartKey(r.name, r.size, r.temp),
        name: r.name,
        item: found.item,
        catId: found.catId,
        size: r.size,
        temp: r.temp,
        qty: r.qty,
        price: price,
        sum: price * r.qty,
        /* Кончившуюся позицию из корзины НЕ выбрасываем, в отличие от
           снятой с меню. Человек собрал заказ вечером, открыл утром —
           если строка исчезнет сама, а сумма изменится, он решит, что
           сайт сломался. Пусть видит строку, видит почему она серая и
           уберёт сам. */
        out: isOut(found.item)
      });
    });
    return out;
  }

  /* Итог считается без того, чего нет: это сумма, которую человек
     действительно заплатит. */
  function cartTotal() {
    return cartLines().reduce(function (n, l) { return l.out ? n : n + l.sum; }, 0);
  }

  function cartHasOut() {
    return cartLines().some(function (l) { return l.out; });
  }

  function cartQty(name, size, temp) {
    var k = cartKey(name, size, temp);
    var row = cartRead().filter(function (r) {
      return cartKey(r.name, r.size, r.temp) === k;
    })[0];
    return row ? row.qty : 0;
  }

  /* qty = 0 убирает строку. Порядок остальных сохраняется: корзина должна
     выглядеть так же, как её собирали. */
  function cartSet(name, size, temp, qty) {
    var k = cartKey(name, size, temp);
    var rows = cartRead();
    var hit = false;
    rows = rows.filter(function (r) {
      if (cartKey(r.name, r.size, r.temp) !== k) return true;
      hit = true;
      r.qty = qty;
      return qty > 0;
    });
    if (!hit && qty > 0) rows.push({ name: name, size: size, temp: temp, qty: qty });
    cartWrite(rows);
  }

  function renderCartBtn() {
    var n = cartLines().length;
    var box = $('#cartCount');
    if (!box) return;
    box.textContent = String(n);
    $('#cartBtn').setAttribute('data-empty', n ? 'false' : 'true');
    $('#cartBtn').setAttribute('aria-label', t('cart') + ': ' + n);
  }

  /* Устойчивое число из названия: два соседних напитка одного вкуса не
     должны выглядеть как один и тот же стакан, скопированный дважды. */
  function hashOf(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
    return h;
  }

  function artSpec(item, catId) {
    /* Здесь намеренно русское item.name, а не tr(): цвет и начинка
       подбираются регулярками по русским словам («жемчуж», «попкорн»).
       Рисунок всё равно декоративный и виден только там, где нет фото. */
    var n = item.name || '';
    var pal = ART_PAL[catId] || ART_FALLBACK;
    var base = pal.base, top = pal.top;

    for (var i = 0; i < ART_FLAVOR.length; i++) {
      if (ART_FLAVOR[i].re.test(n)) { base = ART_FLAVOR[i].base; top = ART_FLAVOR[i].top; break; }
    }

    var shape = catId === 'slush' ? 'slush' : (catId === 'ice-cream' ? 'sundae' : 'cup');
    var h = hashOf(n);

    return {
      shape: shape,
      base: base,
      top: top,
      milkH: 15 + (h % 7),            // толщина молочного слоя
      tilt: 9 + (h % 9),              // наклон трубочки
      jitter: (h % 5) - 2,            // уровень напитка
      /* сливочный или молочный верх — у молочных чаёв, латте и жасмина */
      milk: shape !== 'sundae' && catId !== 'fruit-mix' && (
        catId === 'thai-milk-tea' || catId === 'jasmine-milk-tea' ||
        /латте|молочн|сливочн|жасмин/i.test(n)),
      /* тёмный кофейный низ: без него латте с кокосом или ванилью
         выглядит как молоко, а не как кофе */
      coffee: catId === 'fruit-americano' || catId === 'italian-coffee',
      foam: /сыр|брюле|попкорн|сандей|крем/i.test(n),
      pearls: /жемчуж|тапиок/i.test(n),
      popcorn: /попкорн/i.test(n),
      ice: catId === 'thai-lemon-tea' || catId === 'fruit-americano' || catId === 'fruit-mix' || /американо/i.test(n),
      straw: shape !== 'sundae'
    };
  }

  /* Одна иллюстрация — одна строка SVG. Цвета берутся только из констант
     выше, поэтому подставлять их в разметку безопасно. */
  function drinkArt(item, catId) {
    var s = artSpec(item, catId);
    var body, rim, extra = '', liquid = '';

    if (s.shape === 'slush') {
      body  = 'M17 34 L23 82 A6.5 6.5 0 0 0 29.5 88.5 H42.5 A6.5 6.5 0 0 0 49 82 L55 34 Z';
      rim   = '<ellipse class="rim" cx="36" cy="34" rx="19" ry="3.8"/>';
      extra = '<path class="glass" d="M17 34 C17 15 25.5 5 36 5 C46.5 5 55 15 55 34 Z"/>' +
              '<path class="line" fill="none" stroke-width="1.6" d="M17 34 C17 15 25.5 5 36 5 C46.5 5 55 15 55 34"/>' +
              '<path fill="#FFF6E6" d="M25 30 C27 17 33 11 39 11 C46 11 51 19 51 30 Z" opacity=".95"/>';
    } else if (s.shape === 'sundae') {
      body  = 'M15 44 L21 66 A8 8 0 0 0 29 72 H43 A8 8 0 0 0 51 66 L57 44 Z';
      rim   = '<ellipse class="rim" cx="36" cy="44" rx="21" ry="4"/>';
    } else {
      body  = 'M13 24 L20.5 82 A6.5 6.5 0 0 0 27 88.5 H45 A6.5 6.5 0 0 0 51.5 82 L59 24 Z';
      rim   = '<ellipse class="rim" cx="36" cy="24" rx="23" ry="4.4"/>';
    }

    /* --- слои жидкости, всё внутри клипа стакана --- */
    if (s.shape === 'sundae') {
      liquid += '<rect x="10" y="44" width="52" height="40" fill="' + s.base + '"/>';
    } else {
      var y0 = (s.shape === 'slush' ? 36 : 26) + s.jitter;
      liquid += '<rect x="8" y="' + y0 + '" width="56" height="64" fill="' + s.base + '"/>';
      if (s.milk) {
        liquid += '<rect x="8" y="' + y0 + '" width="56" height="' + s.milkH + '" fill="' + s.top + '"/>' +
                  '<path fill="' + s.top + '" opacity=".55" d="M8 ' + (y0 + s.milkH) +
                  ' q7 6 14 0 t14 0 t14 0 t14 0 v-6 H8 Z"/>';
      }
      if (s.coffee) {
        liquid += '<rect x="8" y="66" width="56" height="24" fill="#3E2717"/>' +
                  '<rect x="8" y="64" width="56" height="3" fill="#3E2717" opacity=".45"/>';
      }
      if (s.shape === 'slush') {
        liquid += '<g fill="#FFFFFF" opacity=".45">' +
                  '<circle cx="28" cy="50" r="2.6"/><circle cx="40" cy="58" r="2.2"/>' +
                  '<circle cx="33" cy="68" r="2.8"/><circle cx="45" cy="72" r="2"/>' +
                  '<circle cx="26" cy="64" r="1.8"/><circle cx="38" cy="44" r="1.8"/></g>';
      }
    }

    if (s.ice) {
      liquid += '<g fill="#FFFFFF" opacity=".5">' +
                '<rect x="22" y="42" width="13" height="13" rx="4" transform="rotate(18 28 48)"/>' +
                '<rect x="38" y="54" width="12" height="12" rx="4" transform="rotate(-14 44 60)"/>' +
                '<rect x="26" y="64" width="12" height="12" rx="4" transform="rotate(28 32 70)"/></g>';
    }
    if (s.pearls) {
      var pj = s.jitter;
      liquid += '<g fill="' + PEARL + '">' +
                '<circle cx="26" cy="78" r="3.4"/><circle cx="34" cy="' + (81 + pj * 0.4) + '" r="3.4"/>' +
                '<circle cx="43" cy="78.5" r="3.4"/><circle cx="' + (30 + pj) + '" cy="72" r="3"/>' +
                '<circle cx="39" cy="72.5" r="3"/><circle cx="' + (46 + pj) + '" cy="71" r="2.6"/></g>';
    }
    if (s.foam && s.shape !== 'sundae') {
      var fy = (s.shape === 'slush' ? 36 : 26) + s.jitter;
      liquid += '<rect x="8" y="' + (fy - 6) + '" width="56" height="21" fill="' + FOAM + '"/>' +
                '<g fill="' + FOAM + '"><circle cx="16" cy="' + (fy + 15) + '" r="6"/>' +
                '<circle cx="28" cy="' + (fy + 15) + '" r="6"/>' +
                '<circle cx="40" cy="' + (fy + 15) + '" r="6"/>' +
                '<circle cx="52" cy="' + (fy + 15) + '" r="6"/></g>' +
                '<path fill="#E4CDA6" opacity=".5" d="M8 ' + (fy + 19) +
                ' q6 6 12 0 t12 0 t12 0 t12 0 v2 H8 Z"/>';
    }
    liquid += '<rect x="6" y="4" width="60" height="88" fill="url(#g-shine)"/>';

    /* --- то, что выше стакана --- */
    if (s.shape === 'sundae') {
      extra += '<ellipse class="shadow" cx="36" cy="88" rx="15" ry="3"/>' +
               '<rect class="glass" x="32.5" y="70" width="7" height="16"/>' +
               '<ellipse class="rim" cx="36" cy="87" rx="13" ry="3.4"/>' +
               '<g><circle cx="27" cy="37" r="10" fill="' + s.base + '"/>' +
               '<circle cx="45" cy="37" r="10" fill="' + s.top + '"/>' +
               '<circle cx="36" cy="27" r="10.5" fill="' + s.base + '"/>' +
               '<circle cx="32" cy="23" r="3" fill="#FFFFFF" opacity=".35"/></g>' +
               '<path class="line" fill="none" stroke-width="1.4" d="M36 16.5 C39 10 44 8 47 8"/>' +
               '<circle cx="35" cy="17" r="3.6" fill="#D8354F"/>' +
               '<rect x="48" y="12" width="5" height="26" rx="1.6" fill="#E0AC6C" transform="rotate(16 50 25)"/>';
    }
    if (s.popcorn) {
      extra += '<g fill="#F6DFAD"><circle cx="24" cy="19" r="6"/><circle cx="36" cy="14" r="6.5"/>' +
               '<circle cx="48" cy="19" r="6"/><circle cx="30" cy="8" r="5.4"/>' +
               '<circle cx="43" cy="7" r="5.4"/><circle cx="36" cy="20" r="5.6"/></g>' +
               '<g fill="#FFFFFF" opacity=".45"><circle cx="33" cy="11" r="2"/>' +
               '<circle cx="46" cy="17" r="1.7"/><circle cx="22" cy="17" r="1.7"/></g>';
    }

    var straw = '';
    if (s.straw) {
      var sy = s.shape === 'slush' ? 14 : 6;
      straw = '<g transform="rotate(' + s.tilt + ' 45 34)">' +
              '<rect x="41.5" y="' + sy + '" width="7" height="' + (58 - sy) + '" rx="3.5" fill="' + STRAW + '"/>' +
              '<rect x="43" y="' + (sy + 2) + '" width="2.2" height="' + (52 - sy) + '" rx="1.1" fill="#FFFFFF" opacity=".45"/></g>';
    }

    return '<svg viewBox="0 0 72 96" xmlns="http://www.w3.org/2000/svg">' +
           (s.shape === 'sundae' ? '' : '<ellipse class="shadow" cx="36" cy="90" rx="19" ry="3"/>') +
           '<path class="glass" d="' + body + '"/>' +
           '<g clip-path="url(#clip-' + s.shape + ')">' + liquid + '</g>' +
           straw + rim +
           '<path class="line" fill="none" stroke-width="1.8" stroke-linejoin="round" d="' + body + '"/>' +
           extra +
           '</svg>';
  }

  /* Фото напитка из папки menu. Если файла нет или он не загрузился,
     на его месте остаётся рисунок — так плитка не пустеет никогда. */
  function artBox(item, catId) {
    var box = el('div', 'art');
    box.setAttribute('aria-hidden', 'true');   // картинка декоративная

    function drawFallback() {
      box.classList.remove('art-photo');
      box.innerHTML = drinkArt(item, catId);
    }

    if (item.img) {
      var img = el('img');
      img.src = item.img;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = drawFallback;
      box.classList.add('art-photo');
      box.appendChild(img);
    } else {
      drawFallback();
    }
    return box;
  }

  /* --- всплывающие окна ---------------------------------------------------

     Окон два — выбор напитка и корзина, — но оболочка одна. Открытое окно
     кладёт запись в историю браузера: тогда кнопка «назад» на телефоне
     закрывает окно, а не уносит со страницы. */

  var modalOpen = false;
  var modalOnClose = null;

  function openModal(build, onClose) {
    closeModal(true);
    var body = $('#modalBody');
    body.textContent = '';
    build(body);
    modalOnClose = onClose || null;
    modalOpen = true;
    // подпись крестика — из texts: в разметке она осталась бы русской
    $('#modalX').setAttribute('aria-label', t('close'));
    $('#mask').hidden = false;
    document.body.classList.add('is-locked');
    history.pushState({ dbModal: 1 }, '');
    var first = $('.modal [autofocus]') || $('#modalX');
    if (first) first.focus();
  }

  /* silent = окно уже закрыто самой историей, трогать её second раз нельзя */
  function closeModal(silent) {
    if (!modalOpen) return;
    modalOpen = false;
    $('#mask').hidden = true;
    document.body.classList.remove('is-locked');
    $('#modalBody').textContent = '';
    var f = modalOnClose;
    modalOnClose = null;
    if (f) f();
    if (!silent && history.state && history.state.dbModal) history.back();
  }

  function initModal() {
    $('#cartBtn').addEventListener('click', openCartModal);
    $('#modalX').addEventListener('click', function () { closeModal(); });
    $('#mask').addEventListener('mousedown', function (e) {
      if (e.target === $('#mask')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (!modalOpen) return;
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key !== 'Tab') return;
      // фокус не должен уходить под окно, пока оно открыто
      var f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', $('#modal'))
        .filter(function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.addEventListener('popstate', function () {
      if (modalOpen) closeModal(true);
      syncOrder();
    });
    window.addEventListener('hashchange', syncOrder);
  }

  /* --- окно выбора напитка ------------------------------------------------

     Открывается по нажатию на карточку. Спрашивает размер, подачу и
     количество — те из трёх, где есть выбор; у 17 позиций меню выбора нет
     вообще, и окно всё равно открывается: предсказуемое лишнее нажатие
     лучше, чем карточки, ведущие себя по-разному.

     Окно не «добавляет ещё», а задаёт количество выбранного варианта.
     Поэтому повторное нажатие на карточку показывает то, что уже лежит
     в корзине, и его можно поправить. */

  function tempsOf(item) {
    return (item.temp || []).filter(function (k) { return k === 'cold' || k === 'hot'; });
  }

  function pickRow(label, controls) {
    var row = el('div', 'pick');
    row.appendChild(el('span', 'pick-l', label));
    var box = el('div', 'pick-b');
    controls.forEach(function (c) { box.appendChild(c); });
    row.appendChild(box);
    return row;
  }

  function openItemModal(item, catId) {
    var sizes = Object.keys(item.prices || {});
    var temps = tempsOf(item);
    if (!sizes.length) return;
    // карточка такой позиции и так не нажимается — это на случай вызова
    // из другого места, например из блока «Первый раз у нас?»
    if (isOut(item)) return;

    var size = sizes[0], temp = temps[0] || '', qty = 1;

    /* Если такой напиток уже в корзине — открываем его, а не чистый бланк. */
    var inCart = cartRead().filter(function (r) { return r.name === item.name; })[0];
    if (inCart && sizes.indexOf(inCart.size) >= 0) {
      size = inCart.size;
      if (temps.indexOf(inCart.temp) >= 0) temp = inCart.temp;
      qty = inCart.qty;
    }

    openModal(function (body) {
      var head = el('div', 'modal-head');
      if (item.img) {
        var pic = el('div', 'art art-photo');
        var im = el('img');
        im.src = item.img;
        im.alt = '';
        im.decoding = 'async';
        pic.appendChild(im);
        head.appendChild(pic);
      }
      var ht = el('div');
      var h3 = el('h2', 'modal-t', tr(item, 'name'));
      h3.id = 'modalTitle';
      ht.appendChild(h3);
      var desc = tr(item, 'desc');
      if (desc) ht.appendChild(el('p', 'modal-d', desc));
      head.appendChild(ht);
      body.appendChild(head);

      var sum = el('p', 'modal-sum');
      var add = el('button', 'act act-main', t('add_to_cart'));
      add.type = 'button';
      add.setAttribute('autofocus', '');

      function redraw() {
        var price = item.prices[size];
        sum.textContent = price + ' ' + D.place.currency + ' × ' + qty +
                          '  =  ' + (price * qty) + ' ' + D.place.currency;
        $$('.pick-o', body).forEach(function (b) {
          var on = (b.dataset.size && b.dataset.size === size) ||
                   (b.dataset.temp && b.dataset.temp === temp);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        $('.qty-n', body).textContent = String(qty);
        $('.qty-m', body).disabled = qty <= 1;
      }

      /* Ряды «Размер» и «Подача» стоят всегда, даже когда выбирать нечего.
         Единственный вариант рисуем серой кнопкой без нажатия: гость видит,
         что ему достанется, и окно у всех позиций выглядит одинаково —
         у «Манго Жасмин» та же разметка, что у «Жемчужного Тая». */
      /* Ряд «Размер» пропускаем только в одном случае: размер один И объём
         у него скрыт. Так у мороженого не появляется строка, которой нечего
         сказать, — там ни выбора, ни литров. */
      if (sizes.length > 1 || sizeLabel(item, sizes[0])) {
        body.appendChild(pickRow(t('choose_size'), sizes.map(function (k) {
          var b = el('button', 'pick-o');
          b.type = 'button';
          b.dataset.size = k;
          var label = sizeLabel(item, k);
          if (label) b.appendChild(el('i', null, label));
          b.appendChild(document.createTextNode(item.prices[k] + ' ' + D.place.currency));
          b.title = (t('size_' + k.toLowerCase()) || k) + ' (' + k + ')';
          if (sizes.length < 2) {
            b.disabled = true;
          } else {
            b.addEventListener('click', function () {
              size = k;
              // у каждого варианта своё количество в корзине
              qty = cartQty(item.name, size, temp) || 1;
              redraw();
            });
          }
          return b;
        })));
      }

      if (temps.length) {
        body.appendChild(pickRow(t('choose_temp'), temps.map(function (k) {
          var b = el('button', 'pick-o pick-' + k);
          b.type = 'button';
          b.dataset.temp = k;
          b.appendChild(icon(k === 'hot' ? 'i-flame' : 'i-snow'));
          b.appendChild(document.createTextNode(t('temp_' + k)));
          if (temps.length < 2) {
            b.disabled = true;
          } else {
            b.addEventListener('click', function () {
              temp = k;
              qty = cartQty(item.name, size, temp) || 1;
              redraw();
            });
          }
          return b;
        })));
      }

      var minus = el('button', 'qty-b qty-m', '\u2212');
      minus.type = 'button';
      minus.setAttribute('aria-label', t('minus'));
      minus.addEventListener('click', function () { if (qty > 1) { qty--; redraw(); } });
      var plus = el('button', 'qty-b', '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', t('plus'));
      plus.addEventListener('click', function () { if (qty < 99) { qty++; redraw(); } });
      var num = el('span', 'qty-n', String(qty));
      body.appendChild(pickRow(t('choose_qty'), [minus, num, plus]));

      body.appendChild(sum);

      add.addEventListener('click', function () {
        cartSet(item.name, size, temp, qty);
        bumpCart();
        closeModal();
      });
      body.appendChild(add);

      redraw();
    });
  }

  /* --- окно корзины -------------------------------------------------------

     Минус до нуля не выкидывает строку, а гасит её: промахнуться пальцем
     легко, а восстанавливать заказ по памяти неприятно. Плюс возвращает
     позицию на место. Закрыли окно любым способом — потухшие пропали
     насовсем.

     Из localStorage позиция при этом удаляется сразу, а потухшая строка
     живёт только в переменной, пока окно открыто. Поэтому перезагрузка,
     закрытая вкладка и упавший браузер подчищают всё сами: чинить
     «нулевые» строки в хранилище не приходится, их там не бывает. */

  var ghosts = [];          // потухшие строки, только на время окна
  var cartOrder = [];       // порядок строк, чтобы потухшая не прыгала вниз

  function ghostOf(key) {
    return ghosts.filter(function (g) { return g.key === key; })[0];
  }

  /* Подпись под названием: показываем всё, чему есть что сказать, а не
     только то, из чего человек выбирал.

     Раньше параметр скрывался, когда вариант был один — и «Сырный Тай»,
     у которого в меню только холодный, оставался в корзине без подачи,
     хотя в окне выбора серая кнопка «Холодный» у него стоит. Получалось,
     что окно и корзина говорят разное. Теперь правило одно: есть значение
     — оно видно и в окне, и в корзине, и в сообщении баристе.

     Молчим только там, где значения действительно нет: у мороженого объём
     скрыт полем "vols", и размер у него не пишется. */
  function variantText(line) {
    var parts = [];
    var vol = sizeLabel(line.item, line.size);
    if (vol) parts.push(vol);
    if (line.temp) parts.push(t('temp_' + line.temp));
    return parts.join(' · ');
  }

  function cartRowNode(line, dead) {
    var gone = line.out && !dead;          // есть в корзине, но кончилась
    var row = el('div', 'crt' + (dead || gone ? ' crt-off' : ''));

    if (line.item.img) {
      var pic = el('div', 'art art-photo');
      var im = el('img');
      im.src = line.item.img;
      im.alt = '';
      im.decoding = 'async';
      pic.appendChild(im);
      row.appendChild(pic);
    }

    var mid = el('div', 'crt-b');
    mid.appendChild(el('p', 'crt-n', tr(line.item, 'name')));
    /* У мороженого ни размера, ни выбора подачи — подписи нет вообще,
       и пустая строка только раздвинула бы строку заказа. */
    var v = dead ? t('removed') : (gone ? t('out_of_stock') : variantText(line));
    if (v) mid.appendChild(el('p', 'crt-v', v));
    row.appendChild(mid);

    var right = el('div', 'crt-r');

    var box = el('div', 'crt-q');
    var minus = el('button', 'qty-b qty-s', '\u2212');
    minus.type = 'button';
    minus.setAttribute('aria-label', t('minus'));
    minus.disabled = dead;
    minus.addEventListener('click', function () {
      var next = line.qty - 1;
      cartSet(line.name, line.size, line.temp, next);
      if (next <= 0 && !ghostOf(line.key)) ghosts.push(line);
      drawCart();
    });
    var num = el('span', 'qty-n', String(dead ? 0 : line.qty));
    var plus = el('button', 'qty-b qty-s', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', t('plus'));
    plus.disabled = gone;                  // добавить того, чего нет, нельзя
    plus.addEventListener('click', function () {
      cartSet(line.name, line.size, line.temp, (dead ? 0 : line.qty) + 1);
      ghosts = ghosts.filter(function (g) { return g.key !== line.key; });
      drawCart();
    });
    box.appendChild(minus);
    box.appendChild(num);
    box.appendChild(plus);
    right.appendChild(box);

    right.appendChild(el('p', 'crt-s', (dead || gone) ? '' : line.sum + ' ' + D.place.currency));
    row.appendChild(right);
    return row;
  }

  /* Перерисовывает содержимое окна корзины на месте. */
  function drawCart() {
    var body = $('#modalBody');
    if (!body || !modalOpen) return;
    body.textContent = '';

    var h2 = el('h2', 'modal-t', t('cart'));
    h2.id = 'modalTitle';
    body.appendChild(h2);

    var lines = cartLines();
    var byKey = {};
    lines.forEach(function (l) { byKey[l.key] = l; });

    // новые строки могли появиться, пока окно открыто, — дописываем в конец
    lines.forEach(function (l) {
      if (cartOrder.indexOf(l.key) < 0) cartOrder.push(l.key);
    });

    var list = el('div', 'crt-list');
    var shown = 0;
    cartOrder.forEach(function (key) {
      var live = byKey[key];
      if (live) { list.appendChild(cartRowNode(live, false)); shown++; return; }
      var g = ghostOf(key);
      if (g) list.appendChild(cartRowNode(g, true));
    });

    if (!shown && !ghosts.length) {
      var empty = el('div', 'crt-empty');
      empty.appendChild(icon('i-cart'));
      empty.appendChild(el('p', 'crt-empty-t', t('cart_empty')));
      empty.appendChild(el('p', 'crt-empty-x', t('cart_empty_hint')));
      body.appendChild(empty);
      return;
    }

    body.appendChild(list);

    var total = el('div', 'crt-total');
    total.appendChild(el('span', null, t('cart_total')));
    total.appendChild(el('b', null, cartTotal() + ' ' + D.place.currency));
    body.appendChild(total);
    body.appendChild(el('p', 'crt-note', t('cart_no_delivery')));

    /* Разбираться с кончившейся позицией нужно здесь: минус и плюс есть
       только в корзине, на экране заказа их нет. Поэтому и предупреждение,
       и запрет идти дальше стоят в этом окне. */
    if (cartHasOut()) body.appendChild(el('p', 'crt-warn', t('out_note')));
    if (!orderOpen()) body.appendChild(el('p', 'crt-warn', hoursText(t('order_closed'))));

    var go = el('button', 'act act-main', t('cart_order'));
    go.type = 'button';
    go.disabled = !shown || cartHasOut() || !orderOpen();
    go.addEventListener('click', function () {
      closeModal(true);
      // запись окна в истории заменяем экраном заказа: тогда «назад»
      // с него возвращает в меню, а не в исчезнувшее окно
      history.replaceState({}, '', '#order');
      showOrder();
    });
    body.appendChild(go);
  }

  function openCartModal() {
    ghosts = [];
    cartOrder = cartLines().map(function (l) { return l.key; });
    openModal(function () { /* содержимое рисует drawCart */ }, function () {
      ghosts = [];
      cartOrder = [];
    });
    drawCart();
  }

  /* --- экран заказа -------------------------------------------------------

     Отдельного файла нет намеренно: экран прячет меню и показывает себя,
     поэтому шапка, язык, тема и стили переиспользуются целиком. Адрес
     «#order» делает его настоящей страницей — им можно поделиться, и
     кнопка «назад» возвращает в меню. */

  function orderOn() { return location.hash === '#order'; }

  /* Что человек ввёл в форме. Живёт в переменных, а не в localStorage:
     телефон и адрес — личные данные, и складывать их в браузер без нужды
     не стоит. Побочный плюс — перерисовка экрана (например, при смене
     языка) введённое не теряет. */
  var orderPhone = '';
  var orderAddr = '';
  var orderMode = 'delivery';                // 'delivery' или 'pickup'
  var orderTime = '';                        // самовывоз: «14:30»
  var orderTouched = { phone: false, addr: false, time: false };

  /* Самовывоз. Первое время в списке — не раньше чем через PICKUP_LEAD
     минут: оператору надо прочитать WhatsApp и выставить счёт, баристе —
     приготовить. Последнее — за PICKUP_STEP до закрытия, чтобы гость
     успел забрать. */
  var PICKUP_LEAD = 20;
  var PICKUP_STEP = 15;

  function nowMinutes() {
    var d = placeNow();
    return d.getHours() * 60 + d.getMinutes();
  }

  /* Заказы принимаются только в часы работы — по времени Уральска, как
     и точка «Открыто / Закрыто» в шапке. */
  function orderOpen() {
    var h = hoursOf();
    var m = nowMinutes();
    return m >= toMinutes(h.open) && m < toMinutes(h.close);
  }

  function hhmm(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function pickupSlots() {
    if (!orderOpen()) return [];
    var last = toMinutes(hoursOf().close) - PICKUP_STEP;
    var first = Math.ceil((nowMinutes() + PICKUP_LEAD) / PICKUP_STEP) * PICKUP_STEP;
    var out = [];
    for (var m = first; m <= last; m += PICKUP_STEP) out.push(hhmm(m));
    return out;
  }

  function hoursText(tpl) {
    var h = hoursOf();
    return String(tpl).replace('{open}', h.open).replace('{close}', h.close);
  }

  function digitsOf(v) { return String(v).replace(/\D/g, ''); }

  /* Пустая строка на выходе = всё в порядке. */
  function phoneError(raw) {
    var d = digitsOf(raw);
    if (!d) return t('order_required');
    if (d.charAt(0) !== '7') return t('order_phone_start');
    if (d.length !== 11) return t('order_phone_len');
    return '';
  }

  function addrError(raw) {
    var v = String(raw).trim();
    if (!v) return t('order_required');
    if (v.length < 10) return t('order_addr_short');
    if (!/\d/.test(v)) return t('order_addr_digit');      // нет номера дома
    if (!/[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(v)) return t('order_addr_text');
    return '';
  }

  /* Вторая проверка — про наличие: позиция могла кончиться, пока человек
     заполнял форму. Тогда «Оформить» гаснет, и в WhatsApp не уедет заказ
     на то, чего нет. */
  /* Время могло «протухнуть», пока страница висела открытой: выбрали
     12:00, а отправляют в 11:55. Поэтому сверяемся со списком, который
     считается заново на каждой проверке. */
  function timeError(v) {
    if (!v) return t('order_time_pick');
    if (pickupSlots().indexOf(v) < 0) return t('order_time_late');
    return '';
  }

  function orderReady() {
    if (!orderOpen() || cartHasOut() || phoneError(orderPhone)) return false;
    return orderMode === 'pickup' ? !timeError(orderTime) : !addrError(orderAddr);
  }

  /* Раскладываем 11 цифр в привычный вид. Делаем это на выходе из поля, а
     не на каждой набранной цифре: маска «на лету» воюет с курсором, стоит
     человеку встать в середину строки или вставить номер из буфера. */
  function phoneFormat(raw) {
    var d = digitsOf(raw);
    if (d.length !== 11 || d.charAt(0) !== '7') return raw;
    return '+7 (' + d.slice(1, 4) + ') ' + d.slice(4, 7) + ' ' +
           d.slice(7, 9) + ' ' + d.slice(9, 11);
  }

  /* Прячем только верхние блоки страницы: всё, что внутри .shell —
     лента разделов, меню, «Первый раз у нас?», контакты — уезжает
     вместе с ней, и разбираться, что из этого было скрыто до заказа,
     не приходится. */
  var ORDER_HIDES = ['.hero', '.about', '.shell', '.ftr'];

  function showOrder() {
    ORDER_HIDES.forEach(function (sel) { $(sel).hidden = true; });
    $('#order').hidden = false;
    window.scrollTo(0, 0);
    drawOrder();
  }

  function hideOrder() {
    if ($('#order').hidden) return;          // и так в меню, ничего не трогаем
    $('#order').hidden = true;
    ORDER_HIDES.forEach(function (sel) { $(sel).hidden = false; });
  }

  function syncOrder() {
    if (orderOn()) showOrder();
    else hideOrder();
  }

  function drawOrder() {
    $('#orderTitle').textContent = '';
    var ic = el('span', 'sec-ic');
    ic.appendChild(icon('i-cart'));
    $('#orderTitle').appendChild(ic);
    $('#orderTitle').appendChild(el('span', null, t('order_title')));

    var body = $('#orderBody');
    body.textContent = '';

    var lines = cartLines();
    if (!lines.length) {
      var empty = el('div', 'crt-empty');
      empty.appendChild(icon('i-cart'));
      empty.appendChild(el('p', 'crt-empty-t', t('cart_empty')));
      empty.appendChild(el('p', 'crt-empty-x', t('cart_empty_hint')));
      body.appendChild(empty);
      body.appendChild(backBtn());
      return;
    }

    var card = el('div', 'order-card');
    var list = el('ul', 'order-list');
    lines.forEach(function (l) {
      var li = el('li', 'order-row' + (l.out ? ' crt-off' : ''));
      var b = el('div');
      b.appendChild(el('p', 'crt-n', tr(l.item, 'name')));
      var v = l.out ? t('out_of_stock') : variantText(l);
      if (v) b.appendChild(el('p', 'crt-v', v));
      li.appendChild(b);
      li.appendChild(el('span', 'order-q', '× ' + l.qty));
      li.appendChild(el('span', 'order-s', l.out ? '' : l.sum + ' ' + D.place.currency));
      list.appendChild(li);
    });
    card.appendChild(list);

    var total = el('div', 'crt-total');
    total.appendChild(el('span', null, t('cart_total')));
    total.appendChild(el('b', null, cartTotal() + ' ' + D.place.currency));
    card.appendChild(total);
    if (orderMode === 'delivery') card.appendChild(el('p', 'crt-note', t('cart_no_delivery')));
    /* Кнопка ниже будет серой, и человек должен видеть, из-за чего именно.
       Убрать строку можно в корзине — она открывается из шапки. */
    if (cartHasOut()) card.appendChild(el('p', 'crt-warn', t('out_note')));
    body.appendChild(card);

    /* Форма. Кнопка «Заказать» серая и выключенная, пока оба поля не
       заполнены верно: пусть человек увидит, что мешает, до нажатия,
       а не после. */
    var send = el('button', 'act act-go', t('order_send'));
    send.type = 'button';
    send.disabled = true;

    function refresh() { send.disabled = !orderReady(); }

    var form = el('div', 'oform');

    /* Доставка или самовывоз. Переключение перерисовывает экран: у
       вариантов разные поля, разная строка под суммой и разный текст
       о том, что будет дальше. Введённое не теряется — оно в переменных. */
    var slots = pickupSlots();
    form.appendChild(pickRow(t('order_mode'), ['delivery', 'pickup'].map(function (m) {
      var b = el('button', 'pick-o', t('order_mode_' + m));
      b.type = 'button';
      b.setAttribute('aria-pressed', orderMode === m ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (orderMode === m) return;
        orderMode = m;
        drawOrder();
      });
      return b;
    })));

    form.appendChild(orderField({
      key: 'phone', label: 'order_phone', ph: 'order_phone_ph',
      hint: 'order_phone_hint', type: 'tel', mode: 'tel', auto: 'tel',
      value: orderPhone,
      // буквы и прочий мусор в номер не пускаем, плюс и разделители — можно
      clean: function (v) { return v.replace(/[^\d+\s()\-]/g, ''); },
      format: phoneFormat,
      check: phoneError,
      store: function (v) { orderPhone = v; },
      onChange: refresh
    }));
    if (orderMode === 'delivery') {
      form.appendChild(orderField({
        key: 'addr', label: 'order_addr', ph: 'order_addr_ph',
        hint: null, type: 'text', mode: 'text', auto: 'street-address',
        value: orderAddr,
        check: addrError,
        store: function (v) { orderAddr = v; },
        onChange: refresh
      }));
    } else if (orderOpen() && !slots.length) {
      // открыто, но до закрытия уже не успеть приготовить
      form.appendChild(el('p', 'crt-warn', t('order_time_none')));
    } else if (orderOpen()) {
      form.appendChild(timeField(slots, refresh));
    }
    body.appendChild(form);

    if (!orderOpen()) body.appendChild(el('p', 'crt-warn', hoursText(t('order_closed'))));

    /* Что случится по кнопке — написано до кнопки, а не после. Зелёная
       кнопка молча открывала мессенджер, и это читалось как сбой: человек
       ждал «заказ принят», а его уносило в чужое приложение. */
    var how = el('div', 'ohow');
    [['i-wa', 'order_how_wa'],
     ['i-phone', orderMode === 'pickup' ? 'order_how_pay_pickup' : 'order_how_pay']].forEach(function (pair) {
      var p = el('p');
      p.appendChild(icon(pair[0]));
      p.appendChild(el('span', null, t(pair[1])));
      how.appendChild(p);
    });
    body.appendChild(how);

    /* Кнопка открывает WhatsApp с уже собранным заказом. Новая вкладка, а
       не эта: человек возвращается на страницу, и корзина остаётся на
       месте, если он захочет что-то поправить и отправить заново.
       Счёт на оплату выставляет оператор — это уже вне сайта. */
    send.addEventListener('click', function () {
      if (!orderReady()) {
        // закрылись или выбранное время прошло, пока форма была открыта
        if (orderMode === 'pickup') orderTouched.time = true;
        drawOrder();
        return;
      }
      window.open(waLink(orderMessage()), '_blank', 'noopener');
    });
    body.appendChild(send);
    body.appendChild(backBtn());
    refresh();
  }

  /* Одно поле формы: подпись, ввод, серая подсказка и красная ошибка.
     Ошибка появляется только после того, как человек из поля вышел —
     ругаться на недописанный номер во время набора невежливо. Дальше,
     когда поле уже «тронуто», ошибка обновляется на каждой правке. */
  function orderField(opts) {
    var box = el('div', 'ofield');
    var id = 'of-' + opts.key;

    var lab = el('label', null, t(opts.label));
    lab.htmlFor = id;
    box.appendChild(lab);

    var inp = el('input');
    inp.id = id;
    inp.type = opts.type;
    inp.inputMode = opts.mode;
    inp.autocomplete = opts.auto;
    inp.placeholder = t(opts.ph);
    inp.value = opts.value;
    inp.setAttribute('aria-describedby', id + '-h ' + id + '-e');
    box.appendChild(inp);

    /* Ошибка идёт сразу за полем, а постоянная подсказка — под ней:
       срочное сообщение должно стоять ближе к тому, что его вызвало. */
    var err = el('p', 'ofield-err');
    err.id = id + '-e';
    err.hidden = true;
    box.appendChild(err);

    if (opts.hint) {
      var hint = el('p', 'ofield-hint', t(opts.hint));
      hint.id = id + '-h';
      box.appendChild(hint);
    }

    function show() {
      var msg = orderTouched[opts.key] ? opts.check(inp.value) : '';
      err.textContent = msg;
      err.hidden = !msg;
      inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
      opts.onChange();
    }

    inp.addEventListener('input', function () {
      if (opts.clean) {
        var clean = opts.clean(inp.value);
        if (clean !== inp.value) {
          // чистим запрещённые символы, не сбивая курсор
          var at = inp.selectionStart - (inp.value.length - clean.length);
          inp.value = clean;
          try { inp.setSelectionRange(at, at); } catch (e) {}
        }
      }
      opts.store(inp.value);
      show();
    });

    inp.addEventListener('blur', function () {
      orderTouched[opts.key] = true;
      if (opts.format) {
        inp.value = opts.format(inp.value);
        opts.store(inp.value);
      }
      show();
    });

    show();
    return box;
  }

  /* Время самовывоза — список, а не поле ввода: так нельзя выбрать то,
     что уже прошло или приходится на закрытие. Под списком — куда
     приходить, чтобы гость не искал адрес отдельно. */
  function timeField(slots, onChange) {
    var box = el('div', 'ofield');
    var id = 'of-time';
    var lab = el('label', null, t('order_time'));
    lab.htmlFor = id;
    box.appendChild(lab);

    var sel = el('select');
    sel.id = id;
    sel.setAttribute('aria-describedby', id + '-h ' + id + '-e');
    var ph = el('option', null, t('order_time_ph'));
    ph.value = '';
    sel.appendChild(ph);
    slots.forEach(function (v) {
      var o = el('option', null, v);
      o.value = v;
      sel.appendChild(o);
    });
    // прошедшее время в списке не найдётся — тогда селект встанет на
    // «Выберите время», а ошибка скажет, почему
    sel.value = slots.indexOf(orderTime) < 0 ? '' : orderTime;
    box.appendChild(sel);

    var err = el('p', 'ofield-err');
    err.id = id + '-e';
    err.hidden = true;
    box.appendChild(err);
    var hint = el('p', 'ofield-hint', fill(t('order_time_hint'), tr(D.place, 'address')));
    hint.id = id + '-h';
    box.appendChild(hint);

    function show() {
      var msg = orderTouched.time ? timeError(orderTime) : '';
      err.textContent = msg;
      err.hidden = !msg;
      sel.setAttribute('aria-invalid', msg ? 'true' : 'false');
      onChange();
    }
    sel.addEventListener('change', function () {
      orderTime = sel.value;
      orderTouched.time = true;
      show();
    });
    show();
    return box;
  }

  /* Текст заказа для WhatsApp. Сквозная нумерация, по строке на позицию;
     позиции с разными размером или подачей — разные строки, даже если
     напиток один и тот же (в корзине они и хранятся отдельно).

     Буква размера здесь остаётся: на настенном меню и в накладных у
     заведения именно «M» и «L», и баристе удобнее видеть их рядом с
     литрами. Гостю буквы по-прежнему не показываются. */
  function orderMessage() {
    var lines = [t('wa_order_head'), ''];
    cartLines().forEach(function (l, i) {
      var bits = [tr(l.item, 'name'), 'x' + l.qty];
      var vol = sizeLabel(l.item, l.size);
      if (vol) bits.push(l.size + ' (' + vol + ')');
      if (l.temp) bits.push(t('temp_' + l.temp));
      lines.push((i + 1) + '. ' + bits.join(' '));
    });
    lines.push('');
    if (orderMode === 'pickup') {
      lines.push(fill(t('wa_pickup'), orderTime));
      lines.push(t('order_phone') + ': ' + orderPhone);
    } else {
      lines.push(t('wa_delivery'));
      lines.push(t('order_phone') + ': ' + orderPhone);
      lines.push(t('address') + ': ' + String(orderAddr).trim());
    }
    return lines.join('\n');
  }

  function backBtn() {
    var b = el('button', 'act act-ghost', t('order_back'));
    b.type = 'button';
    b.addEventListener('click', function () {
      if (history.length > 1) history.back();
      else { location.hash = ''; syncOrder(); }
    });
    return b;
  }

  /* Короткий рывок счётчика — единственный ответ на добавление: окно
     закрывается, и человеку надо показать, что заказ куда-то попал. */
  function bumpCart() {
    var b = $('#cartBtn');
    b.setAttribute('data-bump', 'true');
    setTimeout(function () { b.removeAttribute('data-bump'); }, 340);
  }

  /* --- значки разделов --------------------------------------------------- */
  var CAT_ICON = {
    'thai-milk-tea': 'i-cat-milk',
    'jasmine-milk-tea': 'i-cat-jasmine',
    'thai-lemon-tea': 'i-cat-lemon',
    'italian-coffee': 'i-cat-coffee',
    'fruit-americano': 'i-cat-fruit',
    'fruit-mix': 'i-cat-mix',
    'slush': 'i-cat-slush',
    'ice-cream': 'i-cat-ice'
  };
  function catIcon(id) { return CAT_ICON[id] || 'i-cat-milk'; }

  /* --- первый экран ------------------------------------------------------ */
  function renderHero() {
    var p = D.place;
    var h = hoursOf();
    var city = splitAddress(tr(p, 'address')).city;

    var kicker = $('#heroKicker');
    kicker.textContent = '';
    kicker.appendChild(icon('i-pin'));
    kicker.appendChild(document.createTextNode(
      (city ? city + ' · ' : '') + h.open + '–' + h.close));

    /* Заголовок — тагланг из данных: последнее слово подсвечиваем, чтобы
       не выдумывать отдельный рекламный текст. */
    hlLast($('#heroTitle'), tr(p, 'tagline'), 'hl');

    $('#heroLead').textContent = t('hero_lead');

    var items = 0;
    D.categories.forEach(function (c) { items += c.items.length; });

    var stats = $('#heroStats');
    stats.textContent = '';
    // рейтинг первым: это главный довод, и слева он не ложится на стаканы
    if (p.rating_2gis) stats.appendChild(heroStat('i-star', num(p.rating_2gis), t('rating_label')));
    stats.appendChild(heroStat('i-list', items,
      plural(items, t('stat_items_one'), t('stat_items_few'), t('stat_items'))));
    stats.appendChild(heroStat('i-cat-milk', D.categories.length,
      plural(D.categories.length, t('stat_cats_one'), t('stat_cats_few'), t('stat_cats'))));

    var cta = $('#heroCta');
    cta.textContent = '';
    var a1 = el('a', 'btn btn-primary');
    a1.href = '#menu';
    a1.appendChild(document.createTextNode(t('see_menu')));
    a1.appendChild(icon('i-arrow'));
    cta.appendChild(a1);

    if (p.link_2gis) {
      var a2 = el('a', 'btn btn-ghost');
      a2.href = p.link_2gis;
      a2.target = '_blank';
      a2.rel = 'noopener';
      a2.appendChild(icon('i-map'));
      a2.appendChild(document.createTextNode(t('route')));
      cta.appendChild(a2);
    }
  }

  function heroStat(iconId, value, label) {
    var box = el('div', 'hero-stat');
    box.appendChild(icon(iconId));
    var b = el('div');
    b.appendChild(el('b', null, String(value)));
    b.appendChild(el('span', null, label));
    box.appendChild(b);
    return box;
  }

  /* --- о нас ------------------------------------------------------------- */
  /* Значки для карточек-фактов. В данных пишется короткое слово, чтобы
     владельцу не пришлось знать про id иконок. */
  var FACT_ICON = {
    leaf: 'i-leaf',
    tea: 'i-cat-milk',
    pearl: 'i-cat-milk',
    jasmine: 'i-cat-jasmine',
    lemon: 'i-cat-lemon',
    coffee: 'i-cat-coffee',
    fruit: 'i-cat-fruit',
    slush: 'i-cat-slush',
    ice: 'i-cat-ice',
    cold: 'i-snow',
    hot: 'i-flame',
    star: 'i-star',
    clock: 'i-clock',
    pin: 'i-pin'
  };

  function signChip(iconId, text) {
    var box = el('span');
    box.appendChild(icon(iconId));
    box.appendChild(document.createTextNode(text));
    return box;
  }

  function renderAbout() {
    var a = D.about;
    var sec = $('#about');
    if (!a) { sec.hidden = true; return; }   // блока в данных нет — секции тоже

    var title = $('#aboutTitle');
    title.textContent = '';
    var ic = el('span', 'sec-ic');
    ic.appendChild(icon('i-leaf'));
    title.appendChild(ic);
    title.appendChild(el('span', null, tr(a, 'title')));

    $('#aboutLead').textContent = tr(a, 'lead');
    var text = tr(a, 'text');
    var textNode = $('#aboutText');
    textNode.textContent = text;
    textNode.hidden = !text;

    // адрес и часы берутся из place, чтобы не дублировать их в двух местах
    var p = D.place, h = hoursOf();
    var sign = $('#aboutSign');
    sign.textContent = '';
    sign.appendChild(signChip('i-pin', tr(p, 'address')));
    sign.appendChild(signChip('i-clock', t('daily') + ' ' + h.open + '–' + h.close));

    /* Полоса «Таиланд в чашке». Рисуется, только если в данных есть и
       заголовок, и хотя бы один пункт: полупустая синяя плашка смотрелась
       бы хуже, чем её отсутствие. */
    var jr = $('#aboutJourney');
    var j = a.journey;
    var jItems = (j && j.items) || [];
    jr.textContent = '';
    jr.hidden = !(j && tr(j, 'title') && jItems.length);
    if (!jr.hidden) {
      var jt = el('p', 'journey-t');
      hlLast(jt, tr(j, 'title'), 'journey-hl');
      jr.appendChild(jt);
      var jl = el('ul', 'journey-l');
      jItems.forEach(function (it) {
        var li = el('li', 'journey-i');
        li.appendChild(el('span', 'journey-k', tr(it, 'label')));
        li.appendChild(el('p', 'journey-x', tr(it, 'text')));
        jl.appendChild(li);
      });
      jr.appendChild(jl);
    }

    var list = $('#aboutFacts');
    list.textContent = '';
    (a.facts || []).forEach(function (f) {
      var li = el('li', 'fact');
      var fic = el('span', 'fact-ic');
      fic.appendChild(icon(FACT_ICON[f.icon] || 'i-star'));
      li.appendChild(fic);
      var b = el('div');
      b.appendChild(el('p', 'fact-t', tr(f, 'title')));
      b.appendChild(el('p', 'fact-x', tr(f, 'text')));
      li.appendChild(b);
      list.appendChild(li);
    });

    sec.hidden = false;
  }

  /* --- лента категорий --------------------------------------------------- */
  function buildCats() {
    var track = $('#catsTrack');
    $$('.chip', track).forEach(function (n) { n.remove(); });
    catIds = [];

    D.categories.forEach(function (cat) {
      var a = el('a', 'chip');
      a.href = '#' + cat.id;
      a.setAttribute('data-cat', cat.id);
      a.appendChild(icon(catIcon(cat.id)));
      a.appendChild(el('span', null, tr(cat, 'name')));
      a.addEventListener('click', function (e) {
        if (isPhone()) {
          // На телефоне лента не прокручивает страницу, а разворачивает раздел.
          e.preventDefault();
          openTab(cat.id, true);
          return;
        }
        lockSpy();                       // до конца скролла спай молчит
        setActive(cat.id);
      });
      track.appendChild(a);
      catIds.push(cat.id);
    });
    $('#cats').setAttribute('aria-label', t('categories'));
  }

  /* --- вкладки на телефоне ----------------------------------------------- */
  /* Больше сорока позиций подряд на маленьком экране — это бесконечная лента, в
     которой не найти нужное. Поэтому раздел показывается один, а лента
     сверху его переключает. На компьютере всё меню видно целиком. */
  function openTab(id, scroll) {
    setActive(id, true);
    catIds.forEach(function (cid) {
      var sec = document.getElementById(cid);
      if (sec) sec.classList.toggle('on', cid === id);
    });
    var open = document.getElementById(id);
    if (open) {
      // перезапускаем появление позиций: раздел сменился целиком
      open.classList.remove('is-in');
      void open.offsetWidth;
      open.classList.add('is-in');
    }
    if (scroll) {
      // Прыгаем сразу, без анимации: содержимое сменилось целиком, и плавная
      // прокрутка мимо старого раздела только сбивает с толку.
      var prev = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      var menu = $('#menu');
      window.scrollTo(0, menu.getBoundingClientRect().top + window.pageYOffset - stickOffset());
      document.documentElement.style.scrollBehavior = prev;
    }
    measureDoc();
  }

  function stickOffset() {
    var cs = getComputedStyle(document.documentElement);
    return parseInt(cs.getPropertyValue('--hdr-min'), 10) + parseInt(cs.getPropertyValue('--cats-h'), 10) + 10;
  }

  function movePill(chip) {
    var pill = $('#catsPill');
    pill.style.width = chip.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + chip.offsetLeft + 'px)';
    pill.classList.add('on');
  }

  /* Подтягиваем ленту к активной пилюле. Только горизонтальный scrollLeft
     самого контейнера: scrollIntoView умеет утащить за собой и страницу. */
  function centerChip(chip, instant) {
    var track = $('#catsTrack');
    var left = chip.offsetLeft - (track.clientWidth - chip.offsetWidth) / 2;
    left = Math.max(0, Math.min(left, track.scrollWidth - track.clientWidth));
    if (instant || typeof track.scrollTo !== 'function') {
      track.scrollLeft = left;
    } else {
      track.scrollTo({ left: left, behavior: 'smooth' });
    }
  }

  /* instant — когда раздел переключается вкладкой: содержимое меняется скачком,
     и лента должна встать сразу, а не доезжать после. */
  function setActive(id, instant) {
    if (!id || id === activeId) return;
    activeId = id;
    var chip = null;
    $$('.chip').forEach(function (c) {
      var on = c.getAttribute('data-cat') === id;
      if (on) { c.setAttribute('aria-current', 'true'); chip = c; }
      else { c.removeAttribute('aria-current'); }
    });
    if (!chip) return;
    movePill(chip);
    centerChip(chip, instant);
  }

  /* --- блокировка скроллспая на время программного скролла --------------- */
  /* Клик по пилюле сам задаёт активную категорию и подтягивает ленту один раз.
     Пока страница едет к секции, IntersectionObserver пролетает промежуточные
     секции — без блокировки он дёргал бы ленту к каждой из них по дороге. */
  var spyLocked = false;
  var spyIdle = null;
  var hasScrollEnd = 'onscrollend' in window;

  function lockSpy() {
    spyLocked = true;
    clearTimeout(spyIdle);
    /* Окно на старт: браузер начинает плавный скролл не в момент клика, и на
       загруженном потоке первое событие scroll приходит позже 150 мс. Если за
       это окно скролла не случилось вовсе (цель уже на экране) — разблокируем.
       Как только скролл пошёл, дальше работает затихание. */
    spyIdle = setTimeout(unlockSpy, 500);
  }

  function armSpyIdle() {
    clearTimeout(spyIdle);
    spyIdle = setTimeout(unlockSpy, 150);   // 150 мс без событий scroll = приехали
  }

  function unlockSpy() {
    clearTimeout(spyIdle);
    spyLocked = false;
  }

  function setupObserver() {
    if (observer) observer.disconnect();
    observer = null;
    visible = Object.create(null);
    if (isPhone()) return;      // на телефоне виден один раздел, следить не за чем

    var cs = getComputedStyle(document.documentElement);
    var top = parseInt(cs.getPropertyValue('--hdr-min'), 10) + parseInt(cs.getPropertyValue('--cats-h'), 10);

    /* Верх полосы заметно ниже точки, куда якорь ставит секцию (scroll-margin-top
       = top + 10). Иначе хвост предыдущей секции на пару пикселей заходит в
       полосу, и после перехода подсвечивается не та категория. */
    var line = top + 24;

    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      if (spyLocked) return;
      for (var i = 0; i < catIds.length; i++) {
        if (visible[catIds[i]]) { setActive(catIds[i]); return; }
      }
    }, { rootMargin: '-' + line + 'px 0px -55% 0px', threshold: 0 });

    catIds.forEach(function (id) {
      var s = document.getElementById(id);
      if (s) observer.observe(s);
    });
  }

  /* Появление позиций при прокрутке. Один раз на раздел — дальше не мешаем. */
  function setupReveal() {
    if (revealObs) revealObs.disconnect();
    if (!('IntersectionObserver' in window)) {
      $$('.cat').forEach(function (s) { s.classList.add('is-in'); });
      return;
    }
    revealObs = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        obs.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    $$('.cat').forEach(function (s) { revealObs.observe(s); });

    /* Страховка: позиции скрыты до появления, и ни при каких условиях они не
       должны остаться невидимыми — меню важнее анимации. */
    clearTimeout(revealFail);
    revealFail = setTimeout(function () {
      if ($('.cat.is-in')) return;            // наблюдатель работает, не мешаем
      $$('.cat').forEach(function (s) { s.classList.add('is-in'); });
    }, 2000);
  }
  var revealFail = null;

  /* --- карточка позиции -------------------------------------------------- */
  function sizeTag(item, k) {
    var label = sizeLabel(item, k);
    if (!label) return plainPriceTag(item.prices[k]);      // объём скрыт
    var tag = el('span', 'tag tag-size');
    tag.appendChild(el('i', null, label));
    tag.appendChild(document.createTextNode(item.prices[k] + ' ' + (D.place.currency || '')));
    // Подсказка держит букву с настенного меню: гость, увидевший там «M»,
    // поймёт, что это тот же размер.
    tag.title = (t('size_' + k.toLowerCase()) || k) + ' (' + k + ')';
    return tag;
  }

  function tempTag(kind) {
    var tag = el('span', 'tag tag-' + kind);
    tag.appendChild(icon(kind === 'cold' ? 'i-snow' : 'i-flame'));
    tag.appendChild(document.createTextNode(t(kind)));
    return tag;
  }

  /* Все размеры подряд — для блока «Первый раз у нас?», где крупной цены нет. */
  function priceTags(item) {
    var box = el('div', 'first-p');
    var keys = Object.keys(item.prices || {});
    keys.forEach(function (k) {
      box.appendChild(keys.length > 1 ? sizeTag(item, k)
                                      : plainPriceTag(item.prices[k]));
    });
    return box;
  }

  function plainPriceTag(value) {
    return el('span', 'tag tag-size', value + ' ' + (D.place.currency || ''));
  }

  /* Цена в первой строке, у названия. У позиции с двумя размерами это цена
     меньшего, поэтому к ней добавляется «от»: без него на карточке две
     разные цифры без объяснения, откуда они. */
  function basePrice(item) {
    var keys = Object.keys(item.prices || {});
    if (!keys.length) return '';
    var price = item.prices[keys[0]] + ' ' + (D.place.currency || '');
    return keys.length > 1 ? fill(t('price_from'), price) : price;
  }

  /* Мелкая строка под описанием: остальные размеры и подача. */
  function metaRow(item) {
    var keys = Object.keys(item.prices || {});
    var row = el('div', 'item-meta');
    var any = false;
    keys.slice(1).forEach(function (k) { row.appendChild(sizeTag(item, k)); any = true; });
    (item.temp || []).forEach(function (kind) {
      if (kind === 'cold' || kind === 'hot') { row.appendChild(tempTag(kind)); any = true; }
    });
    return any ? row : null;
  }

  function itemRow(item, catId, index) {
    var off = isOut(item);
    var li = el('li', 'item' + (off ? ' item-off' : ''));
    li.style.setProperty('--i', String(index));

    /* Позицию, которой нет, из меню не убираем: человек, пришедший именно
       за ней, решил бы, что ошибся сайтом. Карточка остаётся на своём
       месте, но гаснет, не нажимается и теряет кнопку корзины. */
    if (off) {
      li.setAttribute('aria-disabled', 'true');
    } else {
      /* Нажатие по всей карточке — для мыши и пальца. Настоящая кнопка при
         этом одна, значок корзины в углу: карточка содержит заголовок, и
         обернуть её в <button> нельзя — разметка станет невалидной. */
      li.addEventListener('click', function () { openItemModal(item, catId); });
      var add = el('button', 'item-add');
      add.type = 'button';
      add.appendChild(icon('i-cart'));
      add.setAttribute('aria-label', t('add_to_cart') + ': ' + tr(item, 'name'));
      add.addEventListener('click', function (e) {
        e.stopPropagation();
        openItemModal(item, catId);
      });
      li.appendChild(add);
    }

    li.appendChild(artBox(item, catId));

    var b = el('div', 'item-b');

    var top = el('div', 'item-top');
    var h3 = el('h3', 'item-n', tr(item, 'name'));
    if (item.featured) {
      var hit = el('span', 'hit');
      hit.appendChild(icon('i-star'));
      hit.appendChild(document.createTextNode(t('hit')));
      h3.appendChild(hit);
    }
    top.appendChild(h3);
    top.appendChild(el('span', 'item-price', basePrice(item)));
    b.appendChild(top);

    var desc = tr(item, 'desc');
    if (desc) b.appendChild(el('p', 'item-d', desc));

    /* У погашенной позиции размеры и подача не нужны: выбрать их всё равно
       нельзя, а строка чипов только отвлекает от главного — что её нет. */
    if (off) {
      var row = el('div', 'item-meta');
      row.appendChild(el('span', 'tag tag-out', t('out_of_stock')));
      b.appendChild(row);
    } else {
      var meta = metaRow(item);
      if (meta) b.appendChild(meta);
    }

    li.appendChild(b);
    return li;
  }

  /* --- секции ------------------------------------------------------------ */
  function sectionTitle(cat, count) {
    var h2 = el('h2', 'sec-title');
    var ic = el('span', 'sec-ic');
    ic.appendChild(icon(catIcon(cat.id)));
    h2.appendChild(ic);
    h2.appendChild(el('span', null, tr(cat, 'name')));
    h2.appendChild(el('span', 'sec-count', String(count)));
    return h2;
  }

  function renderMenu() {
    var host = $('#menu');
    host.textContent = '';

    // Строка про рисунки нужна, только пока часть позиций без фото.
    var note = D.categories.some(function (cat) {
      return cat.items.some(function (item) { return !item.img; });
    }) ? t('photos_note') : '';
    if (note) {
      var p = el('p', 'photos-note');
      p.appendChild(icon('i-photo'));
      p.appendChild(document.createTextNode(note));
      host.appendChild(p);
    }

    D.categories.forEach(function (cat) {
      var sec = el('section', 'cat');
      sec.id = cat.id;
      var h2 = sectionTitle(cat, cat.items.length);
      h2.id = 'h-' + cat.id;
      sec.setAttribute('aria-labelledby', h2.id);
      sec.appendChild(h2);

      var ul = el('ul', 'items');
      cat.items.forEach(function (item, i) { ul.appendChild(itemRow(item, cat.id, i)); });
      sec.appendChild(ul);
      host.appendChild(sec);
    });
  }

  function findItem(name) {
    for (var i = 0; i < D.categories.length; i++) {
      var items = D.categories[i].items;
      for (var j = 0; j < items.length; j++) {
        if (items[j].name === name) return { item: items[j], catId: D.categories[i].id };
      }
    }
    return null;
  }

  function renderFirstTime() {
    var sec = $('#first-time');
    var old = sec.querySelector('.first-box');
    if (old) old.remove();               // пересобираем блок целиком

    var rows = (D.first_time || [])
      .map(function (r) { return { ref: r, found: findItem(r.ref) }; })
      .filter(function (r) { return r.found; });
    if (!rows.length) { sec.hidden = true; return; }

    var title = $('#firstTitle');
    title.textContent = '';
    var ic = el('span', 'sec-ic');
    ic.appendChild(icon('i-spark'));
    title.appendChild(ic);
    title.appendChild(el('span', null, t('first_time')));

    var box = el('div', 'first-box');
    box.appendChild(el('p', 'first-lead', t('first_lead')));

    var list = el('ul', 'first-list');
    list.id = 'firstList';

    rows.forEach(function (r, i) {
      /* Совет, которого сегодня нет, не подменяем другим напитком: это
         редакторский список, а не выдача. Гасим его на месте — так видно,
         что советов по-прежнему три, просто один сейчас недоступен. */
      var off = isOut(r.found.item);
      var li = el('li', 'first-item' + (off ? ' item-off' : ''));

      var art = el('div', 'first-art');
      art.appendChild(artBox(r.found.item, r.found.catId));
      art.appendChild(el('span', 'first-num', String(i + 1)));
      li.appendChild(art);

      var b = el('div');
      b.appendChild(el('p', 'first-n', tr(r.found.item, 'name')));
      b.appendChild(el('p', 'first-w', tr(r.ref, 'why')));
      if (off) {
        var tags = el('div', 'first-p');
        tags.appendChild(el('span', 'tag tag-out', t('out_of_stock')));
        b.appendChild(tags);
      } else {
        b.appendChild(priceTags(r.found.item));
      }
      li.appendChild(b);
      list.appendChild(li);
    });

    box.appendChild(list);
    sec.appendChild(box);
    sec.hidden = false;
  }

  function crow(iconId, label, value, href, opts) {
    var node = href ? el('a', 'crow') : el('div', 'crow');
    if (href) {
      node.href = href;
      if (opts && opts.external) { node.target = '_blank'; node.rel = 'noopener'; }
    }
    var ic = el('span', 'crow-ic');
    ic.appendChild(icon(iconId));
    node.appendChild(ic);

    var b = el('div', 'crow-b');
    b.appendChild(el('span', 'crow-l', label));
    b.appendChild(el('span', 'crow-v', value));
    node.appendChild(b);

    if (href) node.appendChild(icon('i-arrow', 'ico ico-go'));
    else node.appendChild(el('span'));
    return node;
  }

  function renderContacts() {
    var p = D.place;
    var card = $('#contactsCard');
    card.textContent = '';

    var title = $('#contactsTitle');
    title.textContent = '';
    var ic = el('span', 'sec-ic');
    ic.appendChild(icon('i-pin'));
    title.appendChild(ic);
    title.appendChild(el('span', null, t('contacts')));

    // рейтинг — их сильная сторона, поэтому сверху и крупно
    if (p.rating_2gis) {
      var r = el('div', 'rating');
      var val = el('div', 'rating-val');
      val.appendChild(icon('i-star'));
      val.appendChild(document.createTextNode(num(p.rating_2gis)));
      r.appendChild(val);

      var txt = el('div', 'rating-txt');
      txt.appendChild(el('b', null, t('rating_label')));
      // В 2ГИС «отзыв» — только оценка с текстом или фото. Рейтинг считается
      // по всем оценкам, поэтому рядом с ним стоит их число, а не отзывов.
      var n = p.ratings_2gis || 0;
      txt.appendChild(document.createTextNode(
        n + ' ' + plural(n, t('ratings_one'), t('ratings_few'), t('ratings_many'))));
      r.appendChild(txt);
      card.appendChild(r);
    }

    // строки в отдельной обёртке: на компьютере она раскладывается в две колонки
    var rows = el('div', 'crows');
    var h = hoursOf();
    rows.appendChild(crow('i-pin', t('address'), tr(p, 'address')));
    rows.appendChild(crow('i-clock', t('hours'), t('daily') + ' ' + h.open + '–' + h.close));

    if (p.phone) {
      rows.appendChild(crow('i-phone', t('phone_label'), p.phone, 'tel:' + p.phone.replace(/[^\d+]/g, '')));
    }
    if (p.whatsapp) {
      rows.appendChild(crow('i-wa', t('whatsapp_label'), t('whatsapp_write'), waLink(), { external: true }));
    }
    if (p.instagram) {
      var handle = '@' + p.instagram.replace(/\/+$/, '').split('/').pop();
      rows.appendChild(crow('i-ig', t('instagram'), handle, p.instagram, { external: true }));
    }
    if (p.link_2gis) {
      rows.appendChild(crow('i-map', t('map_label'), t('open_2gis'), p.link_2gis, { external: true }));
    }
    card.appendChild(rows);
    $('#contacts').hidden = false;
  }

  function waLink(text) {
    /* Номер один на весь сайт — из D.place.whatsapp. Здесь же собирается
       ссылка и для подвала, и для заказа, чтобы номер не появился в коде
       вторым экземпляром. Перевод строки encodeURIComponent сам превращает
       в %0A, вручную ничего подставлять не нужно. */
    return 'https://wa.me/' + D.place.whatsapp +
           '?text=' + encodeURIComponent(text || t('wa_text'));
  }

  function renderFooter() {
    var p = D.place;
    var box = $('#ftrIn');
    box.textContent = '';

    var mark = el('div', 'ftr-mark');
    var svg = icon('logo-mark', '');
    svg.setAttribute('viewBox', '0 0 648 745');
    mark.appendChild(svg);
    box.appendChild(mark);

    box.appendChild(el('p', 'ftr-name', p.name));
    box.appendChild(el('p', 'ftr-tag', tr(p, 'tagline')));

    var h = hoursOf();
    var meta = el('div', 'ftr-meta');
    meta.appendChild(el('div', null, tr(p, 'address')));
    meta.appendChild(el('div', null, t('daily') + ' ' + h.open + '–' + h.close));
    box.appendChild(meta);

    var soc = el('div', 'ftr-soc');
    if (p.whatsapp) soc.appendChild(socLink(waLink(), 'i-wa', t('whatsapp_write')));
    if (p.instagram) soc.appendChild(socLink(p.instagram, 'i-ig', t('instagram')));
    if (p.link_2gis) soc.appendChild(socLink(p.link_2gis, 'i-map', t('open_2gis')));
    if (p.phone) soc.appendChild(socLink('tel:' + p.phone.replace(/[^\d+]/g, ''), 'i-phone', t('call')));
    box.appendChild(soc);

    box.appendChild(el('p', 'ftr-copy', '© ' + new Date().getFullYear() + ' ' + p.name));

    $('#ftr').hidden = false;
  }

  function socLink(href, iconId, label) {
    var a = el('a');
    a.href = href;
    a.setAttribute('aria-label', label);
    if (href.indexOf('http') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
    a.appendChild(icon(iconId));
    return a;
  }

  /* Кнопка в правом углу шапки. Раньше здесь был WhatsApp, теперь корзина. */
  function renderCartTop() {
    $('#cartTxt').textContent = t('cart');
    renderCartBtn();
  }

  /* --- мета и микроразметка --------------------------------------------- */
  function renderMeta() {
    var p = D.place;
    var a = splitAddress(tr(p, 'address'));
    var tagline = tr(p, 'tagline');
    var cats = D.categories.map(function (c) { return tr(c, 'name'); }).join(', ');

    document.title = p.name + ' — ' + tagline + (a.city ? ', ' + a.city : '');
    var desc = tagline + '. ' + cats + '. ' + tr(p, 'address') + '.';
    setMeta('name', 'description', desc);
    setMeta('property', 'og:title', document.title);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:locale', lang === 'kk' ? 'kk_KZ' : 'ru_RU');
    setMeta('property', 'og:url', siteUrl());

    var prices = [];
    D.categories.forEach(function (c) {
      c.items.forEach(function (i) {
        Object.keys(i.prices || {}).forEach(function (k) { prices.push(i.prices[k]); });
      });
    });

    var h = hoursOf();
    var ld = {
      '@context': 'https://schema.org',
      '@type': 'CafeOrCoffeeShop',
      name: p.name,
      description: tagline,
      url: siteUrl(),
      image: new URL('og.png', siteUrl()).href,
      telephone: p.phone,
      currenciesAccepted: 'KZT',
      address: {
        '@type': 'PostalAddress',
        streetAddress: a.street,
        addressLocality: a.city,
        addressCountry: 'KZ'
      },
      openingHoursSpecification: [{
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: h.open,
        /* Если заведение закрывается в полночь, на странице это «24:00»,
           а поисковики такого времени не знают — им уходит 23:59. */
        closes: h.close === '24:00' ? '23:59' : h.close
      }],
      hasMenu: {
        '@type': 'Menu',
        hasMenuSection: D.categories.map(function (c) {
          return {
            '@type': 'MenuSection',
            name: tr(c, 'name'),
            hasMenuItem: c.items.map(function (i) {
              var keys = Object.keys(i.prices || {});
              return {
                '@type': 'MenuItem',
                name: tr(i, 'name'),
                description: tr(i, 'desc'),
                offers: keys.map(function (k) {
                  return {
                    '@type': 'Offer',
                    price: i.prices[k],
                    priceCurrency: 'KZT',
                    // поисковику тоже говорим, что кончилось
                    availability: isOut(i) ? 'https://schema.org/OutOfStock'
                                           : 'https://schema.org/InStock'
                  };
                })
              };
            })
          };
        })
      }
    };
    if (prices.length) {
      ld.priceRange = Math.min.apply(null, prices) + '–' + Math.max.apply(null, prices) + ' ' + p.currency;
    }
    if (p.rating_2gis && p.ratings_2gis) {
      ld.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: p.rating_2gis,
        ratingCount: p.ratings_2gis,
        bestRating: 5
      };
    }
    var same = [];
    if (p.instagram) same.push(p.instagram);
    if (p.link_2gis) same.push(p.link_2gis);
    if (same.length) ld.sameAs = same;

    var tag = document.getElementById('ldjson');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'ldjson';
      document.head.appendChild(tag);
    }
    tag.textContent = JSON.stringify(ld);
  }

  /* Адрес сайта для превью и поисковиков — один, из <link rel="canonical">
     в index.html, а не из адресной строки: иначе гость, открывший
     «dearbox.kz/#order», раздавал бы ссылку на экран заказа. */
  function siteUrl() {
    var c = document.querySelector('link[rel="canonical"]');
    return c && c.href ? c.href : location.href.split('#')[0];
  }

  function setMeta(attr, key, value) {
    var m = document.head.querySelector('meta[' + attr + '="' + key + '"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute(attr, key);
      document.head.appendChild(m);
    }
    m.setAttribute('content', value);
  }

  /* --- сборка ------------------------------------------------------------ */
  function renderAll() {
    var p = D.place;
    document.documentElement.setAttribute('lang', lang);
    $('#brandName').textContent = p.name;
    $('#brandTag').textContent = tr(p, 'tagline');
    $('.skip').textContent = t('skip');
    $('#themeBtn').setAttribute('aria-label', t('theme_toggle'));
    $('#modalX').setAttribute('aria-label', t('close'));

    renderLang();

    renderStatus();
    renderHero();
    renderAbout();
    buildCats();
    renderMenu();
    renderFirstTime();
    renderContacts();
    renderFooter();
    renderCartTop();
    renderMeta();

    /* Если открыт экран заказа, перерисовываем его: при смене языка
       renderAll() обновляет меню под ним, а сам экран остался бы
       с надписями на прежнем языке. */
    if (orderOn()) { showOrder(); return; }

    // при переходе телефон <-> компьютер остаёмся в том же разделе
    var keep = catIds.indexOf(activeId) >= 0 ? activeId : catIds[0];
    activeId = '';
    setupObserver();
    setupReveal();
    if (isPhone()) openTab(keep, false);
    else setActive(keep);
    measureDoc();
  }

  function fail(err) {
    var host = $('#menu');
    host.textContent = '';
    host.appendChild(el('p', 'error', (D && t('error')) || 'Не удалось загрузить меню. Обновите страницу.'));
    // почти всегда это опечатка в блоке #menu-data: лишняя запятая или кавычка
    if (window.console) console.error('[Dear Box] блок menu-data не читается:', err);
  }

  function start(data) {
    D = data;
    initLang();
    initTheme();
    initModal();
    renderAll();

    /* Наличие приезжает отдельным файлом и почти всегда успевает к первой
       отрисовке. Перерисовываем только если он что-то изменил: в обычный
       день список пуст и второй отрисовки не будет вовсе. */
    loadStock(function (changed) {
      if (changed) renderAll();
    });

    /* Браузер шлёт scroll десятками событий на кадр. Перерисовывать чаще
       кадра всё равно некуда, поэтому копим их в requestAnimationFrame. */
    var scrollQueued = false;
    window.addEventListener('scroll', function () {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(function () { scrollQueued = false; onScroll(); });
    }, { passive: true });
    /* Переход телефон <-> компьютер (поворот экрана, изменение окна): логика
       меню разная, поэтому при смене режима пересобираем его целиком. */
    var wasPhone = isPhone();
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      var chip = document.querySelector('.chip[aria-current="true"]');
      if (chip) movePill(chip);
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (isPhone() !== wasPhone) {
          wasPhone = isPhone();
          renderAll();
        } else {
          setupObserver();
          measureDoc();
        }
      }, 180);
    }, { passive: true });

    setInterval(renderStatus, 60000);

    /* Экран заказа тоже живёт по часам: в 23:00 кнопка должна погаснуть,
       а список времени самовывоза — сдвинуться. Перерисовываем, только
       когда что-то из этого поменялось, и не трогаем форму, пока в ней
       печатают, — иначе поле потеряет курсор. */
    var orderSig = '';
    setInterval(function () {
      if (!orderOn() || $('#order').hidden) return;
      var sig = orderOpen() + '|' + pickupSlots()[0];
      if (sig === orderSig) return;
      var a = document.activeElement;
      if (a && a.tagName === 'INPUT' && $('#order').contains(a)) return;
      orderSig = sig;
      drawOrder();
    }, 30000);

    /* Пилюлю в ленте меряем по ширине текста. Пока не доехал фирменный шрифт,
       текст меряется системным — после подмены пилюля обязана пересчитаться. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        var chip = document.querySelector('.chip[aria-current="true"]');
        if (chip) movePill(chip);
        measureDoc();
      });
    }

    if (hasScrollEnd) window.addEventListener('scrollend', unlockSpy);

    // прямая ссылка вида index.html#order — экран заказа вместо меню
    if (orderOn()) { showOrder(); onScroll(); return; }

    // прямая ссылка вида index.html#italian-coffee — контент появился только сейчас
    if (location.hash.length > 1) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) {
        if (isPhone() && target.classList.contains('cat')) {
          openTab(target.id, true);      // на телефоне ссылка открывает раздел
        } else {
          lockSpy();
          target.scrollIntoView();
          if (target.classList.contains('cat')) setActive(target.id);
        }
      }
    }
    onScroll();
  }

  /* Данные лежат прямо в index.html — отдельного запроса нет, меню есть
     на первом же кадре. */
  function readData() {
    var tag = document.getElementById('menu-data');
    if (!tag) throw new Error('в index.html нет блока <script id="menu-data">');
    return JSON.parse(tag.textContent);
  }

  try {
    start(readData());
  } catch (e) {
    fail(e);
  }
})();
