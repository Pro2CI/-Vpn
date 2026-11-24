# Violet VPN — инженерный статус

Дата: 23 ноября 2026 г.

## Что сделано в этой итерации

1. Подготовлено стандартное Android Gradle source tree: `android-native/src/main/AndroidManifest.xml`, Kotlin source paths, drawable launcher icon.
2. Добавлены `settings.gradle.kts` и корневой `build.gradle.kts`; Android module `android-native` подключён как Gradle project `:app`, что соответствует задаче `:app:assembleDebug`.
3. Переработан GitHub Actions workflow: собирается web UI, скачивается Android SDK platform 35, собирается официальный XTLS/libXray AAR, затем выполняется `:app:assembleDebug` и выгружается APK artifact.
4. Добавлен native VLESS runtime в `VioletWireGuardService.kt`: создание Android TUN, `DialerController` для socket protect, `setDNS`, VLESS URI → Xray outbounds через `convertShareLinksToXrayJson` (API v3), `env.xray.tun.fd`, `runXray`, `getXrayState`, остановка Xray и сброс DNS.
5. Сервис не сообщает «Подключено», пока Xray не вернул успешный ответ и `getXrayState.running` не подтвердил работающий экземпляр.
6. Остальные proxy-протоколы пока остаются fail-closed; WireGuard использует отдельный GoBackend.
7. Исправлена PWA-метаинформация: теперь приложение описывается как VLESS-клиент, а не как WireGuard-only.

## Основание интеграции

Сверена текущая документация XTLS/libXray и зафиксирован upstream commit `6e33510350d18a9b906495ff81ae9eb572144ddd`, чтобы сборка не зависела от будущих изменений main. Используется Invoke API v3, методы `convertShareLinksToXrayJson`, `runXray`, `stopXray`, `getXrayState`, Android `DialerController`, `setDNS`/`resetDNS` и передача TUN FD через root config `env.xray.tun.fd`. Парсер возвращает `data.outbounds`; конфигурация Xray собирается приложением вокруг этих outbound-объектов.

## Что ещё НЕ подтверждено

- npm install/build не выполнены локально: установка зависимостей в этой среде завершилась по тайм-ауту.
- Gradle/Android SDK в локальном runtime отсутствуют; Kotlin compilation не запускалась.
- Новый workflow ещё не выполнил сборку этого полного исходного дерева.
- Нет теста на физическом Android-устройстве с реальной VLESS REALITY + XHTTP ссылкой. Следовательно, нельзя пока заявлять, что APK готов к релизу или что все узлы работают.
- GitHub-репозиторий `Pro2CI/-Vpn` всё ещё не содержит полного исходного дерева из ZIP. Архив подготовлен локально, но его полный upload в репозиторий не выполнен.

## Следующий технический барьер

Нужно загрузить полный архив в репозиторий, запустить CI и исправлять фактические ошибки компиляции/линковки. После получения APK требуется тест на Android: разрешение VPN, запуск Xray, трафик IPv4/IPv6, DNS без утечек, reconnect/disconnect, проверка REALITY + XHTTP на валидном узле.

**Статус поставки: source package + native integration draft; APK ещё не собран и device-tested не был.**


## Исправления сборочной конфигурации (23.11.2026)

- Зафиксирован `esbuild` версии `0.28.2`, совместимой с Vite 8; добавлен npm override, чтобы транзитивное разрешение не вернуло несовместимую версию.
- Удалён устаревший `bun.lock`, в котором был зафиксирован `esbuild 0.25.12` и который расходился с `package.json`.
- Workflow теперь проверяет наличие ключевых файлов Android/web-проекта до установки зависимостей, включает строгую проверку peer dependencies и выводит фактические версии Vite/esbuild.
- Сборка не запускалась: текущая среда не смогла завершить загрузку npm-зависимостей; это изменение устраняет известную причину ERESOLVE в CI, но ещё не является подтверждением успешной сборки.

- Исправлена опасная логика WireGuard: приложение больше не сообщает «подключено», если за время проверки не получено handshake; при ошибке пытается опустить интерфейс.
- Удалено маскирование AmneziaWG под обычный WireGuard: профили с AmneziaWG-параметрами теперь явно отклоняются, поскольку полноценный движок AmneziaWG не интегрирован.
