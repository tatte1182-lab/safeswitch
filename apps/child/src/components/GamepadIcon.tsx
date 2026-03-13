/**
 * SafeSwitch · GamepadIcon.tsx
 * Clean line-art game controller icon.
 */

import React from "react";
import Svg, { Path, Circle, Line, Rect } from "react-native-svg";

interface Props {
  size?: number;
  color?: string;
  opacity?: number;
}

export function GamepadIcon({ size = 32, color = "#00c8ff", opacity = 1 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Controller body */}
      <Path
        d="M6 8C3.5 8 2 10 2 12.5C2 15.5 3.5 18 6 18C7.5 18 8.5 17 9.5 16H14.5C15.5 17 16.5 18 18 18C20.5 18 22 15.5 22 12.5C22 10 20.5 8 18 8H6Z"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"
        fill={color + "10"}
        opacity={opacity}
      />
      {/* D-pad vertical */}
      <Line x1="7" y1="10.5" x2="7" y2="15.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity={opacity} />
      {/* D-pad horizontal */}
      <Line x1="4.5" y1="13" x2="9.5" y2="13" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity={opacity} />
      {/* Button A */}
      <Circle cx="17" cy="12" r="1.1" stroke={color} strokeWidth="1.2" fill={color + "20"} opacity={opacity} />
      {/* Button B */}
      <Circle cx="19.2" cy="13.5" r="1.1" stroke={color} strokeWidth="1.2" fill={color + "20"} opacity={opacity} />
      {/* Start / select lines */}
      <Line x1="11" y1="12.5" x2="12.2" y2="12.5" stroke={color} strokeWidth="1" strokeLinecap="round" opacity={opacity * 0.7} />
      <Line x1="11.8" y1="11.2" x2="13" y2="11.2" stroke={color} strokeWidth="1" strokeLinecap="round" opacity={opacity * 0.7} />
    </Svg>
  );
}
