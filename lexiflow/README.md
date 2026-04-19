# LexiFlow (Petrovskaia VKR)

Веб‑приложение для аудита юридических документов: извлечение ключевых фрагментов (пункты/сущности) и генерация описания рисков с рекомендациями. Фронтенд (Vite + React) и бэкенд (Express) живут в одном проекте; API для анализа реализован в `server.ts`.

## Возможности

- Загрузка документов и запуск анализа через `/api/analyze-document`.
- Извлечение текста из PDF/DOCX/DOC и изображений (OCR).
- Формирование структуры результата: список пунктов (`clauses`) и карточка риска (`risk`).
- Режим production: раздача `dist/` тем же Express‑сервером.

## Требования

- **Node.js 18+** (рекомендуется 20+).
- **npm** (идёт с Node.js).
- Для OCR и старых `.doc`:
  - `tesseract-ocr`
  - `antiword`
- Для reverse proxy и SSL (опционально на сервере):
  - `nginx`
  - `certbot` (Let's Encrypt)

## Переменные окружения

Скопируйте пример и заполните ключ:

- Файл: `lexiflow/.env.local` (не коммитить)
- Пример: `lexiflow/.env.example`

Минимально необходимо:

- `GEMINI_API_KEY` — ключ для LLM‑провайдера (в текущей интеграции используется как Bearer‑токен).

Опционально:

- `LLMOST_API_BASE_URL` — базовый URL OpenAI‑совместимого API (по умолчанию `https://llmost.ru/api/v1`).
- `LLMOST_MODEL_ANALYZE` — модель для анализа (по умолчанию `openai/gpt-4`).
- `LLMOST_MODEL_CHAT` — модель для чата Лекси (по умолчанию `openai/gpt-4`).
- `PORT` — порт сервера (по умолчанию 3000; в systemd можно переопределить).

## Установка и запуск локально

```bash
cd lexiflow
npm install
cp .env.example .env.local
# отредактируйте .env.local и задайте GEMINI_API_KEY
npm run dev
```

После старта приложение будет доступно по адресу, который выводится в логах (например, `http://localhost:3000`).

## Сборка и запуск в production

```bash
cd lexiflow
npm install
npm run build
NODE_ENV=production PORT=3020 npm run dev
```

В production Express будет отдавать собранный фронтенд из `dist/` и обслуживать API.

## Развертывание на сервере (пример: systemd + nginx)

### systemd unit

Пример файла `/etc/systemd/system/lexiflow.service`:

```ini
[Unit]
Description=LexiFlow (Vite + Express)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lexiflow/lexiflow
Environment=NODE_ENV=production
Environment=PORT=3020
EnvironmentFile=-/opt/lexiflow/lexiflow/.env.local
ExecStart=/opt/lexiflow/lexiflow/node_modules/.bin/tsx server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Команды:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lexiflow.service
sudo systemctl status lexiflow.service
```

### nginx reverse proxy (пример)

```nginx
server {
  server_name example.com;

  client_max_body_size 60m;

  location / {
    proxy_pass http://127.0.0.1:3020;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Примечания по обработке документов

- Для сканированных PDF может потребоваться OCR (Tesseract), поэтому на сервере важно иметь `tesseract`.
- Для старых файлов `.doc` используется `antiword`; если его нет, извлечение текста из `.doc` будет падать.

