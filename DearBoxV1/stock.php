<?php
/* Наличие для сайта: что отметили бариста в админке.

   Данные лежат вне корня сайта (см. admin/lib.php), поэтому сайт читает их
   через этот файл, а не напрямую. Кешировать нельзя: бариста снял позицию —
   следующий гость должен это увидеть.

   Если PHP здесь сломается, app.js возьмёт stock.json из репозитория, а
   если и его нет — покажет всё в наличии. Меню открывается в любом случае. */

declare(strict_types=1);
require __DIR__ . '/admin/lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

echo json_encode(read_stock(), JSON_UNESCAPED_UNICODE);
