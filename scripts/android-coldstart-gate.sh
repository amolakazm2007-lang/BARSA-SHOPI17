#!/usr/bin/env bash
set -euo pipefail

mkdir -p reports
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
mkdir -p "$ANDROID_AVD_HOME"

PACKAGE="com.barsa.shopi"
ACTIVITY="$PACKAGE/.MainActivity"
AVD_NAME="barsa_ci"
SYSTEM_IMAGE="system-images;android-34;google_apis;x86_64"
EMU_PID=""

capture_diagnostics() {
  local reason="${1:-unknown}"
  printf '%s\n' "$reason" > reports/android-gate-failure-reason.txt
  timeout 20s adb logcat -d -v time > reports/android-logcat.txt 2>&1 || true
  timeout 15s adb shell dumpsys activity processes > reports/android-processes.txt 2>&1 || true
  timeout 15s adb shell dumpsys activity exit-info "$PACKAGE" > reports/android-exit-info.txt 2>&1 || true
  timeout 15s adb shell dumpsys activity activities > reports/android-activities.txt 2>&1 || true
  timeout 15s adb shell dumpsys window windows > reports/android-windows.txt 2>&1 || true
  timeout 15s adb shell dumpsys meminfo "$PACKAGE" > reports/android-meminfo-failure.txt 2>&1 || true
  timeout 10s adb exec-out screencap -p > reports/android-failure.png 2>/dev/null || true
}

cleanup() {
  timeout 10s adb emu kill >/dev/null 2>&1 || true
  if [[ -n "${EMU_PID:-}" ]]; then
    kill "$EMU_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

printf 'no\n' | avdmanager create avd \
  --force \
  --name "$AVD_NAME" \
  --package "$SYSTEM_IMAGE" \
  --device "pixel_5" \
  > reports/android-avd-create.log 2>&1

adb kill-server || true
adb start-server
"$ANDROID_HOME/emulator/emulator" \
  -avd "$AVD_NAME" \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -no-snapshot-load \
  -no-snapshot-save \
  -gpu swiftshader_indirect \
  -camera-back none \
  -camera-front none \
  -memory 3072 \
  -cores 2 \
  -no-metrics \
  > reports/android-emulator.log 2>&1 &
EMU_PID=$!

BOOTED=0
for ATTEMPT in $(seq 1 120); do
  STATE="$(timeout 5s adb get-state 2>/dev/null || true)"
  BOOT="$(timeout 5s adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [[ "$STATE" == "device" && "$BOOT" == "1" ]]; then
    BOOTED=1
    break
  fi
  if ! kill -0 "$EMU_PID" 2>/dev/null; then
    tail -n 200 reports/android-emulator.log || true
    echo 'Emulator process exited before Android boot completed' >&2
    exit 1
  fi
  sleep 5
done

if [[ "$BOOTED" != "1" ]]; then
  capture_diagnostics 'EMULATOR_BOOT_TIMEOUT'
  tail -n 200 reports/android-emulator.log || true
  echo 'Android emulator failed to reach sys.boot_completed=1' >&2
  exit 1
fi

printf 'EMULATOR_BOOTED\n' | tee reports/android-emulator-booted.txt
printf 'SCRIPT_ENTERED\n' | tee reports/android-script-entered.txt
timeout 10s adb devices -l | tee reports/android-adb-devices.txt
timeout 10s adb get-state | tee reports/android-adb-state.txt

APK="$(find android/app/build/outputs/apk/debug -name '*.apk' | head -n 1)"
test -s "$APK"
if ! timeout 90s adb install -r "$APK" | tee reports/android-install.log; then
  capture_diagnostics 'APK_INSTALL_TIMEOUT_OR_FAILURE'
  exit 1
fi
grep -Eq 'Success|success' reports/android-install.log
printf 'APK_INSTALLED\n' | tee reports/android-apk-installed.txt

timeout 10s adb logcat -c || true
for PASS in 1 2 3; do
  timeout 10s adb shell am force-stop "$PACKAGE" || true

  set +e
  timeout 30s adb shell am start -W -n "$ACTIVITY" > "reports/android-launch-${PASS}.log" 2>&1
  START_STATUS=$?
  set -e
  cat "reports/android-launch-${PASS}.log"

  if [[ "$START_STATUS" -ne 0 ]]; then
    capture_diagnostics "LAUNCH_${PASS}_TIMEOUT_OR_FAILURE"
    echo "BARSA cold-start pass $PASS did not complete am start -W within 30 seconds" >&2
    exit 1
  fi

  sleep 10
  PID="$(timeout 10s adb shell pidof "$PACKAGE" 2>/dev/null || true)"
  PID="$(printf '%s' "$PID" | tr -d '\r')"
  if [[ -z "$PID" ]]; then
    capture_diagnostics "LAUNCH_${PASS}_PROCESS_DIED"
    echo "BARSA process died during cold-start pass $PASS" >&2
    exit 1
  fi

  printf 'LAUNCH_%s_PID=%s\n' "$PASS" "$PID" | tee "reports/android-launch-${PASS}-pid.txt"

  timeout 10s adb shell dumpsys activity activities > "reports/android-activities-${PASS}.txt" 2>&1 || true
  if ! grep -q "mResumedActivity.*${PACKAGE}" "reports/android-activities-${PASS}.txt"; then
    capture_diagnostics "LAUNCH_${PASS}_NOT_RESUMED"
    echo "BARSA process exists but MainActivity is not resumed during pass $PASS" >&2
    exit 1
  fi

done

timeout 10s adb exec-out screencap -p > reports/android-startup.png 2>/dev/null || true
timeout 15s adb shell uiautomator dump /sdcard/barsa-window.xml >/dev/null 2>&1 || true
timeout 15s adb pull /sdcard/barsa-window.xml reports/android-window.xml >/dev/null 2>&1 || true
timeout 20s adb logcat -d -v time > reports/android-logcat.txt
test -s reports/android-logcat.txt
printf 'LOGCAT_CAPTURED\n' | tee reports/android-logcat-captured.txt

if grep -E "FATAL EXCEPTION|ANR in ${PACKAGE//./\\.}|am_crash.*${PACKAGE//./\\.}|Process ${PACKAGE//./\\.} .* has died" reports/android-logcat.txt; then
  capture_diagnostics 'CRASH_OR_ANR_SIGNATURE'
  echo 'Crash/ANR signature detected in Android cold-start gate' >&2
  exit 1
fi

timeout 15s adb shell dumpsys meminfo "$PACKAGE" > reports/android-meminfo.txt
test -s reports/android-meminfo.txt
printf 'PASSED\n' | tee reports/android-coldstart-gate.txt
