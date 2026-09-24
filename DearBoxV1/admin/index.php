<?php
/* Админка наличия: dearbox.kz/admin

   Три состояния страницы:
     1. Пароль ещё не задан и в dearbox-data лежит setup.txt — форма
        «Придумайте пароль». Без setup.txt форма не показывается: иначе
        пароль мог бы задать первый встречный.
     2. Не вошли — форма входа.
     3. Вошли — список позиций с переключателями. Нажатия уходят в api.php.

   Формы отправляются методом POST на эту же страницу, после обработки —
   переадресация обратно (так «обновить страницу» не отправит форму
   повторно). */

declare(strict_types=1);
require __DIR__ . '/lib.php';

start_session();
admin_headers();

function back(string $flash = ''): never {
    if ($flash !== '') $_SESSION['flash'] = $flash;
    header('Location: ./', true, 303);
    exit;
}

/* --- действия ------------------------------------------------------------- */

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!same_origin() || !csrf_ok($_POST['csrf'] ?? null)) {
        back('Страница устарела. Попробуйте ещё раз.');
    }
    $action = (string)($_POST['action'] ?? '');

    if ($action === 'setup') {
        if (!setup_allowed()) back();
        $p1 = (string)($_POST['password'] ?? '');
        $p2 = (string)($_POST['password2'] ?? '');
        if (mb_strlen($p1) < MIN_PASSWORD_LEN) back('Пароль короче ' . MIN_PASSWORD_LEN . ' символов.');
        if ($p1 !== $p2) back('Пароли не совпадают.');
        save_password($p1);
        log_in();
        back('Пароль сохранён. Вы вошли.');
    }

    if ($action === 'login') {
        $wait = login_wait();
        if ($wait > 0) back('Слишком много попыток. Подождите ' . (int)ceil($wait / 60) . ' мин.');
        $cfg = config();
        if ($cfg && password_verify((string)($_POST['password'] ?? ''), $cfg['password_hash'])) {
            login_succeeded();
            log_in();
            back();
        }
        login_failed();
        usleep(400000);   // замедляем подбор
        back('Неверный пароль.');
    }

    if ($action === 'logout') {
        log_out();
        back('Вы вышли.');
    }

    back();
}

/* --- страница ------------------------------------------------------------- */

$flash = (string)($_SESSION['flash'] ?? '');
unset($_SESSION['flash']);
$csrf = (string)$_SESSION['csrf'];
$cfg = config();

if ($cfg === null) {
    $mode = setup_allowed() ? 'setup' : 'closed';
} else {
    $mode = logged_in() ? 'panel' : 'login';
}

$stock = $mode === 'panel' ? read_stock() : null;
$outSet = $stock ? array_flip($stock['out']) : [];
?><!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="csrf" content="<?= h($csrf) ?>">
<title>Наличие — Dear Box</title>
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="admin.css">
<script defer src="admin.js"></script>
</head>
<body class="mode-<?= h($mode) ?>">

<header class="top">
  <div class="top-in">
    <img src="/logo.svg" alt="" width="36" height="36">
    <div class="top-t">
      <b>Dear Box</b>
      <span>Наличие</span>
    </div>
    <?php if ($mode === 'panel'): ?>
    <form method="post" class="top-out">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="logout">
      <button type="submit" class="link">Выйти</button>
    </form>
    <?php endif; ?>
  </div>
</header>

<main class="wrap">

<?php if ($flash !== ''): ?>
  <p class="flash" role="status"><?= h($flash) ?></p>
<?php endif; ?>

<?php if ($mode === 'closed'): ?>
  <section class="card">
    <h1>Админка ещё не настроена</h1>
    <p>Чтобы задать пароль, в Plesk откройте «Файлы», папку
       <b>dearbox-data</b> (рядом с httpdocs) и создайте в ней пустой файл
       <b>setup.txt</b>. Потом обновите эту страницу.</p>
  </section>

<?php elseif ($mode === 'setup'): ?>
  <section class="card">
    <h1>Придумайте пароль</h1>
    <p>Один общий пароль для всех бариста. Не короче <?= MIN_PASSWORD_LEN ?> символов.
       Проще всего — три-четыре слова подряд: <i>чай-манго-лёд-2026</i>.</p>
    <form method="post" class="form">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="setup">
      <label>Пароль
        <input type="password" name="password" autocomplete="new-password" minlength="<?= MIN_PASSWORD_LEN ?>" required>
      </label>
      <label>Ещё раз
        <input type="password" name="password2" autocomplete="new-password" minlength="<?= MIN_PASSWORD_LEN ?>" required>
      </label>
      <button type="submit" class="btn">Сохранить пароль</button>
    </form>
  </section>

<?php elseif ($mode === 'login'): ?>
  <section class="card">
    <h1>Вход</h1>
    <form method="post" class="form">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="login">
      <input type="text" name="username" value="dearbox" autocomplete="username" hidden>
      <label>Пароль
        <input type="password" name="password" autocomplete="current-password" required autofocus>
      </label>
      <button type="submit" class="btn">Войти</button>
    </form>
  </section>

<?php else: ?>
  <section class="summary" aria-live="polite">
    <p id="summary"></p>
    <p class="updated" id="updated"></p>
  </section>

  <?php foreach (menu() as $cat): ?>
  <section class="cat">
    <h2><?= h($cat['name']) ?></h2>
    <ul class="rows">
      <?php foreach ($cat['items'] as $name): $isOut = isset($outSet[$name]); ?>
      <li class="row<?= $isOut ? ' is-out' : '' ?>">
        <span class="row-n"><?= h($name) ?></span>
        <button type="button" class="sw" role="switch"
                aria-checked="<?= $isOut ? 'false' : 'true' ?>"
                data-name="<?= h($name) ?>">
          <span class="sw-t"><?= $isOut ? 'Нет' : 'Есть' ?></span>
        </button>
      </li>
      <?php endforeach; ?>
    </ul>
  </section>
  <?php endforeach; ?>

  <section class="reset">
    <button type="button" class="btn btn-ghost" id="resetAll">Вернуть всё в наличие</button>
    <p class="hint">Гости увидят изменения, когда откроют или обновят страницу меню.</p>
  </section>

  <script type="application/json" id="stock-data"><?= json_encode($stock, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
<?php endif; ?>

</main>

<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
</body>
</html>
