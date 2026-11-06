// Adapted from Suno Song Remaster (ISC); see NOTICE.md.
import {AUDIO_CONSTANTS,DEFAULT_SETTINGS} from "./audioConstants.js";
import {measureLUFS,calculateNormalizationGain} from "./lufs.js";
import {encodeWAV} from "./wavEncoder.js";
function configureEQNodes(nodes) {
  nodes.eqLow.type = 'lowshelf';
  nodes.eqLow.frequency.value = AUDIO_CONSTANTS.FREQ_LOW;

  nodes.eqLowMid.type = 'peaking';
  nodes.eqLowMid.frequency.value = AUDIO_CONSTANTS.FREQ_LOW_MID;
  nodes.eqLowMid.Q.value = 1;

  nodes.eqMid.type = 'peaking';
  nodes.eqMid.frequency.value = AUDIO_CONSTANTS.FREQ_MID;
  nodes.eqMid.Q.value = 1;

  nodes.eqHighMid.type = 'peaking';
  nodes.eqHighMid.frequency.value = AUDIO_CONSTANTS.FREQ_HIGH_MID;
  nodes.eqHighMid.Q.value = 1;

  nodes.eqHigh.type = 'highshelf';
  nodes.eqHigh.frequency.value = AUDIO_CONSTANTS.FREQ_HIGH;
}
function configureFilterNodes(nodes, settings = null) {
  const s = settings || {};

  nodes.highpass.type = 'highpass';
  nodes.highpass.frequency.value = (s.cleanLowEnd !== undefined ? s.cleanLowEnd : true)
    ? AUDIO_CONSTANTS.HIGHPASS_FREQ : 1;
  nodes.highpass.Q.value = 0.7;

  nodes.lowshelf.type = 'peaking';
  nodes.lowshelf.frequency.value = AUDIO_CONSTANTS.MUD_CUT_FREQ;
  nodes.lowshelf.Q.value = 1.5;
  nodes.lowshelf.gain.value = s.cutMud ? -3 : 0;

  nodes.highshelf.type = 'highshelf';
  nodes.highshelf.frequency.value = AUDIO_CONSTANTS.AIR_FREQ;
  nodes.highshelf.gain.value = s.addAir ? 2.5 : 0;

  nodes.midPeak.type = 'peaking';
  nodes.midPeak.frequency.value = AUDIO_CONSTANTS.HARSHNESS_FREQ_1;
  nodes.midPeak.Q.value = AUDIO_CONSTANTS.HARSHNESS_Q_4K;
  nodes.midPeak.gain.value = s.tameHarsh ? AUDIO_CONSTANTS.HARSHNESS_GAIN_4K : 0;

  nodes.midPeak2.type = 'peaking';
  nodes.midPeak2.frequency.value = AUDIO_CONSTANTS.HARSHNESS_FREQ_2;
  nodes.midPeak2.Q.value = AUDIO_CONSTANTS.HARSHNESS_Q_6K;
  nodes.midPeak2.gain.value = s.tameHarsh ? AUDIO_CONSTANTS.HARSHNESS_GAIN_6K : 0;

  if (s.glueCompression) {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
  } else {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
    // Will be overridden by updateAudioChain for preview
  }

  nodes.limiter.threshold.value = -1;
  nodes.limiter.knee.value = 0;
  nodes.limiter.ratio.value = AUDIO_CONSTANTS.LIMITER_RATIO;
  nodes.limiter.attack.value = AUDIO_CONSTANTS.LIMITER_ATTACK;
  nodes.limiter.release.value = AUDIO_CONSTANTS.LIMITER_RELEASE;

  // "Center Bass": high-pass the side (stereo difference) signal so low
  // frequencies collapse to mono. Freq of 1 Hz is effectively transparent.
  nodes.sideHighpass.type = 'highpass';
  nodes.sideHighpass.frequency.value = s.centerBass ? AUDIO_CONSTANTS.BASS_MONO_FREQ : 1;
  nodes.sideHighpass.Q.value = 0.7;
}
function createProcessingNodes(ctx) {
  const nodes = {};
  nodes.inputGain = ctx.createGain();
  nodes.gain = ctx.createGain();
  nodes.normGain = ctx.createGain();
  nodes.highpass = ctx.createBiquadFilter();
  nodes.lowshelf = ctx.createBiquadFilter();
  nodes.highshelf = ctx.createBiquadFilter();
  nodes.midPeak = ctx.createBiquadFilter();
  nodes.midPeak2 = ctx.createBiquadFilter();
  nodes.compressor = ctx.createDynamicsCompressor();
  nodes.limiter = ctx.createDynamicsCompressor();
  nodes.ceilingClip = ctx.createWaveShaper(); // brickwall clamp after the limiter
  nodes.ceilingClip.oversample = '4x';

  // Stereo width processing (mid-side)
  nodes.stereoSplitter = ctx.createChannelSplitter(2);
  nodes.stereoMerger = ctx.createChannelMerger(2);
  nodes.midGain = ctx.createGain();
  nodes.sideGain = ctx.createGain();
  nodes.leftToMid = ctx.createGain();
  nodes.rightToMid = ctx.createGain();
  nodes.leftToSide = ctx.createGain();
  nodes.rightToSide = ctx.createGain();
  nodes.midToLeft = ctx.createGain();
  nodes.midToRight = ctx.createGain();
  nodes.sideToLeft = ctx.createGain();
  nodes.sideToRight = ctx.createGain();
  nodes.sideHighpass = ctx.createBiquadFilter(); // "Center Bass": mono the low end

  // 5-band EQ
  nodes.eqLow = ctx.createBiquadFilter();
  nodes.eqLowMid = ctx.createBiquadFilter();
  nodes.eqMid = ctx.createBiquadFilter();
  nodes.eqHighMid = ctx.createBiquadFilter();
  nodes.eqHigh = ctx.createBiquadFilter();

  return nodes;
}
async function processAudioOffline(inputBuffer, settings) {

  const targetSampleRate = settings.sampleRate;
  const numChannels = 2;

  const outputLength = Math.ceil(inputBuffer.length * targetSampleRate / inputBuffer.sampleRate);

  const offlineCtx = new OfflineAudioContext(numChannels, outputLength, targetSampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  // Use shared node factory
  const nodes = createProcessingNodes(offlineCtx);

  // Configure input gain
  const inputGainDb = settings.inputGain || 0;
  nodes.inputGain.gain.value = Math.pow(10, inputGainDb / 20);

  // Configure EQ
  configureEQNodes(nodes);
  nodes.eqLow.gain.value = settings.eqLow;
  nodes.eqLowMid.gain.value = settings.eqLowMid;
  nodes.eqMid.gain.value = settings.eqMid;
  nodes.eqHighMid.gain.value = settings.eqHighMid;
  nodes.eqHigh.gain.value = settings.eqHigh;

  // Configure filters using shared function
  configureFilterNodes(nodes, settings);

  // Glue compressor config
  if (settings.glueCompression) {
    nodes.compressor.threshold.value = AUDIO_CONSTANTS.GLUE_THRESHOLD;
    nodes.compressor.knee.value = 10;
    nodes.compressor.ratio.value = AUDIO_CONSTANTS.GLUE_RATIO;
    nodes.compressor.attack.value = AUDIO_CONSTANTS.GLUE_ATTACK;
    nodes.compressor.release.value = AUDIO_CONSTANTS.GLUE_RELEASE;
  } else {
    nodes.compressor.threshold.value = 0;
    nodes.compressor.ratio.value = 1;
  }

  // Pass 1 renders tonal shaping + dynamics + stereo width WITHOUT the limiter
  // and WITHOUT normalization gain. Normalization is measured and applied
  // afterwards, then the limiter runs as a final pass — so make-up gain can
  // never push peaks past the true-peak ceiling.
  nodes.normGain.gain.value = 1.0;

  // Configure stereo width via mid-side nodes
  const stereoWidth = settings.stereoWidth !== undefined ? settings.stereoWidth : 100;
  const sideLevel = stereoWidth / 100;

  // Connect the chain including mid-side processing (no limiter here)
  source
    .connect(nodes.inputGain)
    .connect(nodes.highpass)
    .connect(nodes.eqLow)
    .connect(nodes.eqLowMid)
    .connect(nodes.eqMid)
    .connect(nodes.eqHighMid)
    .connect(nodes.eqHigh)
    .connect(nodes.lowshelf)
    .connect(nodes.midPeak)
    .connect(nodes.midPeak2)
    .connect(nodes.highshelf)
    .connect(nodes.compressor);

  // Mid-side stereo width processing (same as preview chain)
  nodes.compressor.connect(nodes.stereoSplitter);

  nodes.stereoSplitter.connect(nodes.leftToMid, 0);
  nodes.stereoSplitter.connect(nodes.rightToMid, 1);
  nodes.leftToMid.gain.value = 0.5;
  nodes.rightToMid.gain.value = 0.5;
  nodes.leftToMid.connect(nodes.midGain);
  nodes.rightToMid.connect(nodes.midGain);

  nodes.stereoSplitter.connect(nodes.leftToSide, 0);
  nodes.stereoSplitter.connect(nodes.rightToSide, 1);
  nodes.leftToSide.gain.value = 0.5;
  nodes.rightToSide.gain.value = -0.5;
  nodes.leftToSide.connect(nodes.sideGain);
  nodes.rightToSide.connect(nodes.sideGain);

  nodes.midGain.gain.value = 1;
  nodes.sideGain.gain.value = sideLevel;

  nodes.midToLeft.gain.value = 1;
  nodes.midToRight.gain.value = 1;
  nodes.sideToLeft.gain.value = 1;
  nodes.sideToRight.gain.value = -1;

  nodes.midGain.connect(nodes.midToLeft);
  nodes.midGain.connect(nodes.midToRight);
  // Side passes through the "Center Bass" high-pass before distribution
  nodes.sideGain.connect(nodes.sideHighpass);
  nodes.sideHighpass.connect(nodes.sideToLeft);
  nodes.sideHighpass.connect(nodes.sideToRight);

  nodes.midToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.sideToLeft.connect(nodes.stereoMerger, 0, 0);
  nodes.midToRight.connect(nodes.stereoMerger, 0, 1);
  nodes.sideToRight.connect(nodes.stereoMerger, 0, 1);

  nodes.stereoMerger
    .connect(nodes.normGain)
    .connect(offlineCtx.destination);

  source.start(0);

  let renderedBuffer = await offlineCtx.startRendering();

  // Loudness normalization — measured on the fully processed (pre-limiter)
  // signal and applied before the limiter runs.
  if (settings.normalizeLoudness) {
    const lufsResult = measureLUFS(renderedBuffer);
    const targetLufs = settings.targetLufs || AUDIO_CONSTANTS.TARGET_LUFS;
    const normGain = calculateNormalizationGain(lufsResult.integratedLUFS, targetLufs);

    if (normGain !== 1.0 && isFinite(normGain)) {
      for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
        const channelData = renderedBuffer.getChannelData(ch);
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] *= normGain;
        }
      }
    }
  }

  // Final limiting stage — runs last so the ceiling holds after normalization:
  //   1. musical peak limiting (compressor-based) to control dynamics
  //   2. true-peak (4x oversampled) clip so inter-sample peaks stay under the
  //      ceiling — genuine dBTP compliance, not just sample-peak.
  if (settings.truePeakLimit) {
    renderedBuffer = await applyLimiterPass(renderedBuffer, settings.truePeakCeiling);
    renderedBuffer = await truePeakClip(renderedBuffer, settings.truePeakCeiling);
  }

  return renderedBuffer;
}
function applyCeilingClip(buffer, ceilingDb) {
  const ceilingLin = Math.pow(10, ceilingDb / 20);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      if (data[i] > ceilingLin) data[i] = ceilingLin;
      else if (data[i] < -ceilingLin) data[i] = -ceilingLin;
    }
  }
}
async function resampleBuffer(buffer, targetRate) {
  if (buffer.sampleRate === targetRate) return buffer;
  const frames = Math.max(1, Math.round(buffer.length * targetRate / buffer.sampleRate));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}
function peakOf(buffer) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}
async function measureTruePeakDb(buffer) {
  const up = await resampleBuffer(buffer, buffer.sampleRate * 4);
  const peak = peakOf(up);
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
async function truePeakClip(buffer, ceilingDb) {
  const OS = 4;
  const baseRate = buffer.sampleRate;
  const ceilingLin = Math.pow(10, ceilingDb / 20);

  const up = await resampleBuffer(buffer, baseRate * OS);

  if (peakOf(up) <= ceilingLin) {
    return buffer; // already true-peak compliant — leave the audio alone
  }

  // Clip inter-sample overshoots in the oversampled domain, then come back.
  applyCeilingClip(up, ceilingDb);
  const out = await resampleBuffer(up, baseRate);

  // Guard against any tiny ripple introduced by the downsampling filter.
  applyCeilingClip(out, ceilingDb);
  return out;
}
async function applyLimiterPass(buffer, ceiling) {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = ceiling;
  limiter.knee.value = 0;
  limiter.ratio.value = AUDIO_CONSTANTS.LIMITER_RATIO;
  limiter.attack.value = AUDIO_CONSTANTS.LIMITER_ATTACK;
  limiter.release.value = AUDIO_CONSTANTS.LIMITER_RELEASE;

  src.connect(limiter).connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}
export async function remasterFile(file, options) {
 const decoder=new AudioContext();
 let input;
 try { input=await decoder.decodeAudioData(await file.arrayBuffer()); } finally { await decoder.close(); }
 if(input.duration<0.4)throw new Error("File quá ngắn để đo loudness.");
 if(input.duration>900)throw new Error("Hãy chọn bài dài tối đa 15 phút.");
 const settings={...DEFAULT_SETTINGS,sampleRate:44100,bitDepth:24,normalizeLoudness:true,truePeakLimit:true,truePeakCeiling:-1,centerBass:true,...options};
 const before=measureLUFS(input).integratedLUFS;
 const output=await processAudioOffline(input,settings);
 // Measure again after the resampling filter; apply a uniform safety gain if needed.
 const peak=await measureTruePeakDb(output);
 if(peak>-1) {
  const gain=Math.pow(10,(-1.05-peak)/20);
  for(let ch=0;ch<output.numberOfChannels;ch++){const data=output.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]*=gain;}
 }
 const after=measureLUFS(output).integratedLUFS;
 return {blob:new Blob([encodeWAV(output,{bitDepth:24})],{type:"audio/wav"}),before,after};
}

