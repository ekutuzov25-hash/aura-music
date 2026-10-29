#!/bin/sh
# Builds every AURA installer and puts each one into its device folder on the
# Desktop, replacing the previous version:
#
#   ~/Desktop/AURA/Установщики/
#     macOS — Apple Silicon (M1–M4)/   AURA-x.y.z-mac-arm64.dmg
#     macOS — Intel/                   AURA-x.y.z-mac-x64.dmg
#     Windows/                         AURA-x.y.z-win-x64.exe
#     Телефон (iPhone и Android)/      how to open AURA on a phone
#
# Usage:  sh scripts/update-installers.sh
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
ROOT="$HOME/Desktop/AURA/Установщики"
MAC_ARM="$ROOT/macOS — Apple Silicon (M1–M4)"
MAC_X64="$ROOT/macOS — Intel"
WIN="$ROOT/Windows"
PHONE="$ROOT/Телефон (iPhone и Android)"

echo "▶ Сборка AURA $VERSION…"
osascript -e 'quit app "AURA"' >/dev/null 2>&1 || true
rm -rf release
npm run build >/dev/null
npm run build:electron >/dev/null
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 >/dev/null
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64 >/dev/null
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win >/dev/null

for f in "release/AURA-$VERSION-mac-arm64.dmg" "release/AURA-$VERSION-mac-x64.dmg" "release/AURA-$VERSION-win-x64.exe"; do
  [ -f "$f" ] || { echo "✗ Нет файла $f — сборка не удалась"; exit 1; }
done
hdiutil verify "release/AURA-$VERSION-mac-arm64.dmg" >/dev/null 2>&1 || { echo "✗ DMG Apple Silicon повреждён"; exit 1; }
hdiutil verify "release/AURA-$VERSION-mac-x64.dmg" >/dev/null 2>&1 || { echo "✗ DMG Intel повреждён"; exit 1; }

mkdir -p "$MAC_ARM" "$MAC_X64" "$WIN" "$PHONE"
# replace old versions
rm -f "$MAC_ARM"/AURA-*.dmg "$MAC_X64"/AURA-*.dmg "$WIN"/AURA-*.exe
cp "release/AURA-$VERSION-mac-arm64.dmg" "$MAC_ARM/"
cp "release/AURA-$VERSION-mac-x64.dmg" "$MAC_X64/"
cp "release/AURA-$VERSION-win-x64.exe" "$WIN/"

cat > "$MAC_ARM/Как установить.txt" <<EOF
AURA $VERSION для Mac с процессором Apple (M1, M2, M3, M4)
Проверить процессор:  → «Об этом Mac» → строка «Чип».

1. Откройте AURA-$VERSION-mac-arm64.dmg и перетащите AURA в «Программы».
2. Первый запуск: правой кнопкой по AURA → «Открыть» → «Открыть».
3. Если macOS пишет «приложение повреждено», выполните в Терминале:
     xattr -cr /Applications/AURA.app
EOF
sed -e "s/процессором Apple (M1, M2, M3, M4)/процессором Intel/" -e "s/строка «Чип»/строка «Процессор» (Intel)/" -e "s/mac-arm64/mac-x64/" "$MAC_ARM/Как установить.txt" > "$MAC_X64/Как установить.txt"
cat > "$WIN/Как установить.txt" <<EOF
AURA $VERSION для Windows 10 и 11 (64-бит)

1. Запустите AURA-$VERSION-win-x64.exe и следуйте шагам установщика.
2. Если появится синее окно SmartScreen: «Подробнее» → «Выполнить в любом случае».
   (Предупреждение появляется, потому что у приложения нет платной подписи Microsoft.)
EOF
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "адрес-вашего-Mac")
cat > "$PHONE/Как открыть на телефоне.txt" <<EOF
AURA на iPhone и Android

Отдельного установщика для телефона нет: AURA открывается в браузере и
добавляется на экран «Домой» как приложение.

1. На Mac запустите сервер для телефона (в Терминале):
     cd ~/AURA-music/aura && npm run phone
2. Телефон должен быть в той же Wi-Fi сети, что и Mac (или раздавать Mac интернет).
3. Откройте в Safari / Chrome на телефоне:
     http://$IP:8800
   (адрес меняется при смене сети — команда из шага 1 покажет актуальный)
4. iPhone: «Поделиться» → «На экран "Домой"».
   Android: меню ⋮ → «Добавить на главный экран».
EOF
# the loose files from older versions in ~/Desktop/AURA are now in device folders
rm -f "$HOME/Desktop/AURA"/AURA-*.dmg "$HOME/Desktop/AURA"/AURA-*.exe "$HOME/Desktop/AURA/Как установить.txt"

echo "✓ AURA $VERSION разложена по папкам:"
echo "  $ROOT"
ls -R "$ROOT" | sed 's/^/    /'
