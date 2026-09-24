/* Админка наличия: переключатели и кнопка «Вернуть всё».

   Нажатие сразу перекрашивает переключатель (чтобы палец не ждал сети),
   а потом всё перерисовывается по ответу сервера. Ошибка — переключатель
   возвращается как был и снизу всплывает сообщение. */
(function () {
  'use strict';

  var dataEl = document.getElementById('stock-data');
  if (!dataEl) return;                       // страница входа или настройки

  var csrf = document.querySelector('meta[name="csrf"]').content;
  var switches = Array.prototype.slice.call(document.querySelectorAll('.sw'));
  var state = JSON.parse(dataEl.textContent);
  var busy = 0;

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return 'Изменено ' + p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' в ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function paint(sw, isOut) {
    sw.setAttribute('aria-checked', isOut ? 'false' : 'true');
    sw.querySelector('.sw-t').textContent = isOut ? 'Нет' : 'Есть';
    sw.closest('.row').classList.toggle('is-out', isOut);
  }

  function render() {
    var out = {};
    state.out.forEach(function (n) { out[n] = true; });
    switches.forEach(function (sw) { paint(sw, !!out[sw.dataset.name]); });
    var n = state.out.length;
    document.getElementById('summary').textContent = n
      ? 'Нет в наличии: ' + n + ' ' + plural(n, 'позиция', 'позиции', 'позиций')
      : 'Всё в наличии';
    document.getElementById('updated').textContent = when(state.updated);
    document.getElementById('resetAll').disabled = n === 0;
  }

  var toastTimer;
  function toast(text) {
    var t = document.getElementById('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function api(method, body) {
    return fetch('api.php', {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        // вышли по таймауту, сменили пароль или страница устарела
        location.reload();
        throw new Error('reload');
      }
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error || 'Ошибка');
        return j;
      });
    });
  }

  switches.forEach(function (sw) {
    sw.addEventListener('click', function () {
      var nowOut = sw.getAttribute('aria-checked') === 'true';   // было «Есть» → станет «Нет»
      paint(sw, nowOut);
      busy++;
      api('POST', { action: 'set', name: sw.dataset.name, out: nowOut })
        .then(function (s) {
          state = s;
          render();
          toast(sw.dataset.name + (nowOut ? ' — нет в наличии' : ' — снова в наличии'));
        })
        .catch(function (e) {
          if (e.message === 'reload') return;
          render();                          // вернуть как было
          toast(e.message === 'Failed to fetch' ? 'Нет связи. Попробуйте ещё раз.' : e.message);
        })
        .then(function () { busy--; });
    });
  });

  document.getElementById('resetAll').addEventListener('click', function () {
    if (!confirm('Вернуть все позиции в наличие?')) return;
    busy++;
    api('POST', { action: 'reset' })
      .then(function (s) { state = s; render(); toast('Всё снова в наличии'); })
      .catch(function (e) { if (e.message !== 'reload') toast(e.message); })
      .then(function () { busy--; });
  });

  /* Телефон разблокировали или вернулись во вкладку — подтягиваем свежее:
     другой бариста мог что-то поменять. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || busy) return;
    api('GET').then(function (s) { state = s; render(); }).catch(function () {});
  });

  render();
})();
