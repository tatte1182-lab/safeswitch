/**
 * SafeSwitch · LaptopIcon.tsx
 * Clean line-art laptop icon.
 */

import React from "react";
import Svg, { Rect, Path, Line } from "react-native-svg";

interface Props {
  size?: number;
  color?: string;
  opacity?: number;
}

export function LaptopIcon({ size = 32, color = "#00c8ff", opacity = 1 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Screen lid */}
      <Rect
        x="3" y="3" width="18" height="12"
        rx="1.5" ry="1.5"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"
        fill={color + "10"}
        opacity={opacity}
      />
      {/* Screen bezel inner */}
      <Rect
        x="5" y="4.5" width="14" height="9"
        rx="0.8" ry="0.8"
        stroke={color} strokeWidth="1"
        fill={color + "18"}
        opacity={opacity}
      />
      {/* Base / keyboard deck */}
      <Path
        d="M1 15.5 L2.5 15.5 L2.5 17.5 C2.5 18.05 2.95 18.5 3.5 18.5 L20.5 18.5 C21.05 18.5 21.5 18.05 21.5 17.5 L21.5 15.5 L23 15.5"
        stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        fill={color + "10"}
        opacity={opacity}
      />
      {/* Trackpad */}
      <Rect
        x="9.5" y="16" width="5" height="2"
        rx="0.5"
        stroke={color} strokeWidth="0.8"
        fill={color + "20"}
        opacity={opacity * 0.8}
      />
      {/* Keyboard hint lines */}
      <Line x1="6" y1="16.5" x2="8.5" y2="16.5" stroke={color} strokeWidth="0.7" strokeLinecap="round" opacity={opacity * 0.4} />
      <Line x1="15.5" y1="16.5" x2="18" y2="16.5" stroke={color} strokeWidth="0.7" strokeLinecap="round" opacity={opacity * 0.4} />
    </Svg>
  );
}
