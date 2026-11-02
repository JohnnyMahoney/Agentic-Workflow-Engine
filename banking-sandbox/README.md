# Legacy Banking UI Sandbox

Тестовий полігон для AI computer-use automation (Discovery → JSON Capability Contract → Playwright replay).
**Це не банківська система.** Лише вигадані дані, жодних реальних транзакцій, backend чи API — «бекенд» це `api()` у `shared.js`, стан у `localStorage` (ключ `sbx`).

## Запуск
```bash
cd banking-sandbox
python3 -m http.server 8080      # або: npx serve -l 8080
```
Відкрийте http://localhost:8080/ → `modern.html`, `legacy/index.html`, `awkward.html`.

## Файли
`shared.js` — дані, логіка, failure modes, test panel · `modern.html` · `legacy/index.html` (outer table + iframe) + `legacy/content.html` · `awkward.html`.

## Тестові клієнти
| ID | Ім'я | Тип | Баланс |
|---|---|---|---|
| M-1001 | Anna Kovalenko | Checking | $2,450.75 |
| M-1002 | Bohdan Melnyk | Savings | $18,200.00 |
| M-1003 | Sam Rivera | Checking | $310.40 |
| M-1004 | Olena Shevchenko | Business | $92,500.10 |
| M-1005 | Taras Bondar | Term Deposit | $50,000.00 |
| M-1006 | Iryna Lysenko | Savings | $7,640.20 |
| M-1007 | Maksym Tkach | Checking | $0.00 |
| M-1008 | Daria Petrenko | Savings | $1,299.99 |
| M-1009 | Sam Rivera | Savings | $15,800.00 |
| M-1010 | Yuri Savchenko | Business | $430,250.00 |
| M-1011 | Kateryna Moroz | Checking | -$120.50 |
| M-1012 | Leo Hrytsenko | Term Deposit | $25,000.00 |

Дублікат імені (M-1003 / M-1009) — для scoped row/cell selection.

## Сценарії та очікувані результати (усі три UI)
1. **Search ID**: `M-1001` → 1 запис; Details: Anna Kovalenko, Checking; Balance `$2,450.75`.
2. **Search name**: `Sam Rivera` → 2 рядки; вибрати M-1009 → Balance `$15,800.00`.
3. **Open Sub-Account**: M-1002 → тип `Savings` → confirmation `M-1002-S1` (другий раз `-S2`). Деталі клієнта потім показують sub-account.
4. **Coordinate fallback** (Legacy, Customer Details): `<canvas>` «Print Statement» — без тексту/ролі в DOM; клік → «Statement queued (simulated)».
5. Негативні: порожній пошук → `VALIDATION_ERROR`; `zzz` → `NOT_FOUND`.

## Locator challenges
- **Modern**: role/name (`button "View Anna Kovalenko (M-1001)"`), label (`Member ID or name`, `Account type`), `role=alert/status`.
- **Legacy**: iframe `content` (frame traversal), вкладені `<table>`, клікабельні `<td>`/`<span>` без ролей, input без label, scoped row/cell, canvas.
- **Awkward**: дві кнопки `Open` у кожному рядку (1-ша = details, 2-га = sub-account) і ще `Open` на details/finish; глибокі обгортки; live search з debounce 500 мс; рядки з'являються по 150 мс; баланс `…` → значення за 1 с; опції типу з'являються через 800 мс; кнопка `Next` лише після вибору; toast на 1,2 с.

## Failure modes
Test panel (правий нижній кут, лише top window): select + `Reset state`. Режим зберігається, поки його не змінять. URL-швидкість: `/modern.html?mode=SLOW_LOADING`.

| Mode | Поведінка |
|---|---|
| `NONE` | Норма |
| `NOT_FOUND` | Пошук і get → `NOT_FOUND` |
| `VALIDATION_ERROR` | Open sub-account завжди → `VALIDATION_ERROR` (форма лишається; у Legacy — екран помилки + Back) |
| `PERMISSION_DENIED` | Open sub-account → `PERMISSION_DENIED` |
| `SESSION_EXPIRED` | Перший виклик API → помилка + кнопка Log in; після входу далі працює (знову «заряджається» при перемиканні режиму/Reset) |
| `SLOW_LOADING` | Кожен виклик 4 с замість 0,3 с |
| `UNEXPECTED_DIALOG` | Перед кожним викликом модальне вікно «Scheduled maintenance notice» з `OK` |
| `TIMEOUT` | Відповідь ніколи не приходить («Loading…» назавжди) |

`Reset state` очищає sub-accounts, режим → `NONE`, сесія активна.
