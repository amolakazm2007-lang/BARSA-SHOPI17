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

test('cold-start gate still requires process survival and resumed MainActivity', async () => {
  const script = await source();

  assert.match(script, /pidof "\$PACKAGE"/);
  assert.match(script, /LAUNCH_\$\{PASS\}_PROCESS_DIED/);
  assert.match(script, /LAUNCH_\$\{PASS\}_NOT_RESUMED/);
  assert.match(script, /MainActivity is not resumed/);
});
