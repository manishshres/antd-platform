import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { IconButton, Snackbar, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { useCart } from '../state/CartContext';
import { useEmployee } from '../state/EmployeeContext';
import * as catalogRepo from '../db/catalogRepo';
import { ProductCard } from '../components/ProductCard';
import { ItemCustomizeDialog } from '../components/ItemCustomizeDialog';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { MenuManagementModal } from '../components/MenuManagementModal';
import type { Category, Product } from '../types';

type ViewMode = 'tabs' | 'sidebar';

interface Props {
  search: string;
}

/** Roughly the narrowest a card can get before a two-line product name starts
 *  truncating mid-word. Columns are derived from this, not hard-coded. */
const TARGET_CARD_WIDTH = 160;

/** Product catalog: category selector (tab rail or vertical sidebar) + product grid. */
export function HomeScreen({ search }: Props) {
  const { dataVersion, settings, syncNow } = useApp();
  const cart = useCart();
  // Editing the menu is back-of-house — it doesn't belong in the cashier's
  // category strip alongside barcode scan.
  const { isManager } = useEmployee();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('tabs');
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [managingMenu, setManagingMenu] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);

  // A fixed column count can't serve both layouts: the vertical category rail
  // costs 168pt, so the same "4 columns" is roomy in one mode and cramped in the
  // other — and wrong again on a different tablet. Measure and divide instead.
  const numColumns = useMemo(() => {
    if (gridWidth <= 0) return 4;
    return Math.min(6, Math.max(2, Math.floor(gridWidth / TARGET_CARD_WIDTH)));
  }, [gridWidth]);

  useEffect(() => {
    const cats = catalogRepo.getCategories();
    setCategories(cats);
    setActiveCategory((prev) =>
      prev && cats.some((c) => c.id === prev) ? prev : null,
    );
  }, [dataVersion]);

  useEffect(() => {
    setProducts(
      catalogRepo.getProducts(
        search.trim() ? undefined : (activeCategory ?? undefined),
        search,
      ),
    );
  }, [activeCategory, search, dataVersion]);

  const cartQty = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart.lines) map.set(line.product.id, line.quantity);
    return map;
  }, [cart.lines]);

  const handleCustomizeProduct = (item: Product) => setPendingProduct(item);
  const handleQuickAdd = (item: Product) =>
    cart.addProductWithOptions(item, 1, undefined, cart.activeCourse);

  const handleScan = (code: string) => {
    const match = catalogRepo.findProductBySku(code);
    if (match) {
      cart.addProductWithOptions(match, 1);
      setScanMessage(`Added ${match.name}`);
    } else {
      setScanMessage(`No product found for "${code}"`);
    }
  };

  const productGrid = (
    <>
      {products.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons
            name="food-off-outline"
            size={48}
            color={antd.textQuaternary}
          />
          <Text variant="bodyMedium" style={styles.emptyText}>
            {categories.length === 0
              ? 'No catalog yet — connect and sync from Settings.'
              : 'No products match.'}
          </Text>
        </View>
      ) : (
        <FlashList
          data={products}
          numColumns={numColumns}
          estimatedItemSize={140}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <View style={styles.gridCell}>
              <ProductCard
                product={item}
                quantityInCart={cartQty.get(item.id) ?? 0}
                onQuickAdd={() => handleQuickAdd(item)}
                onCustomize={() => handleCustomizeProduct(item)}
              />
            </View>
          )}
        />
      )}
    </>
  );

  if (viewMode === 'sidebar') {
    return (
      <View style={styles.containerRow}>
        {/* Vertical category sidebar */}
        <View style={styles.sidebar}>
          <View style={styles.sidebarHeader}>
            <Text variant="labelSmall" style={styles.sidebarHeaderText}>
              CATEGORIES
            </Text>
            <View style={styles.headerBtnRow}>
              <IconButton
                icon="barcode-scan"
                size={20}
                iconColor={antd.textSecondary}
                style={styles.toggleBtn}
                onPress={() => setScannerVisible(true)}
              />
              <IconButton
                icon="view-list-outline"
                size={20}
                iconColor={antd.primary}
                style={styles.toggleBtn}
                onPress={() => setViewMode('tabs')}
              />
              {isManager && (
                <IconButton
                  icon="silverware-fork-knife"
                  size={20}
                  iconColor={antd.textSecondary}
                  style={styles.toggleBtn}
                  onPress={() => setManagingMenu(true)}
                />
              )}
            </View>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sidebarScroll}
          >
            <SidebarItem
              label="All"
              active={activeCategory === null}
              onPress={() => setActiveCategory(null)}
            />
            {categories.map((cat) => (
              <SidebarItem
                key={cat.id}
                label={cat.name}
                active={activeCategory === cat.id}
                onPress={() => setActiveCategory(cat.id)}
              />
            ))}
          </ScrollView>
        </View>

        {/* Product grid */}
        <View
          style={styles.gridArea}
          onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
        >
          {productGrid}
        </View>

        <ItemCustomizeDialog
          visible={pendingProduct !== null}
          product={pendingProduct}
          showCourses={cart.fireMode === 'by_course'}
          initialCourse={cart.activeCourse}
          onDismiss={() => setPendingProduct(null)}
          onConfirm={(product, quantity, notes, course, selectedModifiers) =>
            cart.addProductWithOptions(
              product,
              quantity,
              notes || undefined,
              course ?? cart.activeCourse,
              selectedModifiers,
            )
          }
        />
        <BarcodeScannerModal
          visible={scannerVisible}
          onDismiss={() => setScannerVisible(false)}
          onScan={handleScan}
        />
        <Snackbar
          visible={scanMessage.length > 0}
          onDismiss={() => setScanMessage('')}
          duration={2200}
        >
          {scanMessage}
        </Snackbar>
        <MenuManagementModal
          visible={managingMenu}
          onDismiss={() => setManagingMenu(false)}
          settings={settings}
          onMutated={syncNow}
        />
      </View>
    );
  }

  // Horizontal tabs mode (default)
  return (
    <View style={styles.container}>
      <View style={styles.tabsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabsContent}
          nestedScrollEnabled
        >
          <CategoryTab
            label="All"
            active={activeCategory === null}
            onPress={() => setActiveCategory(null)}
          />
          {categories.map((cat) => (
            <CategoryTab
              key={cat.id}
              label={cat.name}
              active={activeCategory === cat.id}
              onPress={() => setActiveCategory(cat.id)}
            />
          ))}
        </ScrollView>
        <IconButton
          icon="barcode-scan"
          size={20}
          iconColor={antd.textSecondary}
          style={styles.toggleBtn}
          onPress={() => setScannerVisible(true)}
        />
        <IconButton
          icon="view-list-outline"
          size={20}
          iconColor={antd.textSecondary}
          style={styles.toggleBtn}
          onPress={() => setViewMode('sidebar')}
        />
        {isManager && (
          <IconButton
            icon="silverware-fork-knife"
            size={20}
            iconColor={antd.textSecondary}
            style={styles.toggleBtn}
            onPress={() => setManagingMenu(true)}
          />
        )}
      </View>

      <View
        style={styles.gridWrapper}
        onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
      >
        {productGrid}
      </View>

      <ItemCustomizeDialog
        visible={pendingProduct !== null}
        product={pendingProduct}
        showCourses={cart.fireMode === 'by_course'}
        initialCourse={cart.activeCourse}
        onDismiss={() => setPendingProduct(null)}
        onConfirm={(product, quantity, notes, course, selectedModifiers) =>
          cart.addProductWithOptions(
            product,
            quantity,
            notes || undefined,
            course ?? cart.activeCourse,
            selectedModifiers,
          )
        }
      />
      <BarcodeScannerModal
        visible={scannerVisible}
        onDismiss={() => setScannerVisible(false)}
        onScan={handleScan}
      />
      <Snackbar
        visible={scanMessage.length > 0}
        onDismiss={() => setScanMessage('')}
        duration={2200}
      >
        {scanMessage}
      </Snackbar>
      <MenuManagementModal
        visible={managingMenu}
        onDismiss={() => setManagingMenu(false)}
        settings={settings}
        onMutated={syncNow}
      />
    </View>
  );
}

function CategoryTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
      activeOpacity={0.75}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SidebarItem({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.sidebarItem, active && styles.sidebarItemActive]}
      activeOpacity={0.75}
    >
      <Text style={[styles.sidebarItemText, active && styles.sidebarItemTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Tabs mode
  container: { flex: 1, backgroundColor: antd.bgLayout },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: antd.bgContainer,
    borderBottomWidth: 1,
    borderBottomColor: antd.split,
    paddingRight: 4,
    height: 56,
  },
  tabsScroll: { flex: 1 },
  tabsContent: {
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
    height: 56,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgLayout,
  },
  tabActive: {
    backgroundColor: antd.primary,
    borderColor: antd.primary,
  },
  tabText: { color: antd.textSecondary, fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: '#fff' },
  gridWrapper: { flex: 1, paddingTop: 4 },
  grid: { paddingHorizontal: 10, paddingTop: 12, paddingBottom: 16 },
  gridCell: { width: '100%', paddingHorizontal: 6, paddingBottom: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyText: { color: antd.textTertiary },

  // Sidebar mode
  containerRow: { flex: 1, flexDirection: 'row', backgroundColor: antd.bgLayout },
  sidebar: {
    width: 168,
    backgroundColor: antd.bgContainer,
    borderRightWidth: 1,
    borderRightColor: antd.split,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 2,
    paddingTop: 10,
    paddingBottom: 4,
  },
  sidebarHeaderText: { color: antd.textTertiary, letterSpacing: 0.5 },
  headerBtnRow: { flexDirection: 'row' },
  sidebarScroll: { paddingHorizontal: 8, paddingBottom: 16 },
  sidebarItem: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: RADIUS,
    marginBottom: 2,
  },
  sidebarItemActive: {
    backgroundColor: antd.primaryBg,
    borderLeftWidth: 3,
    borderLeftColor: antd.primary,
    paddingLeft: 7,
  },
  sidebarItemText: { color: antd.textSecondary, fontSize: 13, fontWeight: '500' },
  sidebarItemTextActive: { color: antd.primary, fontWeight: '600' },
  gridArea: { flex: 1 },

  // Shared
  // 44pt containers — these sit in a strip the cashier hits mid-service.
  toggleBtn: { margin: 0, width: 44, height: 44 },
});
