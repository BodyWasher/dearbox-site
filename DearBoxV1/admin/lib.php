<?php
/* Общая часть админки наличия: где лежат данные, вход, защита, запись.

   Подключается из admin/index.php, admin/api.php и stock.php. Сам по себе
   ничего не выводит; открыть его по ссылке нельзя (404 ниже и запрет в
   .htaccess).

   ГДЕ ДАННЫЕ. В папке dearbox-data уровнем ВЫШЕ корня сайта (httpdocs):
     config.json          — хэш пароля (сам пароль нигде не хранится);
     stock.json           — что отметили бариста;
     login-attempts.json  — неудачные входы, для ограничения подбора;
     sessions/            — сессии вошедших;
     setup.txt            — если лежит, админка разрешает задать пароль.
   Эту папку нельзя открыть по ссылке, и автозаливка из GitHub её не
   трогает — поэтому отметки бариста не пропадают при обновлении сайта.

   ЗАЩИТА, коротко:
     - пароль проверяется через password_verify, хранится только хэш;
     - после 5 неудачных попыток с одного адреса — пауза 15 минут, после
       100 неудачных попыток со всех адресов за час — пауза для всех;
     - сессия: cookie только по https, недоступна JavaScript, не уходит
       с чужих сайтов (SameSite=Strict), новый id после входа;
     - смена пароля выкидывает все старые входы;
     - каждое изменение требует CSRF-токен — чужая страница не сможет
       «нажать кнопку» за вошедшего бариста;
     - принимаются только названия, которые есть в меню. */

declare(strict_types=1);

if (realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    http_response_code(404);
    exit;
}

ini_set('display_errors', '0');
ini_set('log_errors', '1');
date_default_timezone_set('Asia/Oral');   // Уральск, UTC+5

const SESSION_DAYS     = 30;    // бариста не вводит пароль каждую смену
const IP_MAX_FAILS     = 5;
const IP_WINDOW        = 900;   // 15 минут
const ALL_MAX_FAILS    = 100;
const ALL_WINDOW       = 3600;  // час
const MIN_PASSWORD_LEN = 10;

function data_dir(): string {
    $d = dirname($_SERVER['DOCUMENT_ROOT']) . '/dearbox-data';
    if (!is_dir($d)) mkdir($d, 0700, true);
    return $d;
}

function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function h(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function client_ip(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/* --- файлы: чтение и атомарная запись ---------------------------------- */

function read_json(string $file): ?array {
    if (!is_file($file)) return null;
    $raw = file_get_contents($file);
    $data = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($data) ? $data : null;
}

/* Пишем во временный файл рядом и переименовываем: файл никогда не бывает
   записан наполовину, даже если PHP упадёт посреди записи. */
function write_json(string $file, array $data): void {
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false || file_put_contents($tmp, $json . "\n") === false || !rename($tmp, $file)) {
        @unlink($tmp);
        throw new RuntimeException('write failed: ' . basename($file));
    }
}

/* Всё «прочитать — поменять — записать» идёт под одной блокировкой: два
   бариста, нажавшие одновременно, не затрут отметки друг друга. */
function with_lock(string $name, callable $fn) {
    $h = fopen(data_dir() . '/' . $name . '.lock', 'c');
    if ($h === false) throw new RuntimeException('lock failed');
    try {
        flock($h, LOCK_EX);
        return $fn();
    } finally {
        flock($h, LOCK_UN);
        fclose($h);
    }
}

/* --- меню ----------------------------------------------------------------- */

/* Список позиций берётся из того же index.html, что видит гость: добавили
   напиток в меню — он сам появился в админке. */
function menu(): array {
    static $cats = null;
    if ($cats !== null) return $cats;
    $html = (string)@file_get_contents($_SERVER['DOCUMENT_ROOT'] . '/index.html');
    $cats = [];
    if (preg_match('~<script id="menu-data" type="application/json">(.*?)</script>~s', $html, $m)) {
        $data = json_decode($m[1], true);
        foreach (($data['categories'] ?? []) as $c) {
            $items = [];
            foreach (($c['items'] ?? []) as $i) {
                if (isset($i['name']) && is_string($i['name'])) $items[] = $i['name'];
            }
            $cats[] = ['name' => (string)($c['name'] ?? ''), 'items' => $items];
        }
    }
    return $cats;
}

function menu_names(): array {
    $all = [];
    foreach (menu() as $c) foreach ($c['items'] as $n) $all[] = $n;
    return $all;
}

/* --- наличие -------------------------------------------------------------- */

/* Пока бариста ничего не отмечал, берём stock.json из репозитория — тот,
   что лежит рядом с сайтом. После первой отметки главным становится файл
   в dearbox-data. */
function read_stock(): array {
    $s = read_json(data_dir() . '/stock.json')
      ?? read_json($_SERVER['DOCUMENT_ROOT'] . '/stock.json')
      ?? [];
    $out = array_values(array_filter((array)($s['out'] ?? []), 'is_string'));
    return [
        'updated'   => (string)($s['updated'] ?? ''),
        'out'       => $out,
        // пустой список JSON записал бы как [], а сайт ждёт объект {}
        'out_sizes' => !empty($s['out_sizes']) && is_array($s['out_sizes']) ? $s['out_sizes'] : new stdClass(),
    ];
}

/* $changes: название => true (нет в наличии) / false (есть). Неизвестные
   названия отбрасываются. Порядок в файле — как в меню. */
function update_stock(array $changes): array {
    return with_lock('stock', function () use ($changes) {
        $names = menu_names();
        $cur = read_stock();
        $out = array_flip($cur['out']);
        foreach ($changes as $name => $isOut) {
            if (!in_array($name, $names, true)) continue;
            if ($isOut) $out[$name] = true; else unset($out[$name]);
        }
        $ordered = array_values(array_filter($names, fn($n) => isset($out[$n])));
        $new = [
            'updated'   => date('c'),
            'out'       => $ordered,
            'out_sizes' => $cur['out_sizes'],
        ];
        write_json(data_dir() . '/stock.json', $new);
        return $new;
    });
}

/* --- пароль и настройка --------------------------------------------------- */

function config(): ?array {
    $c = read_json(data_dir() . '/config.json');
    return ($c && is_string($c['password_hash'] ?? null)) ? $c : null;
}

function setup_allowed(): bool {
    return config() === null && is_file(data_dir() . '/setup.txt');
}

function save_password(string $password): void {
    write_json(data_dir() . '/config.json', [
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'changed'       => date('c'),
    ]);
    @unlink(data_dir() . '/setup.txt');
}

/* Отпечаток хэша пароля хранится в сессии. Пароль поменяли — отпечаток
   не совпадёт, и все старые входы разлогинятся сами. */
function password_fingerprint(): string {
    $c = config();
    return $c ? hash('sha256', $c['password_hash']) : '';
}

/* --- ограничение попыток входа ------------------------------------------- */

/* Возвращает, сколько секунд ещё ждать; 0 — можно пробовать. */
function login_wait(): int {
    return with_lock('attempts', function () {
        $a = attempts_pruned();
        $now = time();
        $mine = $a['ip'][client_ip()] ?? [];
        if (count($mine) >= IP_MAX_FAILS) return max(1, $mine[0] + IP_WINDOW - $now);
        if (count($a['all']) >= ALL_MAX_FAILS) return max(1, $a['all'][0] + ALL_WINDOW - $now);
        return 0;
    });
}

function login_failed(): void {
    with_lock('attempts', function () {
        $a = attempts_pruned();
        $a['ip'][client_ip()][] = time();
        $a['all'][] = time();
        write_json(data_dir() . '/login-attempts.json', $a);
    });
}

function login_succeeded(): void {
    with_lock('attempts', function () {
        $a = attempts_pruned();
        unset($a['ip'][client_ip()]);
        write_json(data_dir() . '/login-attempts.json', $a);
    });
}

function attempts_pruned(): array {
    $a = read_json(data_dir() . '/login-attempts.json') ?? [];
    $now = time();
    $ip = [];
    foreach ((array)($a['ip'] ?? []) as $addr => $ts) {
        $ts = array_values(array_filter((array)$ts, fn($t) => is_int($t) && $t > $now - IP_WINDOW));
        if ($ts) $ip[(string)$addr] = $ts;
    }
    $all = array_values(array_filter((array)($a['all'] ?? []), fn($t) => is_int($t) && $t > $now - ALL_WINDOW));
    return ['ip' => $ip, 'all' => $all];
}

/* --- сессия и CSRF -------------------------------------------------------- */

function start_session(): void {
    $dir = data_dir() . '/sessions';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    session_save_path($dir);
    session_name('dbadmin');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string)(SESSION_DAYS * 86400));
    session_set_cookie_params([
        'lifetime' => SESSION_DAYS * 86400,
        'path'     => '/admin/',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function logged_in(): bool {
    $fp = password_fingerprint();
    return $fp !== '' && hash_equals($fp, (string)($_SESSION['auth'] ?? ''));
}

function log_in(): void {
    session_regenerate_id(true);
    $_SESSION['auth'] = password_fingerprint();
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function log_out(): void {
    $_SESSION = [];
    session_regenerate_id(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function csrf_ok(?string $token): bool {
    return is_string($token) && hash_equals((string)($_SESSION['csrf'] ?? ''), $token);
}

/* Запрос пришёл со страницы нашего же сайта? Браузеры присылают Origin
   при POST — сверяем его с адресом сайта. */
function same_origin(): bool {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin === null) return true;   // старые браузеры; CSRF-токен всё равно проверяется
    $theirs = parse_url($origin, PHP_URL_HOST);
    $mine = parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST);
    return is_string($theirs) && is_string($mine) && strcasecmp($theirs, $mine) === 0;
}

/* Заголовки для всех страниц админки: не кешировать, не индексировать,
   не встраивать в чужие сайты, скрипты и стили — только свои файлы. */
function admin_headers(string $type = 'text/html'): void {
    header('Content-Type: ' . $type . '; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Frame-Options: DENY');
    // same-origin, а не no-referrer: при no-referrer Chrome подписывает
    // отправку формы источником «null», и проверка same_origin() не пускает
    // честного бариста. Чужим сайтам адрес по-прежнему не уходит.
    header('Referrer-Policy: same-origin');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; "
         . "style-src 'self'; script-src 'self'; font-src 'self'; "
         . "form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
}
