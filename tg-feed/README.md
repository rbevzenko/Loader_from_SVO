# Telegram Feed — @loaderfromSVO

Веб-сайт, отображающий посты из Telegram-канала [@loaderfromSVO](https://t.me/loaderfromSVO) в виде ленты.

## Стек

- **Бэкенд**: Python + FastAPI + Telethon (Telegram MTProto API) + SQLite
- **Фронтенд**: HTML + CSS + Vanilla JS (без фреймворков)
- **Медиа**: фото и видео скачиваются и раздаются локально

---

## 1. Получение Telegram API Credentials

1. Перейдите на [https://my.telegram.org](https://my.telegram.org) и войдите в свой аккаунт Telegram.
2. Выберите **API development tools**.
3. Заполните форму (любое название приложения) и нажмите **Create application**.
4. Скопируйте значения **App api_id** и **App api_hash**.

> **Важно**: Credentials привязаны к вашему аккаунту. Не публикуйте их в открытых репозиториях.

---

## 2. Установка зависимостей

### Требования

- Python 3.10+
- pip

### Настройка

```bash
# Перейдите в директорию проекта
cd tg-feed

# Создайте и активируйте виртуальное окружение
python -m venv .venv
source .venv/bin/activate        # Linux / macOS
# .venv\Scripts\activate         # Windows

# Установите зависимости
pip install -r backend/requirements.txt
```

### Конфигурация

```bash
# Скопируйте пример файла окружения
cp backend/.env.example backend/.env

# Отредактируйте backend/.env — заполните ваши данные:
#   TELEGRAM_API_ID=12345678
#   TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
```

Параметры файла `.env`:

| Переменная         | Описание                                             | По умолчанию          |
|--------------------|------------------------------------------------------|-----------------------|
| `TELEGRAM_API_ID`  | API ID с my.telegram.org                            | —                     |
| `TELEGRAM_API_HASH`| API Hash с my.telegram.org                          | —                     |
| `TELEGRAM_CHANNEL` | Username канала без @                               | `loaderfromSVO`       |
| `SESSION_NAME`     | Имя файла сессии Telethon                           | `tg_session`          |
| `DATABASE_PATH`    | Путь к SQLite базе данных                           | `../data/posts.db`    |
| `MEDIA_PATH`       | Директория для медиафайлов                          | `../media`            |
| `UPDATE_INTERVAL`  | Интервал обновления в секундах                      | `300` (5 минут)       |
| `MESSAGES_LIMIT`   | Количество последних сообщений для загрузки          | `100`                 |

---

## 3. Запуск проекта

```bash
cd tg-feed/backend

# Первый запуск — Telethon запросит номер телефона для авторизации
python main.py
```

При первом запуске Telethon попросит:
1. Номер телефона (в международном формате, например `+79001234567`)
2. Код подтверждения из Telegram
3. (Опционально) Пароль двухфакторной аутентификации

После авторизации файл сессии (`tg_session.session`) сохраняется локально — повторная авторизация не нужна.

Сервер запустится на **http://localhost:8000**

> Для запуска через uvicorn напрямую:
> ```bash
> uvicorn main:app --host 0.0.0.0 --port 8000 --reload
> ```

---

## 4. Структура проекта

```
tg-feed/
├── backend/
│   ├── main.py          # FastAPI приложение, планировщик, API эндпоинты
│   ├── scraper.py       # Telethon клиент, скачивание медиа
│   ├── models.py        # SQLite операции (aiosqlite)
│   ├── requirements.txt
│   └── .env.example     # Пример конфигурации
├── frontend/
│   ├── index.html       # Разметка
│   ├── style.css        # Стили (mobile-first, адаптивный)
│   └── app.js           # Логика: бесконечный скролл, lightbox, API
├── media/               # Скачанные медиафайлы (создаётся автоматически)
├── data/                # SQLite база (создаётся автоматически)
└── README.md
```

---

## 5. API эндпоинты

| Метод  | URL                  | Описание                              |
|--------|----------------------|---------------------------------------|
| GET    | `/api/posts`         | Список постов (параметры: `limit`, `offset`) |
| GET    | `/api/posts/{id}`    | Один пост по ID                       |
| GET    | `/api/status`        | Статус сервера и Telegram подключения |
| POST   | `/api/refresh`       | Запустить обновление вручную          |
| GET    | `/media/{filename}`  | Скачанный медиафайл                   |
| GET    | `/`                  | Фронтенд (index.html)                 |

---

## 6. Автоматическое обновление

По умолчанию скрапер запускается каждые **5 минут** (300 секунд) автоматически через APScheduler прямо внутри FastAPI-процесса.

Для изменения интервала отредактируйте `.env`:
```
UPDATE_INTERVAL=120   # каждые 2 минуты
```

### Запуск только скрапера (без веб-сервера)

```bash
cd tg-feed/backend
python scraper.py
```

### systemd (для VPS/Linux сервера)

Создайте файл `/etc/systemd/system/tg-feed.service`:

```ini
[Unit]
Description=Telegram Feed Web App
After=network.target

[Service]
WorkingDirectory=/path/to/tg-feed/backend
EnvironmentFile=/path/to/tg-feed/backend/.env
ExecStart=/path/to/tg-feed/.venv/bin/python main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable tg-feed
sudo systemctl start tg-feed
sudo systemctl status tg-feed
```

---

## 7. Возможные проблемы

**`FloodWaitError`** — Telegram ограничил запросы. Подождите указанное время и попробуйте снова.

**`SessionPasswordNeededError`** — требуется пароль 2FA. Введите его при первом запуске.

**Медиа не скачивается** — убедитесь, что директория `media/` доступна для записи.

**Пустая лента** — проверьте, что скрапер запустился (логи в консоли) и канал доступен.
