/* Shared PCM merge and WAV encoding, matching the existing popup. */
(function(root) {
function fmtDur(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const n = Math.floor(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
function summarize(items) {
  const found = items.filter(a => a.src && /^https:\/\//.test(a.src));
  return {items: found, seconds: found.reduce((n,a) => n + (Number.isFinite(a.dur) && a.dur > 0 ? a.dur : 0),0), unknown: found.filter(a => !Number.isFinite(a.dur) || a.dur <= 0).length};
}
async function mergeBuffers(buffers) {
  const rate = Math.max(...buffers.map((b) => b.sampleRate));
  const channels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const totalSec = buffers.reduce((sum, b) => sum + b.duration, 0);
  const frames = Math.ceil(totalSec * rate);

  const ctx = new OfflineAudioContext(channels, frames, rate);
  let offset = 0;
  for (const buf of buffers) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(offset);
    offset += buf.duration;
  }
  return ctx.startRendering();
}

// AudioBuffer → WAV (16-бит PCM).
function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;

  const out = new DataView(new ArrayBuffer(44 + dataSize));
  const ascii = (offset, str) => {
    for (let i = 0; i < str.length; i++) out.setUint8(offset + i, str.charCodeAt(i));
  };

  ascii(0, "RIFF");
  out.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  out.setUint32(16, 16, true); // размер fmt-блока
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, channels, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * blockAlign, true);
  out.setUint16(32, blockAlign, true);
  out.setUint16(34, 8 * bytesPerSample, true);
  ascii(36, "data");
  out.setUint32(40, dataSize, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  let pos = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}


const api = {fmtDur, summarize, mergeBuffers, encodeWav};
if (typeof module !== "undefined") module.exports = api;
else root.MultiBotHeyGenAudio = api;
})(globalThis);
