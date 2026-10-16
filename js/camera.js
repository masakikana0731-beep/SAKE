let stream = null;
let torchOn = false;

export async function start(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unsupported');
  stop();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

export function stop() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  torchOn = false;
}

export function hasTorch() {
  const track = stream?.getVideoTracks()[0];
  return !!track?.getCapabilities?.().torch;
}

export async function toggleTorch() {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  await track.applyConstraints({ advanced: [{ torch: torchOn }] });
}

export function capture(video) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}
