"use client";

import { memo } from "react";
import { Empty, Typography, theme } from "antd";
import { fmtMoney } from "../types";
import type { FloorPlan } from "../types";

const { Text } = Typography;

interface Props {
  floorPlans: FloorPlan[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string | null) => void;
}

/** Live floor plan map — tap a table to select/deselect it for the order. */
function FloorPlanView({ floorPlans, selectedTableId, onSelectTable }: Props) {
  const { token } = theme.useToken();

  return (
    <div
      className="pos-menu-panel"
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflowY: "auto",
        background: token.colorFillAlter,
        border: `1px solid ${token.colorBorder}`,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowTertiary,
        padding: token.padding,
      }}
    >
      {floorPlans.length === 0 ? (
        <Empty description="No floor plans available." />
      ) : (
        floorPlans.map((fp) => (
          <div
            key={fp.id}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusLG,
              padding: token.padding,
            }}
          >
            <Text
              strong
              style={{ fontSize: 18, marginBottom: 16, display: "block" }}
            >
              {fp.name}
            </Text>
            <div
              style={{
                position: "relative",
                width: "100%",
                height: 400,
                background: token.colorFillAlter,
                borderRadius: token.borderRadius,
              }}
            >
              {fp.tables?.map((table) => {
                const isSelected = selectedTableId === table.id;
                let bgColor = token.colorBgContainer;
                if (table.status === "occupied") bgColor = token.colorWarningBg;
                else if (table.status === "billed")
                  bgColor = token.colorSuccessBg;

                return (
                  <div
                    key={table.id}
                    onClick={() => onSelectTable(isSelected ? null : table.id)}
                    style={{
                      position: "absolute",
                      left: `${table.posX}%`,
                      top: `${table.posY}%`,
                      width: 80,
                      height: table.shape === "circle" ? 80 : 60,
                      borderRadius:
                        table.shape === "circle" ? "50%" : token.borderRadius,
                      background: bgColor,
                      border: `2px solid ${isSelected ? token.colorPrimary : token.colorBorder}`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      boxShadow: token.boxShadowTertiary,
                      transform: "translate(-50%, -50%)",
                      transition: "all 0.2s",
                    }}
                  >
                    <Text strong>{table.name}</Text>
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {table.capacity} pax
                    </Text>
                    {(table.activeOrderTotal ?? 0) > 0 && (
                      <Text type="success" style={{ fontSize: 12, marginTop: 4 }}>
                        {fmtMoney(table.activeOrderTotal ?? 0)}
                      </Text>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default memo(FloorPlanView);
