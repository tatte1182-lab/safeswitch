/**
 * SafeSwitch · TabletIcon.tsx
 * Clean line-art tablet / iPad icon.
 */

import React from "react";
import Svg, { Rect, Circle, Line } from "react-native-svg";

interface Props {
  size?: number;
  color?: string;
  opacity?: number;
}

export function TabletIcon({ size = 32, color = "#00c8ff", opacity = 1 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Body */}
      <Rect
        x="3" y="1.5" width="18" height="21"
        rx="2.5" ry="2.5"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"
        fill={color + "10"}
        opacity={opacity}
      />
      {/* Screen */}
      <Rect
        x="5.5" y="4" width="13" height="15"
        rx="1" ry="1"
        stroke={color} strokeWidth="1" strokeLinejoin="round"
        fill={color + "15"}
        opacity={opacity}
      />
      {/* Home button */}
      <Circle cx="12" cy="21" r="0" fill="none" opacity={0} />
      <Line
        x1="10.5" y1="20.5" x2="13.5" y2="20.5"
        stroke={color} strokeWidth="1.5" strokeLinecap="round"
        opacity={opacity}
      />
      {/* Camera */}
      <Circle cx="12" cy="2.6" r="0.7" fill={color} opacity={opacity * 0.7} />
    </Svg>
  );
}
