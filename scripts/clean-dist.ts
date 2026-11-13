// Only remove the generated output directory next to this repository's scripts.
const output = new URL("../dist/", import.meta.url);
try {
  const info = await Deno.lstat(output);
  if (info.isSymlink) {
    throw new Error("Refusing to clean a symlinked dist directory.");
  }
  await Deno.remove(output, { recursive: true });
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}
