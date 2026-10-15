import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { instance as createViz } from "@viz-js/viz";

const require = createRequire(import.meta.url);
const fontBuffer = readFileSync(new URL("../assets/workflow-diagrams/NotoSans-Regular.ttf", import.meta.url));
let rendererPromise = null;

async function getRenderer() {
  if (!rendererPromise) {
    rendererPromise = Promise.all([
      createViz(),
      initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))),
    ]).then(([viz]) => viz);
  }
  return rendererPromise;
}

export async function renderDotToPng(dotSource = "") {
  const viz = await getRenderer();
  const sanitizedDot = String(dotSource || "")
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("@import "))
    .join("\n");
  const svg = viz.renderString(sanitizedDot, { format: "svg" });
  // WASM rasterization and an explicit font database keep exact publication
  // hashes independent of host fonts, libvips, and native PNG encoders.
  const renderer = new Resvg(svg, {
    font: {
      fontBuffers: [fontBuffer],
      defaultFontFamily: "Noto Sans",
      serifFamily: "Noto Sans",
      sansSerifFamily: "Noto Sans",
      monospaceFamily: "Noto Sans",
    },
  });
  try {
    const image = renderer.render();
    try {
      return Buffer.from(image.asPng());
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}
