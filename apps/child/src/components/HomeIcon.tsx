/**
 * SafeSwitch · HomeIcon.tsx
 * Clean line-art house icon matching the dashboard network map aesthetic.
 * Uses react-native-svg for crisp rendering at any size.
 */

import React from "react";
import Svg, { Path, Rect, Polygon, Line } from "react-native-svg";

interface Props {
  size?: number;
  color?: string;
  opacity?: number;
}

export function HomeIcon({ size = 32, color = "#00c8ff", opacity = 1 }: Props) {
  const s = size;
  // All coordinates normalised to a 24x24 grid then scaled
  const sc = s / 24;

  return (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      {/* Chimney */}
      <Rect
        x="14.5" y="2" width="2.5" height="4.5"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"
        fill={color + "18"}
        opacity={opacity}
      />
      {/* Roof */}
      <Polygon
        points="2,11 12,2 22,11"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"
        fill={color + "18"}
        opacity={opacity}
      />
      {/* Walls */}
      <Rect
        x="4" y="11" width="16" height="11"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"
        fill={color + "10"}
        opacity={opacity}
      />
      {/* Door */}
      <Path
        d="M10 22V17.5C10 16.7 10.7 16 11.5 16H12.5C13.3 16 14 16.7 14 17.5V22"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"
        fill={color + "25"}
        opacity={opacity}
      />
      {/* Window left */}
      <Rect
        x="5.5" y="13.5" width="4" height="3.5"
        stroke={color} strokeWidth="1.2" strokeLinejoin="round"
        fill={color + "20"}
        opacity={opacity}
      />
      {/* Window left cross */}
      <Line x1="7.5" y1="13.5" x2="7.5" y2="17" stroke={color} strokeWidth="0.8" opacity={opacity * 0.6} />
      <Line x1="5.5" y1="15.25" x2="9.5" y2="15.25" stroke={color} strokeWidth="0.8" opacity={opacity * 0.6} />
      {/* Window right */}
      <Rect
        x="14.5" y="13.5" width="4" height="3.5"
        stroke={color} strokeWidth="1.2" strokeLinejoin="round"
        fill={color + "20"}
        opacity={opacity}
      />
      {/* Window right cross */}
      <Line x1="16.5" y1="13.5" x2="16.5" y2="17" stroke={color} strokeWidth="0.8" opacity={opacity * 0.6} />
      <Line x1="14.5" y1="15.25" x2="18.5" y2="15.25" stroke={color} strokeWidth="0.8" opacity={opacity * 0.6} />
    </Svg>
  );
}
