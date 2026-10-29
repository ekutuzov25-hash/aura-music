#!/bin/sh
# Saves SoundCloud Client ID / Client Secret into aura/.env without showing
# the secret on screen or putting it in shell history.
cd "$(dirname "$0")/.." || exit 1

set_var() {
  tmp=$(mktemp)
  awk -v n="$1" -v v="$2" 'BEGIN{done=0} index($0, n "=")==1 {print n "=" v; done=1; next} {print} END{if(!done) print n "=" v}' .env > "$tmp" && mv "$tmp" .env
}

clean() { printf '%s' "$1" | tr -d ' \t\r\n'; }

printf 'Вставьте Client ID и нажмите Enter: '
read -r ID
ID=$(clean "$ID")
printf 'Вставьте Client Secret (ввод скрыт) и нажмите Enter: '
stty -echo
read -r SECRET
stty echo
printf '\n'
SECRET=$(clean "$SECRET")

case "$ID" in *[!A-Za-z0-9_-]*|'') echo "Client ID выглядит неправильно. Ничего не изменено."; exit 1 ;; esac
case "$SECRET" in *[!A-Za-z0-9_-]*|'') echo "Client Secret выглядит неправильно. Ничего не изменено."; exit 1 ;; esac
if [ ${#ID} -gt 64 ] || [ ${#SECRET} -gt 64 ]; then
  echo "Ключ слишком длинный — похоже, вставился несколько раз. Ничего не изменено."; exit 1
fi

set_var SOUNDCLOUD_CLIENT_ID "$ID"
set_var SOUNDCLOUD_CLIENT_SECRET "$SECRET"
chmod 600 .env
echo "Готово: ключи SoundCloud сохранены в aura/.env"
