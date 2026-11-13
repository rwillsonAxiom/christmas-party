import encodeQR from "jsr:@paulmillr/qr@0.7.2";
import decodeQR from "jsr:@paulmillr/qr@0.7.2/decode.js";
import { cardIdFromCode, decodeFrame, startScanner } from "./web/scanner.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("generated card QR decodes into the original account URL", () => {
  const id = "12f04857-96da-44c0-9b01-cab5baaa1122";
  const url = `https://example.github.io/credit-cards/#/account/${id}`;
  const matrix = encodeQR(url, "raw", { border: 4, scale: 5 });
  const size = matrix.length;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = matrix[y][x]
        ? 0
        : 255;
      data[offset + 3] = 255;
    }
  }
  const decoded = decodeFrame(data, size, size);
  assert(decoded === url);
  assert(cardIdFromCode(decoded) === id);
});

Deno.test("untrusted QR content cannot become executable markup or navigation", () => {
  const id = "12f04857-96da-44c0-9b01-cab5baaa1122";
  for (
    const value of [
      "javascript:alert(1)",
      `<img src=x onerror=alert(1)>`,
      `https://example/#/account/${id}/extra`,
      "not a URL",
      `data:text/html,test#/account/${id}`,
      `https://user:pass@example/#/account/${id}`,
    ]
  ) assert(cardIdFromCode(value) === undefined);
  // Only an account ID is extracted; an external URL is never opened.
  assert(cardIdFromCode(`https://old-host.example/#/account/${id}`) === id);
  assert(cardIdFromCode(`http://localhost:8000/a/${id}`) === id);
});

Deno.test("decoder safely rejects malformed image buffers and empty frames", () => {
  for (
    const [width, height, data] of [[-1, 1, new Uint8ClampedArray(4)], [
      4097,
      1,
      new Uint8ClampedArray(4),
    ], [100, 100, new Uint8ClampedArray(4)]] as const
  ) {
    let rejected = false;
    try {
      decodeQR({ width, height, data });
    } catch {
      rejected = true;
    }
    assert(rejected);
    assert(decodeFrame(data, width, height) === undefined);
  }
  assert(
    decodeFrame(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100) ===
      undefined,
  );
});

Deno.test("camera scanning rejects insecure contexts before accessing a camera", async () => {
  let rejected = false;
  try {
    await startScanner({} as HTMLVideoElement, () => false, () => {});
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("HTTPS");
  }
  assert(rejected);
});

Deno.test("both scanner decoders ignore QR codes outside the visible center square", async () => {
  const url =
    "https://example.test/#/account/12f04857-96da-44c0-9b01-cab5baaa1122";
  const qr = encodeQR(url, "raw", { border: 4, scale: 3 });
  const globals = [
    "isSecureContext",
    "navigator",
    "document",
    "BarcodeDetector",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];
  const saved = new Map(
    globals.map((
      key,
    ) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const set = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    for (const native of [true, false]) {
      for (const [width, height] of [[900, 300], [300, 900], [1200, 900]]) {
        let nextFrame: FrameRequestCallback | undefined;
        let source = new Uint8ClampedArray(width * height * 4);
        let pixels = new Uint8ClampedArray();
        let trackStopped = false;
        const found: string[] = [];
        const errors: string[] = [];
        const video = {
          readyState: 2,
          videoWidth: width,
          videoHeight: height,
          srcObject: null,
          play: () => Promise.resolve(),
        };
        const canvas = { width: 0, height: 0, getContext: () => context };
        const context = {
          drawImage(
            image: unknown,
            sx: number,
            sy: number,
            sw: number,
            sh: number,
            dx: number,
            dy: number,
            dw: number,
            dh: number,
          ) {
            assert(image === video);
            const side = Math.min(width, height);
            assert(sx === (width - side) / 2 && sy === (height - side) / 2);
            assert(sw === side && sh === side && dx === 0 && dy === 0);
            assert(dw === dh && dw <= 800, "Crop must be square and bounded");
            pixels = new Uint8ClampedArray(dw * dh * 4);
            for (let y = 0; y < dh; y++) {
              for (let x = 0; x < dw; x++) {
                const offset = (Math.floor(sy + y * sh / dh) * width +
                  Math.floor(sx + x * sw / dw)) * 4;
                pixels.set(
                  source.subarray(offset, offset + 4),
                  (y * dw + x) * 4,
                );
              }
            }
          },
          getImageData: () => ({ data: pixels }),
        };
        const populate = (center: boolean) => {
          source = new Uint8ClampedArray(width * height * 4).fill(255);
          // Portrait/landscape place the hidden card fully outside the crop.
          // The larger frame also checks a partially clipped card is not decoded.
          const x = center ? Math.floor((width - qr.length) / 2) : 0;
          const y = center ? Math.floor((height - qr.length) / 2) : 0;
          for (let row = 0; row < qr.length; row++) {
            for (let col = 0; col < qr.length; col++) {
              const offset = ((y + row) * width + x + col) * 4;
              source[offset] =
                source[offset + 1] =
                source[offset + 2] =
                  qr[row][col] ? 0 : 255;
            }
          }
        };
        set("isSecureContext", true);
        set("navigator", {
          mediaDevices: {
            getUserMedia: () =>
              Promise.resolve({
                getTracks: () => [{ stop: () => trackStopped = true }],
                getVideoTracks: () => [],
              }),
          },
        });
        set("document", { hidden: false, createElement: () => canvas });
        set("requestAnimationFrame", (callback: FrameRequestCallback) => {
          nextFrame = callback;
          return 1;
        });
        set("cancelAnimationFrame", () => {
          nextFrame = undefined;
        });
        set(
          "BarcodeDetector",
          native
            ? class {
              static getSupportedFormats() {
                return Promise.resolve(["qr_code"]);
              }
              detect(image: unknown) {
                assert(
                  image === canvas,
                  "Native detection must receive the crop, never the video",
                );
                const code = decodeFrame(pixels, canvas.width, canvas.height);
                return Promise.resolve(code ? [{ rawValue: code }] : []);
              }
            }
            : undefined,
        );
        const scanner = await startScanner(
          video as unknown as HTMLVideoElement,
          (code) => {
            found.push(code);
            return false;
          },
          (error) => errors.push(error),
        );
        try {
          populate(false);
          await nextFrame!(200);
          assert(
            found.length === 0,
            `Hidden card was read (${
              native ? "native" : "fallback"
            }, ${width}x${height})`,
          );
          populate(true);
          await nextFrame!(400);
          assert(
            found.join() === url,
            `Visible card was not read (${
              native ? "native" : "fallback"
            }, ${width}x${height})`,
          );
          assert(errors.length === 0);
        } finally {
          scanner.stop();
        }
        assert(trackStopped);
      }
    }
  } finally {
    for (const key of globals) {
      const descriptor = saved.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
