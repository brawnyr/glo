// Planar Float32 channels -> 16-bit PCM WAV. Mono or stereo only.

export type ChannelData = Float32Array[]; // [L, R] or [Mono]

export function encodeWav(channels: ChannelData, sampleRate: number): Uint8Array {
  const numChannels = channels.length;
  if (numChannels < 1 || numChannels > 2) {
    throw new Error("encodeWav: only mono or stereo supported");
  }
  const numFrames = channels[0].length;
  for (let i = 1; i < numChannels; i++) {
    if (channels[i].length !== numFrames) {
      throw new Error("encodeWav: channel length mismatch");
    }
  }
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const totalSize = 44 + dataSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  // RIFF header
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");

  // fmt chunk
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);

  // data chunk
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = channels[c][i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      const v = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      view.setInt16(offset, v, true);
      offset += 2;
    }
  }
  return new Uint8Array(buf);
}

function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
