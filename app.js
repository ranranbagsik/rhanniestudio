// Initialize Lucide icons safely
if (window.lucide) {
  lucide.createIcons();
}

// =========================================================================
// Application State & DOM References
// =========================================================================
const state = {
  videoFile: null,
  videoUrl: null,
  originalExt: 'webm',
  detectedFps: 30,
  bgMode: 'alpha',          // 'alpha' | 'greenscreen' | 'color' | 'image'
  bgColor: '#00FF00',
  bgImage: null,
  viewMode: 'processed',    // 'processed' | 'split' | 'original'
  splitRatio: 0.5,
  engineMode: 'ai_quality', // 'ai_quality' | 'ai_fast' | 'smart_fallback'
  threshold: 0.5,
  feather: 3,
  erode: 1,
  segmenter: null,
  aiReady: false,
  latestMask: null,
  isProcessingFrame: false,
  isExporting: false,
  exportCancelled: false,
  audioCtx: null,
  audioSourceNode: null,
  monitorGainNode: null,
  exportAudioDest: null,
  hasAudioTrack: false,
  lastFpsTime: performance.now(),
  frameCounter: 0
};

const el = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  selectFileBtn: document.getElementById('selectFileBtn'),
  changeVideoBtn: document.getElementById('changeVideoBtn'),
  metadataBar: document.getElementById('metadataBar'),
  metaFilename: document.getElementById('metaFilename'),
  metaResolution: document.getElementById('metaResolution'),
  metaDuration: document.getElementById('metaDuration'),
  metaSize: document.getElementById('metaSize'),
  viewportToolbar: document.getElementById('viewportToolbar'),
  fpsCounter: document.getElementById('fpsCounter'),
  activeBgBadge: document.getElementById('activeBgBadge'),
  canvasWrapper: document.getElementById('canvasWrapper'),
  sourceVideo: document.getElementById('sourceVideo'),
  maskCanvas: document.getElementById('maskCanvas'),
  compositeCanvas: document.getElementById('compositeCanvas'),
  displayCanvas: document.getElementById('displayCanvas'),
  splitSliderOverlay: document.getElementById('splitSliderOverlay'),
  splitRange: document.getElementById('splitRange'),
  splitLine: document.getElementById('splitLine'),
  playbackControls: document.getElementById('playbackControls'),
  timelineScrubber: document.getElementById('timelineScrubber'),
  currentTimeLabel: document.getElementById('currentTimeLabel'),
  totalTimeLabel: document.getElementById('totalTimeLabel'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  playPauseIcon: document.getElementById('playPauseIcon'),
  stepBackBtn: document.getElementById('stepBackBtn'),
  stepForwardBtn: document.getElementById('stepForwardBtn'),
  muteToggleBtn: document.getElementById('muteToggleBtn'),
  muteIcon: document.getElementById('muteIcon'),
  volumeSlider: document.getElementById('volumeSlider'),
  audioStatusBadge: document.getElementById('audioStatusBadge'),
  playbackRateSelect: document.getElementById('playbackRateSelect'),
  aiStatusBadge: document.getElementById('aiStatusBadge'),
  aiStatusIcon: document.getElementById('aiStatusIcon'),
  aiStatusText: document.getElementById('aiStatusText'),
  chromaSubControls: document.getElementById('chromaSubControls'),
  bgColorPicker: document.getElementById('bgColorPicker'),
  bgColorHexInput: document.getElementById('bgColorHexInput'),
  customColorSwatch: document.getElementById('customColorSwatch'),
  imageSubControls: document.getElementById('imageSubControls'),
  bgImageInput: document.getElementById('bgImageInput'),
  uploadBgImageBtn: document.getElementById('uploadBgImageBtn'),
  bgImageLabel: document.getElementById('bgImageLabel'),
  engineModeSelect: document.getElementById('engineModeSelect'),
  thresholdSlider: document.getElementById('thresholdSlider'),
  thresholdVal: document.getElementById('thresholdVal'),
  featherSlider: document.getElementById('featherSlider'),
  featherVal: document.getElementById('featherVal'),
  erodeSlider: document.getElementById('erodeSlider'),
  erodeVal: document.getElementById('erodeVal'),
  resetSlidersBtn: document.getElementById('resetSlidersBtn'),
  exportFormatSelect: document.getElementById('exportFormatSelect'),
  exportQualitySelect: document.getElementById('exportQualitySelect'),
  keepAudioCheckbox: document.getElementById('keepAudioCheckbox'),
  startExportBtn: document.getElementById('startExportBtn'),
  exportOverlay: document.getElementById('exportOverlay'),
  exportProgressBar: document.getElementById('exportProgressBar'),
  exportPercent: document.getElementById('exportPercent'),
  exportTimeStats: document.getElementById('exportTimeStats'),
  exportFrameCount: document.getElementById('exportFrameCount'),
  exportEta: document.getElementById('exportEta'),
  cancelExportBtn: document.getElementById('cancelExportBtn'),
  downloadReadyCard: document.getElementById('downloadReadyCard'),
  downloadLink: document.getElementById('downloadLink'),
  outputFileInfo: document.getElementById('outputFileInfo'),
  toastBanner: document.getElementById('toastBanner'),
  toastMessage: document.getElementById('toastMessage')
};

const maskCtx = el.maskCanvas.getContext('2d', { willReadFrequently: true });
const compCtx = el.compositeCanvas.getContext('2d', { willReadFrequently: true });
const dispCtx = el.displayCanvas.getContext('2d');

// =========================================================================
// Utility Helpers
// =========================================================================
let toastTimeout = null;
function showToast(msg) {
  el.toastMessage.textContent = msg;
  el.toastBanner.classList.remove('hidden');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    el.toastBanner.classList.add('hidden');
  }, 4500);
}

function hideToast() {
  el.toastBanner.classList.add('hidden');
}

function formatDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '00:00';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// =========================================================================
// Local AI Segmentation Initialization (MediaPipe + Offline Fallback)
// =========================================================================
async function initSegmentationEngine() {
  try {
    if (typeof SelfieSegmentation === 'undefined') {
      throw new Error('MediaPipe library unavailable offline');
    }

    const segmenter = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });

    segmenter.setOptions({
      modelSelection: state.engineMode === 'ai_fast' ? 0 : 1,
      selfieMode: false
    });

    segmenter.onResults((results) => {
      state.latestMask = results.segmentationMask;
    });

    await segmenter.initialize();
    state.segmenter = segmenter;
    state.aiReady = true;

    el.aiStatusIcon.classList.remove('animate-spin', 'text-amber-400');
    el.aiStatusIcon.classList.add('text-brand-400');
    el.aiStatusText.textContent = 'Local AI Ready';
  } catch (err) {
    console.warn('Falling back to offline smart background subtractor:', err);
    state.aiReady = false;
    state.engineMode = 'smart_fallback';
    el.engineModeSelect.value = 'smart_fallback';
    el.aiStatusIcon.classList.remove('animate-spin', 'text-amber-400');
    el.aiStatusIcon.classList.add('text-sky-400');
    el.aiStatusText.textContent = 'Offline Smart Mode';
  }
}

// =========================================================================
// Web Audio API Setup (Preserves Full Audio for Export & Live Monitoring)
// =========================================================================
function setupAudioPipeline() {
  try {
    if (!state.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new AudioContextClass();
      state.audioSourceNode = state.audioCtx.createMediaElementSource(el.sourceVideo);
      state.monitorGainNode = state.audioCtx.createGain();
      state.exportAudioDest = state.audioCtx.createMediaStreamDestination();

      // Branch 1: Speaker monitoring (controlled by volume slider / mute toggle)
      state.audioSourceNode.connect(state.monitorGainNode);
      state.monitorGainNode.connect(state.audioCtx.destination);

      // Branch 2: Full-volume unattenuated audio stream for video export
      state.audioSourceNode.connect(state.exportAudioDest);
    }

    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
  } catch (err) {
    console.warn('Web Audio API initialization warning:', err);
  }
}

function updateAudioStatusUI() {
  const vol = Number(el.volumeSlider.value) / 100;
  const isMuted = el.sourceVideo.muted || vol === 0;

  if (state.monitorGainNode) {
    state.monitorGainNode.gain.value = isMuted ? 0 : vol;
  }

  if (isMuted) {
    el.muteIcon.setAttribute('data-lucide', 'volume-x');
    el.muteIcon.classList.remove('text-brand-400');
    el.muteIcon.classList.add('text-rose-400');
    el.audioStatusBadge.textContent = 'Speaker Muted';
    el.audioStatusBadge.classList.remove('text-brand-400');
    el.audioStatusBadge.classList.add('text-amber-400');
  } else {
    el.muteIcon.setAttribute('data-lucide', 'volume-2');
    el.muteIcon.classList.remove('text-rose-400');
    el.muteIcon.classList.add('text-brand-400');
    el.audioStatusBadge.textContent = 'Audio Active';
    el.audioStatusBadge.classList.remove('text-amber-400');
    el.audioStatusBadge.classList.add('text-brand-400');
  }
  if (window.lucide) lucide.createIcons();
}

// =========================================================================
// Video File Loading & Drag-and-Drop
// =========================================================================
function detectVideoFps(video) {
  if ('requestVideoFrameCallback' in video) {
    let frames = 0;
    let startTime = null;
    const measure = (now) => {
      if (startTime === null) startTime = now;
      frames++;
      const elapsed = now - startTime;
      if (elapsed >= 500 && frames > 2) {
        const estimated = Math.round((frames - 1) / (elapsed / 1000));
        if (estimated >= 15 && estimated <= 120) {
          state.detectedFps = estimated;
        }
      } else if (!video.paused && !video.ended) {
        video.requestVideoFrameCallback(measure);
      }
    };
    video.requestVideoFrameCallback(measure);
  }
}

function handleVideoFile(file) {
  if (!file) return;

  if (state.videoUrl) {
    URL.revokeObjectURL(state.videoUrl);
  }

  state.videoFile = file;
  state.videoUrl = URL.createObjectURL(file);
  state.latestMask = null;
  state.detectedFps = 30;

  // Extract uploaded file extension (e.g., mov, mp4, mkv, avi, webm)
  const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/);
  state.originalExt = extMatch ? extMatch[1].toLowerCase() : 'webm';

  el.sourceVideo.src = state.videoUrl;
  el.sourceVideo.muted = false;
  el.sourceVideo.volume = 1.0;

  el.sourceVideo.onloadedmetadata = () => {
    const w = el.sourceVideo.videoWidth || 1280;
    const h = el.sourceVideo.videoHeight || 720;

    el.maskCanvas.width = w;
    el.maskCanvas.height = h;
    el.compositeCanvas.width = w;
    el.compositeCanvas.height = h;
    el.displayCanvas.width = w;
    el.displayCanvas.height = h;

    el.metaFilename.textContent = file.name;
    el.metaResolution.textContent = `${w}×${h}`;
    el.metaDuration.textContent = formatDuration(el.sourceVideo.duration);
    el.metaSize.textContent = formatBytes(file.size);

    el.timelineScrubber.max = el.sourceVideo.duration || 100;
    el.totalTimeLabel.textContent = formatDuration(el.sourceVideo.duration);

    el.dropzone.classList.add('hidden');
    el.metadataBar.classList.remove('hidden');
    el.metadataBar.classList.add('flex');
    el.viewportToolbar.classList.remove('hidden');
    el.viewportToolbar.classList.add('flex');
    el.playbackControls.classList.remove('hidden');
    el.changeVideoBtn.classList.remove('hidden');
    el.changeVideoBtn.classList.add('flex');
    el.startExportBtn.disabled = false;
    el.downloadReadyCard.classList.add('hidden');

    setupAudioPipeline();
    updateAudioStatusUI();

    el.sourceVideo.play().then(() => {
      updatePlayPauseIcon(true);
      detectVideoFps(el.sourceVideo);
    }).catch(() => {
      updatePlayPauseIcon(false);
    });

    showToast(`Loaded "${file.name}" (${w}×${h} • .${state.originalExt.toUpperCase()})`);
  };

  el.sourceVideo.onerror = () => {
    showToast('Could not decode this video format in your browser. Try converting to MP4 or WebM.');
  };
}

el.selectFileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.fileInput.click();
});

el.dropzone.addEventListener('click', () => el.fileInput.click());
el.changeVideoBtn.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    handleVideoFile(e.target.files[0]);
  }
});

el.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.dropzone.classList.add('border-brand-500', 'bg-studio-800/90');
});

el.dropzone.addEventListener('dragleave', () => {
  el.dropzone.classList.remove('border-brand-500', 'bg-studio-800/90');
});

el.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropzone.classList.remove('border-brand-500', 'bg-studio-800/90');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleVideoFile(e.dataTransfer.files[0]);
  }
});

// =========================================================================
// Frame Processing & Background Compositing Pipeline
// =========================================================================
function generateSmartFallbackMask(w, h) {
  maskCtx.drawImage(el.sourceVideo, 0, 0, w, h);
  const imgData = maskCtx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Sample corner pixels as background reference
  const corners = [
    0,
    (w - 1) * 4,
    ((h - 1) * w) * 4,
    ((h - 1) * w + (w - 1)) * 4
  ];
  let bgR = 0, bgG = 0, bgB = 0;
  for (const idx of corners) {
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
  }
  bgR /= 4; bgG /= 4; bgB /= 4;

  const distThreshold = 45 + state.threshold * 110;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    const alpha = dist > distThreshold ? 255 : 0;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = alpha;
  }
  maskCtx.putImageData(imgData, 0, 0);
}

async function processCurrentFrame(blockingAi = false) {
  const video = el.sourceVideo;
  if (!video || video.readyState < 2) return;

  const w = el.compositeCanvas.width;
  const h = el.compositeCanvas.height;
  if (!w || !h) return;

  // 1. Run AI segmentation asynchronously during preview so rendering stays at full native FPS
  if (state.aiReady && state.segmenter && state.engineMode !== 'smart_fallback') {
    if (blockingAi) {
      try {
        await state.segmenter.send({ image: video });
      } catch (e) {
        // Ignore transient frame drop errors
      }
    } else if (!state.isProcessingFrame) {
      state.isProcessingFrame = true;
      state.segmenter.send({ image: video })
        .catch(() => {})
        .finally(() => {
          state.isProcessingFrame = false;
        });
    }
  }

  // 2. Prepare refined mask on maskCanvas
  maskCtx.save();
  maskCtx.clearRect(0, 0, w, h);

  if (state.engineMode === 'smart_fallback' || !state.latestMask) {
    generateSmartFallbackMask(w, h);
  } else {
    if (state.feather > 0) {
      maskCtx.filter = `blur(${state.feather}px)`;
    }
    maskCtx.drawImage(state.latestMask, 0, 0, w, h);
    maskCtx.filter = 'none';

    // Apply threshold & edge erode refinement on mask alpha/luminance
    const maskData = maskCtx.getImageData(0, 0, w, h);
    const px = maskData.data;
    const cutoff = state.threshold * 255;
    const softness = Math.max(8, (1 - state.erode / 10) * 35);

    for (let i = 0; i < px.length; i += 4) {
      const val = px[i]; // MediaPipe outputs mask in RGB channels
      let alpha = 0;
      if (val >= cutoff + softness) {
        alpha = 255;
      } else if (val > cutoff - softness) {
        alpha = ((val - (cutoff - softness)) / (softness * 2)) * 255;
      }
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = alpha;
    }
    maskCtx.putImageData(maskData, 0, 0);
  }
  maskCtx.restore();

  // 3. Composite foreground subject onto compositeCanvas
  compCtx.save();
  compCtx.clearRect(0, 0, w, h);

  // Draw video frame & apply mask
  compCtx.drawImage(video, 0, 0, w, h);
  compCtx.globalCompositeOperation = 'destination-in';
  compCtx.drawImage(el.maskCanvas, 0, 0, w, h);

  // Draw chosen background behind masked subject
  compCtx.globalCompositeOperation = 'destination-over';
  if (state.bgMode === 'greenscreen') {
    compCtx.fillStyle = '#00FF00';
    compCtx.fillRect(0, 0, w, h);
  } else if (state.bgMode === 'color') {
    compCtx.fillStyle = state.bgColor;
    compCtx.fillRect(0, 0, w, h);
  } else if (state.bgMode === 'image' && state.bgImage) {
    compCtx.drawImage(state.bgImage, 0, 0, w, h);
  }
  // If state.bgMode === 'alpha', leave background transparent!
  compCtx.restore();

  // 4. Render to visible displayCanvas based on Preview View mode
  dispCtx.clearRect(0, 0, w, h);
  if (state.viewMode === 'original') {
    dispCtx.drawImage(video, 0, 0, w, h);
  } else if (state.viewMode === 'split') {
    const splitX = Math.floor(w * state.splitRatio);
    // Left side: Original
    dispCtx.save();
    dispCtx.beginPath();
    dispCtx.rect(0, 0, splitX, h);
    dispCtx.clip();
    dispCtx.drawImage(video, 0, 0, w, h);
    dispCtx.restore();

    // Right side: Processed
    dispCtx.save();
    dispCtx.beginPath();
    dispCtx.rect(splitX, 0, w - splitX, h);
    dispCtx.clip();
    dispCtx.drawImage(el.compositeCanvas, 0, 0, w, h);
    dispCtx.restore();
  } else {
    dispCtx.drawImage(el.compositeCanvas, 0, 0, w, h);
  }
}

// Continuous preview loop synced to native display/video frame rate
function previewLoop(now) {
  if (!state.isExporting && state.videoFile && el.sourceVideo.readyState >= 2) {
    processCurrentFrame(false);

    // Update scrubber & timecode
    if (!el.sourceVideo.paused) {
      el.timelineScrubber.value = el.sourceVideo.currentTime;
      el.currentTimeLabel.textContent = formatDuration(el.sourceVideo.currentTime);
    }

    // FPS counter
    state.frameCounter++;
    if (now - state.lastFpsTime >= 1000) {
      el.fpsCounter.textContent = `Preview: ${state.frameCounter} FPS`;
      state.frameCounter = 0;
      state.lastFpsTime = now;
    }
  }
  requestAnimationFrame(previewLoop);
}

// =========================================================================
// Playback, Audio & Viewport Controls
// =========================================================================
function updatePlayPauseIcon(isPlaying) {
  el.playPauseIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
  if (window.lucide) lucide.createIcons();
}

el.playPauseBtn.addEventListener('click', () => {
  if (!state.videoFile) return;
  setupAudioPipeline();
  if (el.sourceVideo.paused) {
    el.sourceVideo.play();
    updatePlayPauseIcon(true);
  } else {
    el.sourceVideo.pause();
    updatePlayPauseIcon(false);
  }
});

el.sourceVideo.addEventListener('ended', () => {
  if (!state.isExporting) {
    updatePlayPauseIcon(false);
  }
});

el.stepBackBtn.addEventListener('click', () => {
  el.sourceVideo.currentTime = Math.max(0, el.sourceVideo.currentTime - 5);
  el.timelineScrubber.value = el.sourceVideo.currentTime;
  el.currentTimeLabel.textContent = formatDuration(el.sourceVideo.currentTime);
});

el.stepForwardBtn.addEventListener('click', () => {
  el.sourceVideo.currentTime = Math.min(el.sourceVideo.duration || 0, el.sourceVideo.currentTime + 5);
  el.timelineScrubber.value = el.sourceVideo.currentTime;
  el.currentTimeLabel.textContent = formatDuration(el.sourceVideo.currentTime);
});

el.timelineScrubber.addEventListener('input', () => {
  el.sourceVideo.currentTime = Number(el.timelineScrubber.value);
  el.currentTimeLabel.textContent = formatDuration(el.sourceVideo.currentTime);
});

el.muteToggleBtn.addEventListener('click', () => {
  setupAudioPipeline();
  el.sourceVideo.muted = !el.sourceVideo.muted;
  if (!el.sourceVideo.muted && Number(el.volumeSlider.value) === 0) {
    el.volumeSlider.value = 100;
  }
  updateAudioStatusUI();
});

el.volumeSlider.addEventListener('input', () => {
  setupAudioPipeline();
  el.sourceVideo.muted = Number(el.volumeSlider.value) === 0;
  updateAudioStatusUI();
});

el.playbackRateSelect.addEventListener('change', () => {
  el.sourceVideo.playbackRate = Number(el.playbackRateSelect.value);
});

// View Mode Buttons (Removed BG / Split Compare / Original)
document.querySelectorAll('.view-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-mode-btn').forEach((b) => {
      b.classList.remove('bg-brand-500', 'text-studio-950', 'shadow');
      b.classList.add('text-zinc-300');
    });
    btn.classList.add('bg-brand-500', 'text-studio-950', 'shadow');
    btn.classList.remove('text-zinc-300');

    state.viewMode = btn.dataset.view;
    if (state.viewMode === 'split') {
      el.splitSliderOverlay.classList.remove('hidden');
    } else {
      el.splitSliderOverlay.classList.add('hidden');
    }
  });
});

el.splitRange.addEventListener('input', () => {
  const pct = Number(el.splitRange.value);
  state.splitRatio = pct / 100;
  el.splitLine.style.left = `${pct}%`;
});

// =========================================================================
// Background Mode & Refinement Sliders
// =========================================================================
document.querySelectorAll('.bg-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bg-mode-btn').forEach((b) => {
      b.classList.remove('active', 'border-2', 'border-brand-500', 'bg-brand-500/10');
      b.classList.add('border', 'border-studio-700', 'bg-studio-800/60');
    });
    btn.classList.add('active', 'border-2', 'border-brand-500', 'bg-brand-500/10');
    btn.classList.remove('border', 'border-studio-700', 'bg-studio-800/60');

    state.bgMode = btn.dataset.bgMode;
    el.chromaSubControls.classList.add('hidden');
    el.imageSubControls.classList.add('hidden');

    if (state.bgMode === 'alpha') {
      el.activeBgBadge.textContent = 'Alpha Transparent';
    } else if (state.bgMode === 'greenscreen') {
      state.bgColor = '#00FF00';
      el.activeBgBadge.textContent = 'Green Screen (#00FF00)';
    } else if (state.bgMode === 'color') {
      el.chromaSubControls.classList.remove('hidden');
      el.activeBgBadge.textContent = `Solid Color (${state.bgColor})`;
    } else if (state.bgMode === 'image') {
      el.imageSubControls.classList.remove('hidden');
      el.activeBgBadge.textContent = 'Custom Image Backdrop';
    }
  });
});

document.querySelectorAll('.preset-color-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const hex = btn.dataset.presetColor;
    state.bgColor = hex;
    el.bgColorPicker.value = hex;
    el.bgColorHexInput.value = hex;
    el.customColorSwatch.style.backgroundColor = hex;
    el.activeBgBadge.textContent = `Solid Color (${hex})`;
  });
});

el.bgColorPicker.addEventListener('input', () => {
  const hex = el.bgColorPicker.value.toUpperCase();
  state.bgColor = hex;
  el.bgColorHexInput.value = hex;
  el.customColorSwatch.style.backgroundColor = hex;
  el.activeBgBadge.textContent = `Solid Color (${hex})`;
});

el.bgColorHexInput.addEventListener('change', () => {
  let hex = el.bgColorHexInput.value.trim();
  if (!hex.startsWith('#')) hex = `#${hex}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    state.bgColor = hex.toUpperCase();
    el.bgColorPicker.value = state.bgColor;
    el.customColorSwatch.style.backgroundColor = state.bgColor;
    el.activeBgBadge.textContent = `Solid Color (${state.bgColor})`;
  }
});

el.uploadBgImageBtn.addEventListener('click', () => el.bgImageInput.click());
el.bgImageInput.addEventListener('change', (e) => {
  const imgFile = e.target.files?.[0];
  if (!imgFile) return;
  const img = new Image();
  img.onload = () => {
    state.bgImage = img;
    el.bgImageLabel.textContent = imgFile.name;
    showToast(`Backdrop image "${imgFile.name}" applied`);
  };
  img.src = URL.createObjectURL(imgFile);
});

el.engineModeSelect.addEventListener('change', () => {
  state.engineMode = el.engineModeSelect.value;
  if (state.segmenter && state.engineMode !== 'smart_fallback') {
    state.segmenter.setOptions({
      modelSelection: state.engineMode === 'ai_fast' ? 0 : 1,
      selfieMode: false
    });
  }
});

el.thresholdSlider.addEventListener('input', () => {
  const val = Number(el.thresholdSlider.value);
  state.threshold = val / 100;
  el.thresholdVal.textContent = `${val}%`;
});

el.featherSlider.addEventListener('input', () => {
  const val = Number(el.featherSlider.value);
  state.feather = val;
  el.featherVal.textContent = `${val}px`;
});

el.erodeSlider.addEventListener('input', () => {
  const val = Number(el.erodeSlider.value);
  state.erode = val;
  el.erodeVal.textContent = `${val}px`;
});

el.resetSlidersBtn.addEventListener('click', () => {
  state.threshold = 0.5;
  state.feather = 3;
  state.erode = 1;
  el.thresholdSlider.value = 50;
  el.featherSlider.value = 3;
  el.erodeSlider.value = 1;
  el.thresholdVal.textContent = '50%';
  el.featherVal.textContent = '3px';
  el.erodeVal.textContent = '1px';
  showToast('Refinement settings reset to defaults');
});

// =========================================================================
// Video Export Pipeline (MediaRecorder + Canvas Stream + Original Audio)
// =========================================================================
el.startExportBtn.addEventListener('click', async () => {
  if (!state.videoFile || state.isExporting) return;

  setupAudioPipeline();
  state.isExporting = true;
  state.exportCancelled = false;

  el.exportOverlay.classList.remove('hidden');
  el.downloadReadyCard.classList.add('hidden');
  el.startExportBtn.disabled = true;

  el.sourceVideo.pause();
  el.sourceVideo.currentTime = 0;
  el.sourceVideo.playbackRate = 1.0;
  el.playbackRateSelect.value = '1';

  // Wait for seek to 0
  await new Promise((resolve) => {
    const onSeeked = () => {
      el.sourceVideo.removeEventListener('seeked', onSeeked);
      resolve();
    };
    el.sourceVideo.addEventListener('seeked', onSeeked);
  });

  const formatChoice = el.exportFormatSelect.value;
  const bitrate = Number(el.exportQualitySelect.value);

  let mimeType = 'video/webm;codecs=vp9,opus';
  let ext = state.originalExt || 'webm';

  if (formatChoice === 'auto_match') {
    ext = state.originalExt || 'webm';
    if (ext === 'mp4' || ext === 'm4v') {
      mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')
        ? 'video/mp4;codecs=avc1,mp4a.40.2'
        : 'video/webm;codecs=vp9,opus';
    } else if (ext === 'mov') {
      mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')
        ? 'video/mp4;codecs=avc1,mp4a.40.2'
        : 'video/webm;codecs=vp9,opus';
    } else {
      mimeType = 'video/webm;codecs=vp9,opus';
    }
  } else if (formatChoice === 'webm_vp9') {
    mimeType = 'video/webm;codecs=vp9,opus';
    ext = 'webm';
  } else if (formatChoice === 'webm_vp8') {
    mimeType = 'video/webm;codecs=vp8,opus';
    ext = 'webm';
  } else if (formatChoice === 'mp4_h264') {
    mimeType = 'video/mp4;codecs=avc1,mp4a.40.2';
    ext = 'mp4';
  }

  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';
    if (formatChoice !== 'auto_match') {
      ext = 'webm';
    }
  }

  const targetFps = state.detectedFps || 30;
  const canvasStream = el.compositeCanvas.captureStream(targetFps);
  const combinedTracks = [...canvasStream.getVideoTracks()];

  // Attach full-volume audio track if requested
  if (el.keepAudioCheckbox.checked && state.exportAudioDest) {
    const audioTracks = state.exportAudioDest.stream.getAudioTracks();
    if (audioTracks.length > 0) {
      combinedTracks.push(audioTracks[0]);
    }
  }

  const outputStream = new MediaStream(combinedTracks);
  const recorderOptions = mimeType
    ? { mimeType, videoBitsPerSecond: bitrate }
    : { videoBitsPerSecond: bitrate };

  const recorder = new MediaRecorder(outputStream, recorderOptions);
  const chunks = [];
  const totalDuration = el.sourceVideo.duration || 1;
  const renderStartTime = performance.now();
  let framesProcessed = 0;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  recorder.onstop = () => {
    state.isExporting = false;
    el.exportOverlay.classList.add('hidden');
    el.startExportBtn.disabled = false;
    updatePlayPauseIcon(false);

    if (state.exportCancelled) {
      showToast('Export cancelled');
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const baseName = (state.videoFile?.name || 'rhannies-studio-video').replace(/\.[^/.]+$/, '');
    const suffix = state.bgMode === 'alpha' ? 'alpha' : state.bgMode === 'greenscreen' ? 'greenscreen' : 'nobg';
    const outFilename = `${baseName}-${suffix}.${ext}`;

    el.downloadLink.href = url;
    el.downloadLink.download = outFilename;
    el.outputFileInfo.textContent = `${formatBytes(blob.size)} • ${ext.toUpperCase()}`;
    el.downloadReadyCard.classList.remove('hidden');
    showToast(`Export complete! Ready to download ${outFilename}`);
  };

  // Start recording & playing
  recorder.start(1000); // Emit chunks every 1 second to keep memory lean on long videos
  el.sourceVideo.loop = false;
  await el.sourceVideo.play();

  const exportStep = async () => {
    if (state.exportCancelled) {
      if (recorder.state !== 'inactive') recorder.stop();
      return;
    }

    if (el.sourceVideo.ended || el.sourceVideo.currentTime >= totalDuration - 0.03) {
      await processCurrentFrame(true);
      if (recorder.state !== 'inactive') recorder.stop();
      return;
    }

    await processCurrentFrame(true);
    framesProcessed++;

    const current = el.sourceVideo.currentTime;
    const pct = Math.min(100, Math.round((current / totalDuration) * 100));
    el.exportProgressBar.style.width = `${pct}%`;
    el.exportPercent.textContent = `${pct}%`;
    el.exportTimeStats.textContent = `${formatDuration(current)} / ${formatDuration(totalDuration)}`;
    el.exportFrameCount.textContent = framesProcessed.toLocaleString();

    const elapsedSec = (performance.now() - renderStartTime) / 1000;
    const remainingSec = Math.max(0, totalDuration - current);
    el.exportEta.textContent = elapsedSec > 0.5 ? formatDuration(remainingSec) : 'Calculating...';

    requestAnimationFrame(exportStep);
  };

  requestAnimationFrame(exportStep);
});

el.cancelExportBtn.addEventListener('click', () => {
  state.exportCancelled = true;
});

// =========================================================================
// Initialize App on Window Load
// =========================================================================
window.addEventListener('load', () => {
  initSegmentationEngine();
  requestAnimationFrame(previewLoop);
});