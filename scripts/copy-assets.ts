// Deno bundles the HTML's TypeScript imports; these assets keep stable URLs.
for (const file of ["style.css", "manifest.webmanifest", "qr-LICENSE.txt"]) {
  await Deno.copyFile(`web/${file}`, `dist/${file}`);
}
await Deno.writeTextFile("dist/.nojekyll", "");
