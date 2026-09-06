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

wait_for_adb_device() {
  local attempts="${1:-18}"
  local delay="${2:-5}"
  local state=""
  for _ in $(seq 1 "$attempts"); do
    if [[ -n "${EMU_PID:-}" ]] && ! kill -0 "$EMU_PID" 2>/dev/null; then
      return 2
    fi
    state="$(timeout 5s adb get-state 2>/dev/null || true)"
    if [[ "$state" == "device" ]]; then
      return 0
    fi
    timeout 5s adb reconnect >/dev/null 2>&1 || true
    sleep "$delay"
  done
  return 1
}

read_boot_id() {
  local attempts="${1:-6}"
  local delay="${2:-2}"
  local boot_id=""
  for _ in $(seq 1 "$attempts"); do
    boot_id="$(timeout 5s adb shell cat /proc/sys/kernel/random/boot_id 2>/dev/null | tr -d '\r\n' || true)"
    if [[ -n "$boot_id" ]]; then
      printf '%s' "$boot_id"
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

capture_diagnostics() {
  local reason="${1:-unknown}"
  printf '%s\n' "$reason" > reports/android-gate-failure-reason.txt

  # Diagnostics must not become empty merely because the emulator transport is
  # transiently offline. Give ADB a bounded recovery window before collecting.
  wait_for_adb_device 12 2 >/dev/null 2>&1 || true
  timeout 10s adb devices -l > reports/android-adb-devices-failure.txt 2>&1 || true
  timeout 20s adb logcat -d -v time > reports/android-logcat.txt 2>&1 || true
  timeout 15s adb shell dumpsys activity processes > reports/android-processes.txt 2>&1 || true
  timeout 15s adb shell dumpsys activity exit-info "$PACKAGE" > reports/android-exit-info.txt 2>&1 || true
  timeout 15s adb shell dumpsys activity activities > reports/android-activities.txt 2>&1 || true
  timeout 15s adb shell dumpsys window windows > reports/android-windows.txt 2>&1 || true
  timeout 15s adb shell dumpsys meminfo "$PACKAGE" > reports/android-meminfo-failure.txt 2>&1 || true
  timeout 10s adb exec-out screencap -p > reports/android-failure.png 2>/dev/null || true
  tail -n 200 reports/android-emulator.log > reports/android-emulator-tail.txt 2>/dev/null || true
}

has_app_crash_signature() {
  local file="$1"
  grep -E "FATAL EXCEPTION|ANR in ${PACKAGE//./\\.}|am_crash.*${PACKAGE//./\\.}|Process ${PACKAGE//./\\.} .* has died" "$file" >/dev/null 2>&1
}

start_activity_command() {
  local pass="$1"
  local log="reports/android-launch-${pass}.log"
  : > "$log"

  # Do not use `am start -W` here. On the Android emulator its waiter can hang
  # when the ADB transport reconnects even though Android/app state is healthy.
  # We validate the stronger conditions (live PID + resumed MainActivity)
  # independently below.
  set +e
  timeout 12s adb shell am start -n "$ACTIVITY" >> "$log" 2>&1
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    return 0
  fi

  printf '\n[first start command status=%s; attempting bounded ADB recovery]\n' "$status" >> "$log"
  if ! wait_for_adb_device 12 2; then
    return 1
  fi

  set +e
  timeout 12s adb shell am start -n "$ACTIVITY" >> "$log" 2>&1
  status=$?
  set -e
  return "$status"
}

wait_for_app_ready() {
  local pass="$1"
  local pid=""
  local process_seen=0
  local activities_file="reports/android-activities-${pass}.txt"

  for _ in $(seq 1 30); do
    if [[ -n "${EMU_PID:-}" ]] && ! kill -0 "$EMU_PID" 2>/dev/null; then
      return 4
    fi

    if ! wait_for_adb_device 2 1; then
      sleep 1
      continue
    fi

    pid="$(timeout 6s adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$pid" ]]; then
      process_seen=1
      timeout 8s adb shell dumpsys activity activities > "$activities_file" 2>&1 || true
      if grep -Eq "(topResumedActivity=|ResumedActivity:|mResumedActivity=).*${PACKAGE}/\.MainActivity" "$activities_file"; then
        printf '%s' "$pid"
        return 0
      fi
    elif [[ "$process_seen" -eq 1 ]]; then
      return 3
    fi

    sleep 2
  done

  if [[ "$process_seen" -eq 1 ]]; then
    return 2
  fi
  return 1
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

if ! INITIAL_BOOT_ID="$(read_boot_id 8 2)"; then
  capture_diagnostics 'EMULATOR_BOOT_ID_UNAVAILABLE'
  echo 'Android emulator booted but stable boot identity could not be read' >&2
  exit 1
fi
printf 'BOOT_ID=%s\n' "$INITIAL_BOOT_ID" | tee reports/android-boot-id.txt

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
  if ! wait_for_adb_device 10 2; then
    capture_diagnostics "LAUNCH_${PASS}_ADB_OFFLINE_BEFORE_START"
    echo "Android device went offline before BARSA cold-start pass $PASS" >&2
    exit 1
  fi

  timeout 10s adb shell am force-stop "$PACKAGE" || true
  sleep 1

  if ! start_activity_command "$PASS"; then
    capture_diagnostics "LAUNCH_${PASS}_START_COMMAND_FAILURE"
    cat "reports/android-launch-${PASS}.log" || true
    echo "BARSA cold-start pass $PASS could not issue a stable activity-start command" >&2
    exit 1
  fi
  cat "reports/android-launch-${PASS}.log"

  set +e
  PID="$(wait_for_app_ready "$PASS")"
  READY_STATUS=$?
  set -e

  if [[ "$READY_STATUS" -eq 4 ]]; then
    capture_diagnostics "LAUNCH_${PASS}_EMULATOR_EXITED"
    echo "Android emulator exited during BARSA cold-start pass $PASS" >&2
    exit 1
  elif [[ "$READY_STATUS" -eq 3 || "$READY_STATUS" -eq 1 ]]; then
    capture_diagnostics "LAUNCH_${PASS}_PROCESS_DIED"
    echo "BARSA process failed to remain alive during cold-start pass $PASS" >&2
    exit 1
  elif [[ "$READY_STATUS" -eq 2 ]]; then
    capture_diagnostics "LAUNCH_${PASS}_NOT_RESUMED"
    echo "BARSA process exists but MainActivity is not resumed during pass $PASS" >&2
    exit 1
  fi

  printf 'LAUNCH_%s_PID=%s\n' "$PASS" "$PID" | tee "reports/android-launch-${PASS}-pid.txt"

  if ! CURRENT_BOOT_ID="$(read_boot_id 8 2)"; then
    capture_diagnostics "LAUNCH_${PASS}_BOOT_ID_UNAVAILABLE"
    echo "Android device remained online but boot identity could not be read after pass $PASS" >&2
    exit 1
  fi
  printf 'LAUNCH_%s_BOOT_ID=%s\n' "$PASS" "$CURRENT_BOOT_ID" | tee "reports/android-launch-${PASS}-boot-id.txt"
  if [[ "$CURRENT_BOOT_ID" != "$INITIAL_BOOT_ID" ]]; then
    capture_diagnostics "LAUNCH_${PASS}_DEVICE_REBOOTED"
    echo "Android guest boot identity changed during BARSA cold-start pass $PASS" >&2
    exit 1
  fi

  timeout 15s adb logcat -d -v time > "reports/android-logcat-${PASS}.txt" 2>&1 || true
  if has_app_crash_signature "reports/android-logcat-${PASS}.txt"; then
    capture_diagnostics "LAUNCH_${PASS}_CRASH_OR_ANR_SIGNATURE"
    echo "Crash/ANR signature detected during BARSA cold-start pass $PASS" >&2
    exit 1
  fi

done

timeout 10s adb exec-out screencap -p > reports/android-startup.png 2>/dev/null || true
timeout 15s adb shell uiautomator dump /sdcard/barsa-window.xml >/dev/null 2>&1 || true
timeout 15s adb pull /sdcard/barsa-window.xml reports/android-window.xml >/dev/null 2>&1 || true
if ! wait_for_adb_device 12 2; then
  capture_diagnostics 'ADB_OFFLINE_BEFORE_FINAL_LOGCAT'
  exit 1
fi
timeout 20s adb logcat -d -v time > reports/android-logcat.txt
test -s reports/android-logcat.txt
printf 'LOGCAT_CAPTURED\n' | tee reports/android-logcat-captured.txt

if has_app_crash_signature reports/android-logcat.txt; then
  capture_diagnostics 'CRASH_OR_ANR_SIGNATURE'
  echo 'Crash/ANR signature detected in Android cold-start gate' >&2
  exit 1
fi

timeout 15s adb shell dumpsys meminfo "$PACKAGE" > reports/android-meminfo.txt
test -s reports/android-meminfo.txt
printf 'PASSED\n' | tee reports/android-coldstart-gate.txt
