import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gatePath = new URL('../scripts/android-coldstart-gate.sh', import.meta.url);

async function source() {
  return readFile(gatePath, 'utf8');
}

test('cold-start gate uses stable boot identity to detect guest reboot', async () => {
  const script = await source();

  assert.match(script, /read_boot_id\(\)/);
  assert.match(script, /\/proc\/sys\/kernel\/random\/boot_id/);
  assert.match(script, /INITIAL_BOOT_ID="\$\(read_boot_id/);
  assert.match(script, /CURRENT_BOOT_ID="\$\(read_boot_id/);
  assert.match(script, /"\$CURRENT_BOOT_ID" != "\$INITIAL_BOOT_ID"/);
});

test('cold-start gate does not classify one transient boot_completed read as reboot', async () => {
  const script = await source();

  assert.doesNotMatch(script, /BOOT_AFTER=/);
  assert.doesNotMatch(script, /\[\[ "\$BOOT_AFTER" != "1" \]\]/);
  assert.match(script, /LAUNCH_\$\{PASS\}_BOOT_ID_UNAVAILABLE/);
  assert.match(script, /LAUNCH_\$\{PASS\}_DEVICE_REBOOTED/);
});

test('cold-start gate validates startup independently of fragile am start waiter', async () => {
  const script = await source();

  // Comments may document why `am start -W` is forbidden; reject only an
  // executable ADB invocation so this contract tests behavior, not prose.
  assert.doesNotMatch(script, /adb shell am start\s+-W\b/);
  assert.match(script, /start_activity_command\(\)/);
  assert.match(script, /wait_for_app_ready\(\)/);
  assert.match(script, /pidof "\$PACKAGE"/);
  assert.match(script, /topResumedActivity=/);
  assert.match(script, /LAUNCH_\$\{PASS\}_START_COMMAND_FAILURE/);
});

test('cold-start gate still requires process survival resumed MainActivity and crash-free logcat', async () => {
  const script = await source();

  assert.match(script, /LAUNCH_\$\{PASS\}_PROCESS_DIED/);
  assert.match(script, /LAUNCH_\$\{PASS\}_NOT_RESUMED/);
  assert.match(script, /MainActivity is not resumed/);
  assert.match(script, /has_app_crash_signature/);
  assert.match(script, /FATAL EXCEPTION/);
  assert.match(script, /ANR in/);
});

test('failure diagnostics attempts ADB recovery before logcat and dumpsys collection', async () => {
  const script = await source();

  assert.match(script, /capture_diagnostics\(\)[\s\S]*wait_for_adb_device 12 2/);
  assert.match(script, /adb logcat -d -v time/);
  assert.match(script, /dumpsys activity exit-info/);
});
