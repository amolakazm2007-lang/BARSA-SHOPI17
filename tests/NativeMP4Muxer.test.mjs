import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
import { NativeMP4Muxer } from '../src/engine/NativeMP4Muxer.js';

test('native MP4 muxer creates a real ftyp container from H.264 packets', async () => {
  const bytes = await readFile(new URL('./tiny-h264-source.mp4', import.meta.url));
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  assert.ok(track);
  const decoderConfig = await track.getDecoderConfig();
  assert.ok(decoderConfig?.codec.startsWith('avc'));
  const muxer = new NativeMP4Muxer({
    width: decoderConfig.codedWidth,
    height: decoderConfig.codedHeight,
    codec: decoderConfig.codec,
    fps: 30,
    expectedFrames: 120,
  });
  await muxer.initialize();
  const sink = new EncodedPacketSink(track);
  let count = 0;
  for await (const packet of sink.packets()) {
    await muxer.addPacket(packet, count++ === 0 ? { decoderConfig } : undefined);
  }
  const output = await muxer.finalize();
  const result = new Uint8Array(await output.arrayBuffer());
  assert.equal(String.fromCharCode(...result.slice(4, 8)), 'ftyp');
  assert.equal(output.type, 'video/mp4');
  assert.ok(result.length > 1000);
  input.dispose();
});

test('native MP4 muxer streams positioned writes instead of buffering large exports', async () => {
  const bytes = await readFile(new URL('./tiny-h264-source.mp4', import.meta.url));
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  const decoderConfig = await track.getDecoderConfig();
  let outputBytes = new Uint8Array(0);
  const storage = {
    async createRandomAccessOutput() {
      return {
        writable: new WritableStream({
          write({ data, position }) {
            if (outputBytes.length < position + data.length) {
              const grown = new Uint8Array(position + data.length);
              grown.set(outputBytes);
              outputBytes = grown;
            }
            outputBytes.set(data, position);
          },
        }),
        getFile: async () => new Blob([outputBytes]),
        remove: async () => {},
      };
    },
  };
  const muxer = new NativeMP4Muxer({
    width: decoderConfig.codedWidth,
    height: decoderConfig.codedHeight,
    codec: decoderConfig.codec,
    fps: 30,
    expectedFrames: 120,
    storage,
    sessionId: 'stream-test',
  });
  await muxer.initialize();
  const sink = new EncodedPacketSink(track);
  let count = 0;
  for await (const packet of sink.packets()) await muxer.addPacket(packet, count++ === 0 ? { decoderConfig } : undefined);
  const output = await muxer.finalize();
  const result = new Uint8Array(await output.arrayBuffer());
  assert.equal(String.fromCharCode(...result.slice(4, 8)), 'ftyp');
  assert.equal(output.type, 'video/mp4');
  assert.equal(muxer.streaming, true);
  input.dispose();
});
