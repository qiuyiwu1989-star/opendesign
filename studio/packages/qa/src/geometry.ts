import type { Frame } from "@opendesign/studio-contracts";

export function isOutOfBounds(frame: Frame, canvas: { width: number; height: number }): boolean {
  return frame.x < 0 || frame.y < 0 || frame.width <= 0 || frame.height <= 0 || frame.x + frame.width > canvas.width || frame.y + frame.height > canvas.height;
}

export function intersectionArea(left: Frame, right: Frame): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

export function overlapRatio(left: Frame, right: Frame): number {
  const intersection = intersectionArea(left, right);
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea <= 0 ? 0 : intersection / smallerArea;
}
