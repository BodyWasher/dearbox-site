<?php
/* Приём нажатий из админки. Отвечает JSON-ом.

   GET               — текущее наличие (админка подтягивает его, когда
                       телефон разблокировали: вдруг другой бариста уже
                       что-то поменял).
   POST {action: "set", name, out}  — отметить одну позицию;
   POST {action: "reset"}           — вернуть всё в наличие.

   Любой запрос — только для вошедших. Изменения — только с CSRF-токеном
   в заголовке X-CSRF-Token и с нашего же сайта. В ответ всегда уходит
   полное состояние: админка перерисовывает все переключатели по нему, и
   у двух бариста на двух телефонах картина не расходится. */

declare(strict_types=1);
require __DIR__ . '/lib.php';

start_session();
admin_headers('application/json');

function reply(int $code, array $body): never {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!logged_in()) reply(401, ['error' => 'Нужно войти заново.']);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    reply(200, read_stock());
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(405, ['error' => 'Метод не поддерживается.']);

if (!same_origin() || !csrf_ok($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
    reply(403, ['error' => 'Страница устарела. Обновите её.']);
}

$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) reply(400, ['error' => 'Непонятный запрос.']);

try {
    switch ($in['action'] ?? '') {
        case 'set':
            $name = $in['name'] ?? null;
            if (!is_string($name) || !in_array($name, menu_names(), true)) {
                reply(400, ['error' => 'Такой позиции нет в меню.']);
            }
            reply(200, update_stock([$name => (bool)($in['out'] ?? false)]));

        case 'reset':
            reply(200, update_stock(array_fill_keys(menu_names(), false)));

        default:
            reply(400, ['error' => 'Непонятный запрос.']);
    }
} catch (Throwable $e) {
    error_log('dearbox admin: ' . $e->getMessage());
    reply(500, ['error' => 'Не удалось сохранить. Попробуйте ещё раз.']);
}
