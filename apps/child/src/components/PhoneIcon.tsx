/**
 * SafeSwitch · PhoneIcon.tsx
 * Clean line-art smartphone icon.
 */

import React from "react";
import Svg, { Rect, Circle, Line } from "react-native-svg";

interface Props {
  size?: number;
  color?: string;
  opacity?: number;
}

export function PhoneIcon({ size = 32, color = "#00c8ff", opacity = 1 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body */}
      <Rect
        x="5" y="1.5" width="14" height="21"
        rx="2.5" ry="2.5"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"
        fill={color + "10"}
        opacity={opacity}
      />
      {/* Screen area */}
      <Rect
        x="7" y="4" width="10" height="14"
        rx="1" ry="1"
        stroke={color} strokeWidth="1" strokeLinejoin="round"
        fill={color + "15"}
        opacity={opacity}
      />
      {/* Home button / bottom indicator */}
      <Line
        x1="10" y1="20" x2="14" y2="20"
        stroke={color} strokeWidth="1.5" strokeLinecap="round"
        opacity={opacity}
      />
      {/* Front camera dot */}
      <Circle cx="12" cy="2.6" r="0.7" fill={color} opacity={opacity * 0.7} />
    </Svg>
  );
}
