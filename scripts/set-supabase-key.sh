#!/bin/sh
# Saves the Supabase service_role / secret key into aura/.env without
# showing it on screen or putting it in shell history.
cd "$(dirname "$0")/.." || exit 1
printf 'Вставьте ключ service_role (ввод скрыт) и нажмите Enter: '
stty -echo
read -r KEY
stty echo
printf '\n'
case "$KEY" in
  eyJ*|sb_secret_*) ;;
  *) echo "Это не похоже на ключ service_role (должен начинаться с eyJ или sb_secret_). Ничего не изменено."; exit 1 ;;
esac
tmp=$(mktemp)
awk -v k="$KEY" 'BEGIN{done=0} /^SUPABASE_SERVICE_ROLE_KEY=/{print "SUPABASE_SERVICE_ROLE_KEY=" k; done=1; next} {print} END{if(!done) print "SUPABASE_SERVICE_ROLE_KEY=" k}' .env > "$tmp" && mv "$tmp" .env
chmod 600 .env
echo "Готово: ключ сохранён в aura/.env"
