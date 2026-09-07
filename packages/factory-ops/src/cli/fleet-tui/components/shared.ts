/**
 * Shared UI primitives for fleet TUI components.
 */

import { Box, Text, useStdout } from "ink";
import React, { useEffect, useState } from "react";

export function h(type: React.ElementType, props: Record<string, unknown> | null, ...children: unknown[]): React.ReactElement {
  return React.createElement(type, props, ...children);
}

export function useTerminalDimensions(): [number, number] {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState<[number, number]>(() => [
    Number(stdout?.columns) || 120,
    Number(stdout?.rows) || 40,
  ]);

  useEffect(() => {
    const update = () => {
      setDimensions([
        Number(stdout?.columns) || 120,
        Number(stdout?.rows) || 40,
      ]);
    };
    update();
    stdout?.on?.("resize", update);
    return () => stdout?.off?.("resize", update);
  }, [stdout]);

  return dimensions;
}

export function Divider({ color = "gray", width = 16 }: { color?: string; width?: number }): React.ReactElement {
  return h(Text, { color }, "─".repeat(Math.max(6, width)));
}

export function ViewPill({ title = "", selected = false, index = 0 }: { title?: string; selected?: boolean; index?: number }): React.ReactElement {
  return h(
    Box,
    { marginRight: 1 },
    h(Text, {
      color: selected ? "black" : "gray",
      backgroundColor: selected ? "cyan" : undefined,
      bold: selected,
    }, ` ${index + 1}:${title} `),
  );
}

export function StatusChip({ label = "", color = "gray", inverse = false }: { label?: string; color?: string; inverse?: boolean }): React.ReactElement {
  return h(
    Box,
    { marginRight: 1 },
    h(Text, {
      color: inverse ? "black" : color,
      backgroundColor: inverse ? color : undefined,
      bold: true,
    }, inverse ? ` ${label} ` : label),
  );
}

export function SectionHeader({ title = "", accent = "cyan", meta = "" }: { title?: string; accent?: string; meta?: string }): React.ReactElement {
  return h(
    Box,
    { justifyContent: "space-between", marginBottom: 1 },
    h(Text, { color: accent, bold: true }, title),
    meta ? h(Text, { color: "gray" }, meta) : h(Box, null),
  );
}
