import React from 'react';
import { theme } from 'antd';

export const ConeekoLogo = ({ 
  width = 190, 
  height = 36, 
  collapsed = false,
  color,
}: { 
  width?: number; 
  height?: number; 
  collapsed?: boolean;
  color?: string;
}) => {
  const { token } = theme.useToken();
  
  return (
    <svg
      width={collapsed ? 36 : width}
      height={height}
      viewBox={collapsed ? "0 0 36 40" : "0 0 180 40"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <text
        x={collapsed ? "18" : "0"}
        y="30"
        fontFamily="'Outfit', 'Inter', -apple-system, sans-serif"
        fontWeight="900"
        fontSize={collapsed ? "32" : "32"}
        fill={color || token.colorText}
        letterSpacing={collapsed ? "0" : "3"}
        textAnchor={collapsed ? "middle" : "start"}
        style={{
          textTransform: 'uppercase',
        }}
      >
        {collapsed ? "C" : "CONEEKO"}
      </text>
    </svg>
  );
};
