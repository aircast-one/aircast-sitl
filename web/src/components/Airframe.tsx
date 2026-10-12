import type { SVGProps } from "react";

export type AirframeId = "copter" | "plane" | "quadplane";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Rotor({ cx, cy, r = 5.5 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} {...stroke} strokeDasharray="2.5 2" />;
}

function Copter() {
  return (
    <>
      <path d="M14 14 L34 34 M34 14 L14 34" {...stroke} />
      <rect x="20" y="20" width="8" height="8" rx="2" {...stroke} />
      <Rotor cx={12} cy={12} r={7} />
      <Rotor cx={36} cy={12} r={7} />
      <Rotor cx={12} cy={36} r={7} />
      <Rotor cx={36} cy={36} r={7} />
    </>
  );
}

function Fuselage() {
  return (
    <path
      d="M24 6 C25.6 6 26.4 8 26.4 11 L26.4 19 L43 25.5 L43 28.5 L26.4 25.5 L26 35.5 L31.5 39.5 L31.5 42 L24 40.5 L16.5 42 L16.5 39.5 L22 35.5 L21.6 25.5 L5 28.5 L5 25.5 L21.6 19 L21.6 11 C21.6 8 22.4 6 24 6 Z"
      {...stroke}
    />
  );
}

function Plane() {
  return <Fuselage />;
}

function QuadPlane() {
  return (
    <>
      <path d="M11 15 L11 33 M37 15 L37 33" {...stroke} />
      <Rotor cx={11} cy={13} r={4.5} />
      <Rotor cx={11} cy={35} r={4.5} />
      <Rotor cx={37} cy={13} r={4.5} />
      <Rotor cx={37} cy={35} r={4.5} />
      <Fuselage />
    </>
  );
}

const shapes = { copter: Copter, plane: Plane, quadplane: QuadPlane };

export function AirframeIcon({ airframe, ...props }: { airframe: AirframeId } & SVGProps<SVGSVGElement>) {
  const Shape = shapes[airframe];
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <Shape />
    </svg>
  );
}
