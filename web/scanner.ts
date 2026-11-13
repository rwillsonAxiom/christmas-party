// Pinned and reviewed; see dependency-review.txt and web/qr-LICENSE.txt.
import decodeQR, { decodeQRBatch } from "jsr:@paulmillr/qr@0.7.2/decode.js";

export interface Point {
  x: number;
  y: number;
}
export interface ScannedCode {
  value: string;
  // Decoder coordinates are pixels; startScanner reports preview-relative 0..1 coordinates.
  corners: Point[];
}

export async function decodeFrameAll(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<ScannedCode[]> {
  const codes: ScannedCode[] = [];
  try {
    await decodeQRBatch([{ data, width, height }], {
      effort: 1,
      timeLimit: 8,
      maxSize: { width, height },
      pointsOnDetect: (points, result) => {
        if (typeof result === "string") {
          codes.push({
            value: result,
            corners: points.bounds.map(({ x, y }) => ({ x, y })),
          });
        }
      },
    });
  } catch { /* An unreadable frame is an empty set, not a camera failure. */ }
  return codes;
}

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
  detect(
    image: HTMLCanvasElement,
  ): Promise<{ rawValue: string; cornerPoints: Point[] }[]>;
}
interface DetectorConstructor {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

export async function startScanner(
  video: HTMLVideoElement,
  onCodes: (codes: ScannedCode[]) => void,
  onError: (message: string) => void,
  guide: HTMLElement,
): Promise<{ stop(): void }> {
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
  let frame = 0;
  let lastFrame = 0;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    canvas.width = canvas.height = 0;
    onCodes([]);
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
        !document.hidden && video.readyState >= 2 &&
        video.videoWidth > 0 && video.videoHeight > 0 &&
        time - lastFrame >= 160
      ) {
        lastFrame = time;
        // Map the overlay's inner border to source pixels after the preview's
        // centered object-fit: cover crop. Measure each frame to follow resizing.
        const preview = video.getBoundingClientRect();
        const overlay = guide.getBoundingClientRect();
        const borders = getComputedStyle(guide);
        const left = Math.max(
          preview.left,
          overlay.left + parseFloat(borders.borderLeftWidth),
        );
        const top = Math.max(
          preview.top,
          overlay.top + parseFloat(borders.borderTopWidth),
        );
        const right = Math.min(
          preview.right,
          overlay.right - parseFloat(borders.borderRightWidth),
        );
        const bottom = Math.min(
          preview.bottom,
          overlay.bottom - parseFloat(borders.borderBottomWidth),
        );
        if (
          !preview.width || !preview.height || right <= left || bottom <= top
        ) {
          onCodes([]);
          frame = requestAnimationFrame(tick);
          return;
        }
        const scale = Math.max(
          preview.width / video.videoWidth,
          preview.height / video.videoHeight,
        );
        const sourceLeft = preview.left +
          (preview.width - video.videoWidth * scale) / 2;
        const sourceTop = preview.top +
          (preview.height - video.videoHeight * scale) / 2;
        // Round inward so neither decoder sees pixels beyond the overlay.
        const sx = Math.max(0, Math.ceil((left - sourceLeft) / scale));
        const sy = Math.max(0, Math.ceil((top - sourceTop) / scale));
        const width =
          Math.min(video.videoWidth, Math.floor((right - sourceLeft) / scale)) -
          sx;
        const height = Math.min(
          video.videoHeight,
          Math.floor((bottom - sourceTop) / scale),
        ) - sy;
        if (width <= 0 || height <= 0) {
          onCodes([]);
          frame = requestAnimationFrame(tick);
          return;
        }
        const downsample = Math.min(1, 800 / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * downsample));
        canvas.height = Math.max(1, Math.round(height * downsample));
        context.drawImage(
          video,
          sx,
          sy,
          width,
          height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        let codes: ScannedCode[] = [];
        if (detector) {
          try {
            codes = (await detector.detect(canvas)).map((
              { rawValue, cornerPoints },
            ) => ({ value: rawValue, corners: cornerPoints }));
          } catch {
            detector = undefined;
          }
        }
        if (stopped) return;
        if (!detector) {
          codes = await decodeFrameAll(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height,
          );
        }
        if (stopped) return;
        // Ignore estimates extending outside the scan area; outline only pixels we read.
        const contained = codes.filter(({ corners }) =>
          corners?.length === 4 &&
          corners.every(({ x, y }) =>
            Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 &&
            x <= canvas.width && y <= canvas.height
          )
        );
        onCodes(
          contained.map(({ value, corners }) => ({
            value,
            corners: corners.map(({ x, y }) => ({
              x: (sourceLeft + (sx + x * width / canvas.width) * scale -
                preview.left) / preview.width,
              y: (sourceTop + (sy + y * height / canvas.height) * scale -
                preview.top) / preview.height,
            })),
          })),
        );
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
  return { stop };
}
