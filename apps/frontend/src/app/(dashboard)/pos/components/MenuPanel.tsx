"use client";

import { memo, useMemo, useState } from "react";
import { Badge, Button, Empty, Input, Tag, Typography, theme } from "antd";
import {
  ClockCircleOutlined,
  SearchOutlined,
  StarFilled,
} from "@ant-design/icons";
import { FAVORITES_ID, fmtMoney } from "../types";
import type { Category, MenuItem } from "../types";

const { Text } = Typography;

interface Props {
  categories: Category[];
  openOrdersCount: number;
  onOpenTransactions: () => void;
  onItemTap: (item: MenuItem) => void;
}

/**
 * Category rail + search + item grid. Browsing state (search text, selected
 * category) lives here so typing/tapping never re-renders the cart, and cart
 * edits never re-render the grid (component is memoized).
 */
function MenuPanel({
  categories,
  openOrdersCount,
  onOpenTransactions,
  onItemTap,
}: Props) {
  const { token } = theme.useToken();
  // null = "no explicit choice yet" — fall back to the first category once
  // the menu loads, without needing an effect.
  const [chosenCatId, setChosenCatId] = useState<string | null>(null);
  const selectedCatId = chosenCatId ?? categories[0]?.id ?? null;
  const [search, setSearch] = useState("");

  const allItems = useMemo(
    () =>
      categories.flatMap((c) => (c.items ?? []).filter((i) => !i.deletedAt)),
    [categories],
  );
  const favoriteItems = useMemo(
    () => allItems.filter((i) => i.isFavorite),
    [allItems],
  );
  const hasFavorites = favoriteItems.length > 0;

  const searchQuery = search.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    if (searchQuery) {
      return allItems.filter((i) => i.name.toLowerCase().includes(searchQuery));
    }
    if (selectedCatId === FAVORITES_ID) return favoriteItems;
    const cat = categories.find((c) => c.id === selectedCatId);
    return (cat?.items ?? []).filter((i) => !i.deletedAt);
  }, [searchQuery, allItems, selectedCatId, favoriteItems, categories]);

  const pills: { id: string; name: string; icon?: React.ReactNode }[] = [
    ...(hasFavorites
      ? [{ id: FAVORITES_ID, name: "Favorites", icon: <StarFilled /> }]
      : []),
    ...categories.map((c) => ({ id: c.id, name: c.name })),
  ];

  return (
    <>
      {/* Category rail — vertical list of categories */}
      <div
        className="pos-cat-rail pos-scroll"
        role="tablist"
        aria-label="Menu categories"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorder}`,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowTertiary,
          padding: token.paddingXS,
        }}
      >
        {pills.map((pill) => {
          const active = pill.id === selectedCatId && !searchQuery;
          return (
            <button
              key={pill.id}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setSearch("");
                setChosenCatId(pill.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                border: `1px solid ${active ? token.colorPrimary : "transparent"}`,
                // Left accent bar marks the active category (classic register rail)
                boxShadow: active
                  ? `inset 4px 0 0 ${token.colorPrimary}`
                  : "none",
                cursor: "pointer",
                borderRadius: token.borderRadius,
                padding: "14px 14px",
                background: active ? token.colorPrimaryBg : "transparent",
                color: active ? token.colorPrimary : token.colorText,
                fontWeight: 600,
                fontSize: 15,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                if (!active)
                  e.currentTarget.style.background = token.colorFillTertiary;
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              {pill.icon}
              {pill.name}
            </button>
          );
        })}
      </div>

      {/* Items area */}
      <div
        className="pos-menu-panel"
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: token.marginSM,
          background: token.colorFillAlter,
          border: `1px solid ${token.colorBorder}`,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowTertiary,
          padding: token.padding,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search menu"
            style={{ flex: 1, maxWidth: 420 }}
          />
          <Badge count={openOrdersCount} size="small" offset={[-4, 2]}>
            <Button
              icon={<ClockCircleOutlined />}
              onClick={onOpenTransactions}
              aria-label="View transactions"
            >
              Transactions
            </Button>
          </Badge>
        </div>

        {/* Item grid */}
        <div
          className="pos-scroll"
          style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
        >
          {visibleItems.length === 0 ? (
            <Empty
              description={
                searchQuery
                  ? `No items match “${search.trim()}”.`
                  : "No items in this category."
              }
            />
          ) : (
            <div className="pos-item-grid" style={{ gap: token.marginSM }}>
              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  className="pos-tile"
                  onClick={() => onItemTap(item)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onItemTap(item);
                  }}
                  aria-label={`Add ${item.name}`}
                  style={{
                    cursor: item.isAvailable ? "pointer" : "not-allowed",
                    opacity: item.isAvailable ? 1 : 0.45,
                    userSelect: "none",
                    background: token.colorBgContainer,
                    border: `1px solid ${token.colorBorder}`,
                    borderRadius: token.borderRadiusLG,
                    padding: token.paddingSM,
                    minHeight: 112,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-start",
                    gap: 6,
                    overflow: "hidden",
                    boxShadow: token.boxShadowTertiary,
                    transition:
                      "border-color 0.15s, box-shadow 0.15s, transform 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!item.isAvailable) return;
                    e.currentTarget.style.borderColor = token.colorPrimary;
                    e.currentTarget.style.boxShadow = token.boxShadowSecondary;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = token.colorBorder;
                    e.currentTarget.style.boxShadow = token.boxShadowTertiary;
                    e.currentTarget.style.transform = "none";
                  }}
                >
                  {/* Full name always visible — wraps to the next line */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 4,
                      minWidth: 0,
                    }}
                  >
                    {item.isFavorite && (
                      <StarFilled
                        style={{
                          color: token.colorWarning,
                          fontSize: 12,
                          flexShrink: 0,
                          marginTop: 4,
                        }}
                      />
                    )}
                    <Text
                      strong
                      style={{
                        fontSize: 14,
                        lineHeight: 1.35,
                        flex: 1,
                        minWidth: 0,
                        overflowWrap: "break-word",
                      }}
                    >
                      {item.name}
                    </Text>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: "auto",
                    }}
                  >
                    <Text
                      strong
                      style={{
                        fontSize: 16,
                        color: token.colorPrimary,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmtMoney(item.price)}
                    </Text>
                    {!item.isAvailable ? (
                      <Tag color="red" style={{ margin: 0 }}>
                        86&apos;d
                      </Tag>
                    ) : (item.modifiers?.length ?? 0) > 0 ? (
                      <Tag style={{ margin: 0 }}>options</Tag>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default memo(MenuPanel);
