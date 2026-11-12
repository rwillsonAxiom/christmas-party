import encodeQR from "jsr:@paulmillr/qr@0.7.2";
import decodeQR from "jsr:@paulmillr/qr@0.7.2/decode.js";
import { cardIdFromCode, decodeFrame, startScanner } from "./scanner.ts";

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
