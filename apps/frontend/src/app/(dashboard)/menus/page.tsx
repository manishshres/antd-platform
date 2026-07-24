"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Typography,
  Alert,
  Tag,
  Row,
  Col,
  Empty,
  App,
  Switch,
  Select,
  theme,
  Badge,
  Popconfirm,
  Tooltip,
  Spin,
} from "antd";
import { useLocation } from "@/contexts/LocationContext";
import PageHeader from "@/components/PageHeader";
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  UndoOutlined,
  StarFilled,
  StarOutlined,
  MinusCircleOutlined,
  EditOutlined,
  SyncOutlined,
  SearchOutlined,
  AppstoreOutlined,
  FolderOutlined,
  EllipsisOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@/lib/api";
import { getAccessToken, onTokenChange } from "@/lib/token-store";
import { decodeJwtPayload } from "@/lib/jwt";

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  isRequired: boolean;
  multiSelect?: boolean;
  maxSelections?: number | null;
  options: ModifierOption[];
}

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  isAvailable: boolean;
  isFavorite?: boolean;
  imageUrl?: string;
  sortOrder: number;
  deletedAt?: string | null;
  modifiers?: ModifierGroup[];
  availabilitySchedule?: unknown;
}

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isAvailable: boolean;
  deletedAt?: string | null;
  items?: MenuItem[];
  modifiers?: ModifierGroup[];
}

interface SortableMenuItemProps {
  item: MenuItem;
  isAdmin: boolean;
  onEdit: (item: MenuItem) => void;
  onDelete: (id: string, name: string) => void;
  onRestore: (id: string) => void;
  onToggleAvailability: (item: MenuItem) => void;
  onToggleFavorite: (item: MenuItem) => void;
}

function SortableMenuItem({ item, isAdmin, onEdit, onDelete, onRestore, onToggleAvailability, onToggleFavorite }: SortableMenuItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const { token } = theme.useToken();

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : item.deletedAt ? 0.65 : 1,
    zIndex: isDragging ? 999 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div style={{
        background: token.colorBgContainer,
        border: `1px solid ${item.deletedAt ? token.colorError + '44' : token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: '14px 16px',
        marginBottom: 10,
        cursor: 'grab',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {item.deletedAt && <Tag color="error" style={{ marginBottom: 0 }}>Deleted</Tag>}
            <Text strong style={{ fontSize: 14 }}>{item.name}</Text>
          </div>
          <Paragraph ellipsis={{ rows: 2 }} type="secondary" style={{ fontSize: 12, marginBottom: 6 }}>
            {item.description || 'No description.'}
          </Paragraph>
          {item.modifiers && item.modifiers.length > 0 && (
            <Space wrap size={4}>
              {item.modifiers.map(m => (
                <Tag key={m.id} color="purple" style={{ fontSize: 11, marginBottom: 0 }}>{m.name}</Tag>
              ))}
            </Space>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: 700, color: token.colorPrimary }}>
            ${(item.price / 100).toFixed(2)}
          </Text>
          {isAdmin && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Tooltip title={item.isFavorite ? 'Remove from POS favorites' : 'Pin to POS favorites'}>
                <Button
                  size="small"
                  type="text"
                  aria-label={item.isFavorite ? `Unpin ${item.name} from favorites` : `Pin ${item.name} to favorites`}
                  icon={item.isFavorite ? <StarFilled style={{ color: token.colorWarning }} /> : <StarOutlined />}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(item); }}
                />
              </Tooltip>
              <Tooltip title={item.isAvailable ? 'Mark unavailable' : 'Mark available'}>
                <Switch size="small" checked={item.isAvailable} onChange={() => onToggleAvailability(item)} onClick={(_, e) => e.stopPropagation()} />
              </Tooltip>
              {item.deletedAt ? (
                <Tooltip title="Restore"><Button size="small" type="text" icon={<UndoOutlined />} aria-label="Restore item" onClick={(e) => { e.stopPropagation(); onRestore(item.id); }} /></Tooltip>
              ) : (
                <>
                  <Tooltip title="Edit"><Button size="small" type="text" icon={<EditOutlined />} aria-label="Edit item" onClick={(e) => { e.stopPropagation(); onEdit(item); }} /></Tooltip>
                  <Tooltip title="Delete"><Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Delete item" onClick={(e) => { e.stopPropagation(); onDelete(item.id, item.name); }} /></Tooltip>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MenuEditorPage() {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const [categories, setCategories] = useState<Category[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'menu' | 'modifiers'>('menu');

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [aiSyncLoading, setAiSyncLoading] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [modifierModalOpen, setModifierModalOpen] = useState(false);

  const { selectedLocationId, selectedLocation, refreshLocations } = useLocation();

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editCatModalOpen, setEditCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);

  const [catForm] = Form.useForm();
  const [editCatForm] = Form.useForm();
  const [itemForm] = Form.useForm();
  const [modifierForm] = Form.useForm();

  const [isAdmin, setIsAdmin] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(() => {
    if (!selectedLocationId) {
      setCategories([]); setModifierGroups([]); setLoading(false); return;
    }
    setLoading(true); setError(null);
    Promise.all([
      api.get<{ data: Category[] }>(`/menus?showDeleted=${showDeleted}&locationId=${selectedLocationId}`),
      api.get<ModifierGroup[]>(`/menus/modifiers/groups?locationId=${selectedLocationId}`),
    ])
      .then(([menusRes, modsRes]) => {
        const cats = Array.isArray(menusRes.data.data) ? menusRes.data.data : [];
        setCategories(cats);
        setModifierGroups(Array.isArray(modsRes.data) ? modsRes.data : []);
        setSelectedCatId(prev => {
          if (!prev && cats.length > 0) return cats[0].id;
          if (prev && cats.find(c => c.id === prev)) return prev;
          return cats[0]?.id ?? null;
        });
      })
      .catch(() => setError("Failed to load menu data."))
      .finally(() => setLoading(false));
  }, [selectedLocationId, showDeleted]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const applyRole = () => {
      const tk = getAccessToken();
      if (!tk) { setIsAdmin(false); setIsPlatformAdmin(false); return; }
      const payload = decodeJwtPayload<{ role?: string }>(tk);
      setIsAdmin(!!payload?.role && ["sysadmin", "admin", "manager", "platform_admin"].includes(payload.role));
      setIsPlatformAdmin(payload?.role === "platform_admin");
    };
    applyRole();
    const unsub = onTokenChange(applyRole);
    return unsub;
  }, []);

  const handleImportMenu = async (mode: string = 'sync') => {
    try {
      setImportLoading(true);
      const res = await api.post("/menus/import", { locationId: selectedLocationId, importMode: mode });
      message.success(res.data.message || "Menu sync started in the background.");
    } catch (e: any) {
      message.error(e.response?.data?.message || "Failed to start menu sync.");
    } finally { setImportLoading(false); }
  };

  // Push the current menu to the Telnyx AI knowledge base so the voice agent answers with the
  // latest items/prices. This is a manual publish — menu edits don't auto-sync to the agent.
  const handleSyncToAI = async () => {
    try {
      setAiSyncLoading(true);
      const res = await api.post<{ message?: string }>(
        `/menus/sync-ai${selectedLocationId ? `?locationId=${selectedLocationId}` : ""}`,
      );
      message.success(res.data?.message || "Menu published to the AI voice agent.");
      // Refresh so the "last synced" hint reflects the new timestamp.
      await refreshLocations();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(msg || "Failed to publish menu to the AI agent.");
    } finally { setAiSyncLoading(false); }
  };

  const handleAddCategory = async (values: any) => {
    try {
      const { data } = await api.post("/menus/categories", { name: values.name, locationId: selectedLocationId });
      if (values.modifierIds?.length > 0) {
        for (const modId of values.modifierIds) {
          await api.post(`/menus/categories/${data.id}/modifiers`, { modifierId: modId }).catch(console.error);
        }
      }
      message.success("Category created."); setCatModalOpen(false); catForm.resetFields(); load();
    } catch { message.error("Failed to create category."); }
  };

  const handleUpdateCategory = async (values: any) => {
    try {
      if (!editingCat) return;
      await api.patch(`/menus/categories/${editingCat.id}`, { name: values.name, isAvailable: values.isAvailable });
      
      // For simplicity, we can try to just re-add the selected ones (the backend uses onConflictDoNothing)
      // but we should ideally remove the ones not selected. For now, since there is no bulk edit, we will loop and remove unselected ones.
      const currentModIds = editingCat.modifiers?.map(m => m.id) || [];
      const newModIds = values.modifierIds || [];
      
      const toRemove = currentModIds.filter(id => !newModIds.includes(id));
      const toAdd = newModIds.filter((id: string) => !currentModIds.includes(id));
      
      for (const modId of toRemove) {
        await api.delete(`/menus/categories/${editingCat.id}/modifiers/${modId}`).catch(console.error);
      }
      for (const modId of toAdd) {
        await api.post(`/menus/categories/${editingCat.id}/modifiers`, { modifierId: modId }).catch(console.error);
      }

      message.success("Category updated."); setEditCatModalOpen(false); load();
    } catch { message.error("Failed to update category."); }
  };

  const handleRestoreCategory = async (catId: string) => {
    try {
      await api.post(`/menus/categories/${catId}/restore`);
      message.success("Category restored."); load();
    } catch { message.error("Failed to restore category."); }
  };

  const handleDeleteCategory = (catId: string, name: string) => {
    modal.confirm({
      title: `Delete Category "${name}"?`, content: "This soft-deletes the category.",
      okText: "Delete", okType: "danger",
      onOk: async () => {
        try {
          await api.delete(`/menus/categories/${catId}`);
          message.success("Category deleted.");
          if (selectedCatId === catId) setSelectedCatId(categories.find(c => c.id !== catId)?.id ?? null);
          load();
        } catch { message.error("Failed to delete category."); }
      },
    });
  };

  const handleSaveItem = async (values: any) => {
    try {
      const priceInCents = Math.round(Number(values.price) * 100);
      const basePayload = { categoryId: selectedCatId, name: String(values.name), description: String(values.description || ""), price: priceInCents, imageUrl: values.imageUrl, isAvailable: values.isAvailable };
      let savedItem;
      if (editingItem) {
        const { data } = await api.patch(`/menus/items/${editingItem.id}`, basePayload); savedItem = data; message.success("Item updated.");
      } else {
        const { data } = await api.post("/menus/items", { ...basePayload, locationId: selectedLocationId }); savedItem = data; message.success("Item created.");
      }
      const currentModIds = editingItem?.modifiers?.map(m => m.id) || [];
      const newModIds = values.modifierIds || [];
      const toAdd = newModIds.filter((id: string) => !currentModIds.includes(id));
      const toRemove = currentModIds.filter((id: string) => !newModIds.includes(id));
      for (const modId of toAdd) await api.post(`/menus/items/${savedItem.id}/modifiers`, { modifierId: modId }).catch(console.error);
      for (const modId of toRemove) await api.delete(`/menus/items/${savedItem.id}/modifiers/${modId}`).catch(console.error);
      itemForm.resetFields(); setItemModalOpen(false); setEditingItem(null); load();
    } catch { message.error("Failed to save menu item."); }
  };

  const handleDeleteItem = (itemId: string, name: string) => {
    modal.confirm({
      title: `Delete "${name}"?`, content: "This soft-deletes the item.", okText: "Delete", okType: "danger",
      onOk: async () => { try { await api.delete(`/menus/items/${itemId}`); message.success("Item deleted."); load(); } catch { message.error("Failed to delete item."); } },
    });
  };

  const handleRestoreItem = async (itemId: string) => {
    try { await api.post(`/menus/items/${itemId}/restore`); message.success("Item restored."); load(); } catch { message.error("Failed to restore item."); }
  };

  const handleToggleAvailability = async (item: MenuItem) => {
    try { await api.patch(`/menus/items/${item.id}`, { isAvailable: !item.isAvailable }); load(); } catch { message.error("Failed to update availability."); }
  };

  const handleToggleFavorite = async (item: MenuItem) => {
    try { await api.patch(`/menus/items/${item.id}`, { isFavorite: !item.isFavorite }); load(); } catch { message.error("Failed to update favorite."); }
  };

  const openEditModal = (item: MenuItem) => {
    setSelectedCatId(item.categoryId); setEditingItem(item);
    itemForm.setFieldsValue({ name: item.name, description: item.description, price: item.price / 100, imageUrl: item.imageUrl, isAvailable: item.isAvailable, modifierIds: item.modifiers?.map(m => m.id) || [] });
    setItemModalOpen(true);
  };

  const handleDragEnd = async (event: DragEndEvent, items: MenuItem[], categoryId: string) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(i => i.id === active.id);
      const newIndex = items.findIndex(i => i.id === over.id);
      const newItems = arrayMove(items, oldIndex, newIndex);
      setCategories(cats => cats.map(c => c.id === categoryId ? { ...c, items: newItems } : c));
      try { await api.patch("/menus/reorder/items", { items: newItems.map((item, index) => ({ id: item.id, sortOrder: index })) }); }
      catch { message.error("Failed to reorder items."); load(); }
    }
  };

  const selectedCat = categories.find(c => c.id === selectedCatId) ?? null;
  const selectedItems = (selectedCat?.items ?? [])
    .filter(i => showDeleted ? true : !i.deletedAt)
    .filter(i => !searchQuery || i.name.toLowerCase().includes(searchQuery.toLowerCase()) || (i.description || '').toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const totalItems = categories.reduce((sum, c) => sum + (c.items?.filter(i => !i.deletedAt).length ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Menu Management"
        subtitle="Build and manage your restaurant menu card with add-ons and modifiers."
        actions={
          <>
            <Space.Compact>
              <Button type={activeView === 'menu' ? 'primary' : 'default'} icon={<AppstoreOutlined />} onClick={() => setActiveView('menu')}>Menu</Button>
              <Button type={activeView === 'modifiers' ? 'primary' : 'default'} icon={<EllipsisOutlined />} onClick={() => setActiveView('modifiers')}>Modifiers</Button>
            </Space.Compact>
            {isAdmin && (
              <Button icon={<SyncOutlined />} type="primary" onClick={() => handleImportMenu('sync')} loading={importLoading}>
                Sync Menu
              </Button>
            )}
            {isAdmin && (
              <Tooltip
                title={
                  <>
                    Publish the current menu to the AI voice agent&apos;s knowledge base so callers
                    get the latest items and prices.
                    <br />
                    {selectedLocation?.menuLastSyncedAt
                      ? `Last published: ${new Date(selectedLocation.menuLastSyncedAt).toLocaleString()}`
                      : "Not published to the AI agent yet."}
                  </>
                }
              >
                <Button
                  icon={<RobotOutlined />}
                  onClick={handleSyncToAI}
                  loading={aiSyncLoading}
                  disabled={!selectedLocationId}
                >
                  Push to AI Agent
                </Button>
              </Tooltip>
            )}
          </>
        }
      />

      {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} />}

      {!selectedLocationId && !loading ? (
        <Alert type="info" title="Please select a location to view its menu." showIcon style={{ marginBottom: 24 }} />
      ) : activeView === 'menu' ? (
        /* Split Panel */
        <div style={{
          display: 'flex', height: 'calc(100vh - 210px)', minHeight: 500,
          border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG,
          overflow: 'hidden', background: token.colorBgContainer,
        }}>
          {/* Sidebar */}
          <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgLayout, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong style={{ fontSize: 13 }}>Categories</Text>
              {isAdmin && <Tooltip title="Add Category"><Button size="small" type="text" icon={<PlusOutlined />} aria-label="Add category" onClick={() => setCatModalOpen(true)} /></Tooltip>}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
              ) : categories.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center' }}><Text type="secondary" style={{ fontSize: 12 }}>No categories yet.</Text></div>
              ) : (
                categories.filter(c => showDeleted ? true : !c.deletedAt).map(cat => {
                  const count = (cat.items || []).filter(i => !i.deletedAt).length;
                  const isActive = cat.id === selectedCatId;
                  return (
                    <div key={cat.id} onClick={() => setSelectedCatId(cat.id)} style={{
                      padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                      background: isActive ? token.colorPrimaryBg : 'transparent',
                      borderRight: isActive ? `3px solid ${token.colorPrimary}` : '3px solid transparent',
                    }}>
                      <FolderOutlined style={{ color: isActive ? token.colorPrimary : token.colorTextTertiary, fontSize: 14 }} />
                      <Text style={{ flex: 1, fontSize: 13, fontWeight: isActive ? 600 : 400, color: cat.deletedAt ? token.colorTextDisabled : isActive ? token.colorPrimary : token.colorText, textDecoration: cat.deletedAt ? 'line-through' : 'none' }}>
                        {cat.name}
                      </Text>
                      <Badge count={count} style={{ backgroundColor: isActive ? token.colorPrimary : token.colorTextTertiary }} />
                      {isAdmin && (
                        <Button size="small" type="text" icon={<EllipsisOutlined />} aria-label="Category options" onClick={(e) => {
                          e.stopPropagation(); setEditingCat(cat);
                          editCatForm.setFieldsValue({ name: cat.name, isAvailable: cat.isAvailable, modifierIds: cat.modifiers?.map(m => m.id) || [] });
                          setEditCatModalOpen(true);
                        }} style={{ opacity: 0.6 }} />
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
              <Text type="secondary" style={{ fontSize: 11 }}>{totalItems} items · {categories.length} categories</Text>
              {isPlatformAdmin && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <Switch size="small" checked={showDeleted} onChange={setShowDeleted} />
                  <Text type="secondary" style={{ fontSize: 11 }}>Show deleted</Text>
                </div>
              )}
            </div>
          </div>

          {/* Item Panel */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${token.colorBorderSecondary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                {selectedCat && <Title level={5} style={{ margin: 0, fontWeight: 700 }}>{selectedCat.name}</Title>}
                <Input prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />} placeholder="Search items…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ maxWidth: 220, fontSize: 13 }} allowClear />
              </div>
              <Space>
                {isAdmin && selectedCat && !selectedCat.deletedAt && (
                  <>
                    <Button icon={<PlusOutlined />} type="primary" onClick={() => { setEditingItem(null); itemForm.resetFields(); itemForm.setFieldsValue({ isAvailable: true }); setItemModalOpen(true); }}>Add Item</Button>
                    <Tooltip title="Edit category"><Button icon={<EditOutlined />} aria-label="Edit category" onClick={() => { setEditingCat(selectedCat); editCatForm.setFieldsValue({ name: selectedCat.name, isAvailable: selectedCat.isAvailable, modifierIds: selectedCat.modifiers?.map(m => m.id) || [] }); setEditCatModalOpen(true); }} /></Tooltip>
                    <Tooltip title="Delete category"><Button danger icon={<DeleteOutlined />} aria-label="Delete category" onClick={() => handleDeleteCategory(selectedCat.id, selectedCat.name)} /></Tooltip>
                  </>
                )}
                {selectedCat?.deletedAt && <Button icon={<UndoOutlined />} onClick={() => handleRestoreCategory(selectedCat.id)}>Restore Category</Button>}
                <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} aria-label="Refresh menu" onClick={load} loading={loading} /></Tooltip>
              </Space>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {!selectedCat ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240 }}>
                  <AppstoreOutlined style={{ fontSize: 40, color: token.colorTextTertiary, marginBottom: 12 }} />
                  <Text type="secondary">Select a category from the sidebar</Text>
                </div>
              ) : selectedItems.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240 }}>
                  <Empty description={searchQuery ? 'No items match your search.' : `No items in "${selectedCat.name}" yet.`}>
                    {!searchQuery && isAdmin && !selectedCat.deletedAt && (
                      <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingItem(null); itemForm.resetFields(); itemForm.setFieldsValue({ isAvailable: true }); setItemModalOpen(true); }}>Add First Item</Button>
                    )}
                  </Empty>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(e, selectedItems, selectedCat.id)}>
                  <SortableContext items={selectedItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {selectedItems.map(item => (
                      <SortableMenuItem key={item.id} item={item} isAdmin={isAdmin} onEdit={openEditModal} onDelete={handleDeleteItem} onRestore={handleRestoreItem} onToggleAvailability={handleToggleAvailability} onToggleFavorite={handleToggleFavorite} />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Modifiers View */
        <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, padding: 20, background: token.colorBgContainer }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
            {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { modifierForm.resetFields(); setModifierModalOpen(true); }}>Create Modifier Group</Button>}
          </div>
          {modifierGroups.length === 0 ? (<Empty description="No modifier groups created." />) : (
            <Row gutter={[16, 16]}>
              {modifierGroups.map(mg => (
                <Col xs={24} md={12} lg={8} key={mg.id}>
                  <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text strong>{mg.name}</Text>
                      <Space>
                        <Tag color={mg.isRequired ? 'red' : 'blue'}>{mg.isRequired ? 'Required' : 'Optional'}</Tag>
                        {mg.multiSelect && (
                          <Tag color="purple">{mg.maxSelections != null ? `Multi (max ${mg.maxSelections})` : 'Multi'}</Tag>
                        )}
                        {isAdmin && (
                          <Popconfirm title="Delete this modifier group?" onConfirm={async () => { await api.delete(`/menus/modifiers/groups/${mg.id}`); load(); }} okText="Delete" okType="danger">
                            <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Delete modifier group" />
                          </Popconfirm>
                        )}
                      </Space>
                    </div>
                    <ul style={{ paddingLeft: 16, margin: 0 }}>
                      {mg.options.map(opt => (
                        <li key={opt.id} style={{ fontSize: 13, marginBottom: 4 }}>
                          {opt.name}
                          {opt.priceAdjustment > 0 && <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>+${(opt.priceAdjustment / 100).toFixed(2)}</Text>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Col>
              ))}
            </Row>
          )}
        </div>
      )}

      {/* Add Category Modal */}
      <Modal title="Add New Category" open={catModalOpen} onCancel={() => setCatModalOpen(false)} footer={null} forceRender>
        <Form form={catForm} layout="vertical" onFinish={handleAddCategory}>
          <Form.Item name="name" label="Category Name" rules={[{ required: true }]}><Input placeholder="e.g. Appetizers, Pizzas" /></Form.Item>
          <Form.Item name="modifierIds" label="Assign Default Modifier Groups">
            <Select mode="multiple" placeholder="Select modifiers">
              {modifierGroups.map(mg => <Option key={mg.id} value={mg.id}>{mg.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item style={{ textAlign: "right", marginBottom: 0 }}>
            <Space><Button onClick={() => setCatModalOpen(false)}>Cancel</Button><Button type="primary" htmlType="submit">Create</Button></Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Category Modal */}
      <Modal title="Edit Category" open={editCatModalOpen} onCancel={() => setEditCatModalOpen(false)} footer={null} forceRender>
        <Form form={editCatForm} layout="vertical" onFinish={handleUpdateCategory} initialValues={{ isAvailable: true }}>
          <Form.Item name="name" label="Category Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="modifierIds" label="Assign Default Modifier Groups">
            <Select mode="multiple" placeholder="Select modifiers">
              {modifierGroups.map(mg => <Option key={mg.id} value={mg.id}>{mg.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="isAvailable" label="Available for ordering" valuePropName="checked"><Switch /></Form.Item>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {editingCat && !editingCat.deletedAt && isAdmin && (
              <Button danger icon={<DeleteOutlined />} onClick={() => { setEditCatModalOpen(false); handleDeleteCategory(editingCat.id, editingCat.name); }}>Delete Category</Button>
            )}
            {editingCat?.deletedAt && <Button icon={<UndoOutlined />} onClick={() => { setEditCatModalOpen(false); handleRestoreCategory(editingCat.id); }}>Restore</Button>}
            <Button type="primary" htmlType="submit">Save Changes</Button>
          </div>
        </Form>
      </Modal>

      {/* Add Modifier Modal */}
      <Modal title="Add Modifier Group" open={modifierModalOpen} onCancel={() => setModifierModalOpen(false)} footer={null} forceRender>
        <Form form={modifierForm} layout="vertical" onFinish={async (values) => {
          try {
            const { data } = await api.post("/menus/modifiers/groups", { name: values.name, isRequired: values.isRequired, multiSelect: values.multiSelect || false, maxSelections: values.multiSelect ? values.maxSelections ?? undefined : undefined, locationId: selectedLocationId });
            if (values.options?.length > 0) {
              for (const opt of values.options) await api.post(`/menus/modifiers/${data.id}/options`, { name: opt.name, priceAdjustment: opt.priceAdjustment || 0 });
            }
            message.success("Modifier created."); setModifierModalOpen(false); load();
          } catch { message.error("Error creating modifier"); }
        }}>
          <Form.Item name="name" label="Group Name" rules={[{ required: true }]}><Input placeholder="e.g. Size, Crust Type" /></Form.Item>
          <Form.Item name="isRequired" label="Is Required?" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="multiSelect" label="Allow multiple selections? (e.g. Toppings)" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.multiSelect !== cur.multiSelect}>
            {({ getFieldValue }) =>
              getFieldValue("multiSelect") ? (
                <Form.Item name="maxSelections" label="Max selections (blank = unlimited)">
                  <InputNumber min={1} max={20} placeholder="e.g. 3" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Typography.Title level={5}>Options</Typography.Title>
          <Form.List name="options" initialValue={[{ name: "", priceAdjustment: 0 }]}>
            {(fields, { add, remove }) => (<>
              {fields.map(({ key, name, ...restField }) => (
                <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                  <Form.Item {...restField} name={[name, 'name']} rules={[{ required: true, message: 'Missing name' }]}><Input placeholder="Option Name" /></Form.Item>
                  <Form.Item {...restField} name={[name, 'priceAdjustment']}><InputNumber placeholder="Price (+)" min={0} formatter={(value: any) => `$${((value || 0) / 100).toFixed(2)}`} parser={(value: string | undefined) => Math.round(parseFloat(value!.replace(/\$\s?|(,*)/g, '')) * 100) as any} /></Form.Item>
                  <MinusCircleOutlined onClick={() => remove(name)} />
                </Space>
              ))}
              <Form.Item><Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>Add Option</Button></Form.Item>
            </>)}
          </Form.List>
          <Form.Item style={{ textAlign: "right" }}><Button type="primary" htmlType="submit">Create Group</Button></Form.Item>
        </Form>
      </Modal>

      {/* Item Modal */}
      <Modal title={editingItem ? "Edit Item" : "Add New Item"} open={itemModalOpen} onCancel={() => setItemModalOpen(false)} footer={null} forceRender width={600}>
        <Form form={itemForm} layout="vertical" onFinish={handleSaveItem} initialValues={{ isAvailable: true }}>
          <Row gutter={16}>
            <Col span={16}><Form.Item name="name" label="Item Name" rules={[{ required: true }]}><Input placeholder="e.g. Pepperoni Pizza" /></Form.Item></Col>
            <Col span={8}><Form.Item name="price" label="Price ($)" rules={[{ required: true }]}><InputNumber style={{ width: "100%" }} precision={2} /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="imageUrl" label="Image URL"><Input placeholder="Paste URL" /></Form.Item>
          <Form.Item name="modifierIds" label="Assign Modifier Groups">
            <Select mode="multiple" placeholder="Select modifiers">
              {modifierGroups.map(mg => <Option key={mg.id} value={mg.id}>{mg.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="isAvailable" label="Available for ordering" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item style={{ textAlign: "right" }}>
            <Space>
              <Button onClick={() => setItemModalOpen(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">{editingItem ? "Update" : "Create"}</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
