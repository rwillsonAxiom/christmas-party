// Pinned and reviewed; see dependency-review.txt and public/qr-LICENSE.txt.
import decodeQR from "jsr:@paulmillr/qr@0.7.2/decode.js";

export function cardIdFromCode(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) || url.username ||
      url.password
    ) return;
    const uuid =
      "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
    return (url.hash.match(new RegExp(`^#/account/${uuid}$`, "i"))?.[1] ??
      url.pathname.match(new RegExp(`^/a/${uuid}$`, "i"))?.[1])?.toLowerCase();
  } catch {
    return;
  }
}

export function decodeFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | undefined {
  try {
    return decodeQR({ data, width, height }, { effort: 1, timeLimit: 8 });
  } catch {
    return;
  }
}

interface Detector {
  detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface DetectorConstructor {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

export async function startScanner(
  video: HTMLVideoElement,
  onCode: (code: string) => boolean,
  onError: (message: string) => void,
): Promise<{ stop(): void; resume(): void }> {
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Camera scanning needs HTTPS. Use the deployed website, or localhost when testing on this computer.",
    );
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read camera images.");
  let detector: Detector | undefined;
  const NativeDetector =
    (globalThis as unknown as { BarcodeDetector?: DetectorConstructor })
      .BarcodeDetector;
  try {
    if (
      NativeDetector &&
      (await NativeDetector.getSupportedFormats()).includes("qr_code")
    ) detector = new NativeDetector({ formats: ["qr_code"] });
  } catch { /* Use the QR library if native detection is unavailable. */ }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  let stopped = false;
  let paused = false;
  let frame = 0;
  let lastFrame = 0;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    canvas.width = canvas.height = 0;
  };
  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    stop();
    throw error;
  }
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (!stopped) {
      stop();
      onError("Camera stopped. Start the camera again to continue.");
    }
  });
  const tick = async (time: number) => {
    if (stopped) return;
    try {
      if (
        !paused && !document.hidden && video.readyState >= 2 &&
        time - lastFrame >= 160
      ) {
        lastFrame = time;
        let code: string | undefined;
        if (detector) {
          try {
            code = (await detector.detect(video))[0]?.rawValue;
          } catch {
            detector = undefined;
          }
        } else if (video.videoWidth && video.videoHeight) {
          const scale = Math.min(
            1,
            800 / Math.max(video.videoWidth, video.videoHeight),
          );
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          code = decodeFrame(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height,
          );
        }
        if (stopped) return;
        if (code && onCode(code)) paused = true;
      }
    } catch {
      stop();
      onError(
        "Unable to read camera frames. Start the camera again to continue.",
      );
      return;
    }
    if (!stopped) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    stop,
    resume: () => {
      paused = false;
    },
  };
}
