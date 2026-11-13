import encodeQR from "jsr:@paulmillr/qr@0.7.2";
import decodeQR from "jsr:@paulmillr/qr@0.7.2/decode.js";
import {
  cardIdFromCode,
  decodeFrame,
  decodeFrameAll,
  startScanner,
} from "./web/scanner.ts";

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
    await startScanner(
      {} as HTMLVideoElement,
      () => false,
      () => {},
      {} as HTMLElement,
    );
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("HTTPS");
  }
  assert(rejected);
});

Deno.test("both scanner decoders read only inside the overlay, excluding the rest of the visible preview", async () => {
  const url =
    "https://example.test/#/account/12f04857-96da-44c0-9b01-cab5baaa1122";
  const qr = encodeQR(url, "raw", { border: 4, scale: 3 });
  const otherUrl = url.replace("1122", "1123");
  const otherQr = encodeQR(otherUrl, "raw", { border: 4, scale: 3 });
  const globals = [
    "isSecureContext",
    "navigator",
    "document",
    "BarcodeDetector",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
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
      for (
        const [width, height] of [[900, 300], [300, 900], [1200, 900], [
          1800,
          1200,
        ]]
      ) {
        let nextFrame: FrameRequestCallback | undefined;
        let source = new Uint8ClampedArray(width * height * 4);
        let pixels = new Uint8ClampedArray();
        let trackStopped = false;
        const found: string[] = [];
        let latest: string[] = [];
        const errors: string[] = [];
        let previewSide = 300;
        const rect = (
          left: number,
          top: number,
          width: number,
          height: number,
        ) => ({
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height,
        });
        const guide = {
          getBoundingClientRect: () =>
            rect(
              20 + previewSide * .14,
              40 + previewSide * .14,
              previewSide * .72,
              previewSide * .72,
            ),
        };
        const video = {
          readyState: 2,
          videoWidth: width,
          videoHeight: height,
          srcObject: null,
          play: () => Promise.resolve(),
          getBoundingClientRect: () => rect(20, 40, previewSide, previewSide),
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
            const borderInset = (.14 + 2 / previewSide) * side;
            assert(Math.abs(sx - ((width - side) / 2 + borderInset)) < 1.01);
            assert(Math.abs(sy - ((height - side) / 2 + borderInset)) < 1.01);
            assert(Math.abs(sw - (side - 2 * borderInset)) < 2.01 && sw === sh);
            assert(dx === 0 && dy === 0);
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
        const populate = (
          position: "hidden" | "preview-edge" | "center" | "multiple",
        ) => {
          source = new Uint8ClampedArray(width * height * 4).fill(255);
          const x = position === "center"
            ? Math.floor((width - qr.length) / 2)
            : position === "preview-edge"
            ? (width - Math.min(width, height)) / 2
            : 0;
          const y = position !== "hidden"
            ? Math.floor((height - qr.length) / 2)
            : 0;
          const symbols = position === "multiple" ? [qr, otherQr] : [qr];
          for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            const px = position === "multiple"
              ? Math.floor(width / 2 - qr.length - 10 + i * (qr.length + 20))
              : x;
            const py = position === "multiple"
              ? Math.floor((height - qr.length) / 2)
              : y;
            for (let row = 0; row < symbol.length; row++) {
              for (let col = 0; col < symbol.length; col++) {
                const offset = ((py + row) * width + px + col) * 4;
                source[offset] =
                  source[offset + 1] =
                  source[offset + 2] =
                    symbol[row][col] ? 0 : 255;
              }
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
        set("getComputedStyle", (element: unknown) => {
          assert(element === guide);
          return {
            borderLeftWidth: "2px",
            borderTopWidth: "2px",
            borderRightWidth: "2px",
            borderBottomWidth: "2px",
          };
        });
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
                return decodeFrameAll(pixels, canvas.width, canvas.height).then(
                  (codes) =>
                    codes.map((code) => ({
                      rawValue: code.value,
                      cornerPoints: code.corners,
                    })),
                );
              }
            }
            : undefined,
        );
        const scanner = await startScanner(
          video as unknown as HTMLVideoElement,
          (codes) => {
            latest = codes.map((code) => code.value);
            found.push(...codes.map((code) => code.value));
            for (const code of codes) {
              for (const point of code.corners) {
                assert(
                  point.x > .14 && point.x < .86 && point.y > .14 &&
                    point.y < .86,
                  "Returned corners must map inside the preview's inner guide",
                );
              }
            }
          },
          (error) => errors.push(error),
          guide as unknown as HTMLElement,
        );
        try {
          populate("hidden");
          await nextFrame!(200);
          assert(
            found.length === 0,
            `Hidden card was read (${
              native ? "native" : "fallback"
            }, ${width}x${height})`,
          );
          populate("preview-edge");
          await nextFrame!(400);
          assert(
            found.length === 0,
            "A card inside the camera preview but outside the overlay must be ignored",
          );
          // The overlay and preview can resize when browser UI or orientation changes.
          previewSide = 240;
          populate("center");
          await nextFrame!(600);
          assert(
            found.join() === url,
            `Visible card was not read (${
              native ? "native" : "fallback"
            }, ${width}x${height})`,
          );
          assert(errors.length === 0);
          if (Math.min(width, height) >= 900) {
            populate("multiple");
            await nextFrame!(800);
            assert(
              latest.length === 2 && latest.includes(url) &&
                latest.includes(otherUrl),
              "Both cards inside the overlay must be returned together",
            );
          }
          source.fill(255);
          await nextFrame!(1000);
          assert(latest.length === 0, "A blank frame must clear old outlines");
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
