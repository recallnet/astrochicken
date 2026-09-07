export function enterFullscreenTui(stdout) {
  if (!stdout?.isTTY) return;
  stdout.write("\u001b[?1049h\u001b[2J\u001b[H");
}

export function exitFullscreenTui(stdout) {
  if (!stdout?.isTTY) return;
  stdout.write("\u001b[?1049l");
}

export function writeFollowFrame(stdout, output) {
  const text = String(output || "");
  if (stdout?.isTTY) {
    stdout.write(`\u001b[2J\u001b[H${text}\n`);
    return;
  }
  stdout.write(`${text}\n`);
}
