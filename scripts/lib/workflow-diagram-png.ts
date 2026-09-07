import { instance as createViz } from "@viz-js/viz";
import sharp from "sharp";

let vizInstancePromise = null;

async function getViz() {
  if (!vizInstancePromise) {
    vizInstancePromise = createViz();
  }
  return vizInstancePromise;
}

export async function renderDotToPng(dotSource = "") {
  const viz = await getViz();
  const sanitizedDot = String(dotSource || "")
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("@import "))
    .join("\n");
  const svg = viz.renderString(sanitizedDot, { format: "svg" });
  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}
