#!/bin/sh
# Serves AURA to phones on the same Wi-Fi: http://<Mac address>:8800
cd "$(dirname "$0")/.."
npm run build >/dev/null
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "  📱 Откройте на телефоне:  http://${IP:-адрес-Mac}:8800"
echo "  (телефон должен быть в той же сети; закройте это окно, чтобы остановить)"
echo ""
API_PORT=8800 NODE_ENV=production npx tsx server/index.ts
