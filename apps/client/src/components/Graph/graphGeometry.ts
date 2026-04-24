export type GraphRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function rectanglesOverlap(a: GraphRect, b: GraphRect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
