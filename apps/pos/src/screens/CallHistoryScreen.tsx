import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Chip,
  Divider,
  IconButton,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { antd, RADIUS } from '../theme';
import { useApp } from '../state/AppContext';
import { ApiClient, ApiNetworkError, ApiRequestError, type CallRecordPayload } from '../api/client';
import { fmtDate } from '../utils/dates';

/** Cents-free duration formatter: 125_000ms -> "2m 5s". */
function fmtDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: '#52c41a',
  neutral: '#8c8c8c',
  negative: '#ff4d4f',
};

/**
 * Voice-AI call log for the current location — recordings, transcripts, and
 * AI summaries. Requires connectivity; calls aren't cached offline since staff
 * only need to look them up, not place orders against them.
 */
export function CallHistoryScreen() {
  const { settings, online } = useApp();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallRecordPayload[]>([]);
  const [selected, setSelected] = useState<CallRecordPayload | null>(null);

  const load = useCallback(async () => {
    if (!settings.apiUrl || !settings.apiKey || !settings.locationId) {
      setError('Configure API URL, API key, and location in Settings.');
      return;
    }
    if (!online) {
      setError('Call history requires a network connection.');
      return;
    }
    setLoading(true);
    setError(null);
    const client = new ApiClient(settings.apiUrl, settings.apiKey);
    try {
      const res = await client.getCalls({
        locationId: settings.locationId,
        search: search || undefined,
        limit: 100,
      });
      setCalls(res.data);
      setSelected((prev) => (prev ? res.data.find((c) => c.id === prev.id) ?? null : null));
    } catch (err) {
      if (err instanceof ApiNetworkError) {
        setError('Network error — check your connection and try again.');
      } else if (err instanceof ApiRequestError) {
        setError(`Server error ${err.status}: ${err.message}`);
      } else {
        setError('Unexpected error loading calls.');
      }
    } finally {
      setLoading(false);
    }
  }, [settings, online, search]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.apiUrl, settings.apiKey, settings.locationId, online]);

  return (
    <View style={styles.container}>
      <View style={styles.list}>
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.title}>
            Call History
          </Text>
          <IconButton icon="refresh" size={20} onPress={() => void load()} disabled={loading} />
        </View>
        <TextInput
          mode="outlined"
          placeholder="Search transcripts…"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void load()}
          left={<TextInput.Icon icon="magnify" />}
          style={styles.search}
          outlineStyle={{ borderRadius: RADIUS }}
          dense
        />
        <Divider />

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View style={styles.centerFill}>
            <MaterialCommunityIcons name="phone-alert-outline" size={36} color={antd.textQuaternary} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : calls.length === 0 ? (
          <View style={styles.centerFill}>
            <MaterialCommunityIcons name="phone-outline" size={36} color={antd.textQuaternary} />
            <Text style={{ color: antd.textTertiary }}>No calls found</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingVertical: 4 }}>
            {calls.map((call) => {
              const active = selected?.id === call.id;
              return (
                <TouchableRipple
                  key={call.id}
                  onPress={() => setSelected(call)}
                  style={[styles.row, active && styles.rowActive]}
                >
                  <View style={styles.rowInner}>
                    <MaterialCommunityIcons
                      name="phone-in-talk-outline"
                      size={20}
                      color={active ? antd.primary : antd.textTertiary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium" style={styles.rowFrom} numberOfLines={1}>
                        {call.from}
                      </Text>
                      <Text variant="labelSmall" style={styles.rowMeta}>
                        {fmtDate(call.startedAt)} · {fmtDuration(call.durationMs)}
                      </Text>
                    </View>
                    {call.sentiment && (
                      <View
                        style={[
                          styles.sentimentDot,
                          { backgroundColor: SENTIMENT_COLOR[call.sentiment] ?? antd.textQuaternary },
                        ]}
                      />
                    )}
                  </View>
                </TouchableRipple>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={styles.detail}>
        {!selected ? (
          <View style={styles.centerFill}>
            <MaterialCommunityIcons name="phone-outline" size={40} color={antd.textQuaternary} />
            <Text style={{ color: antd.textTertiary }}>Select a call to view its transcript</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
            <Text variant="titleMedium" style={styles.detailTitle}>
              {selected.from} → {selected.to}
            </Text>
            <Text variant="labelSmall" style={styles.rowMeta}>
              {fmtDate(selected.startedAt)} · {fmtDuration(selected.durationMs)} · {selected.status}
            </Text>

            <View style={styles.chipRow}>
              {selected.callOutcome && <Chip compact>{selected.callOutcome}</Chip>}
              {selected.sentiment && (
                <Chip
                  compact
                  style={{ backgroundColor: `${SENTIMENT_COLOR[selected.sentiment] ?? '#bfbfbf'}22` }}
                >
                  {selected.sentiment}
                </Chip>
              )}
              {(selected.tags ?? []).map((tag) => (
                <Chip key={tag} compact>
                  {tag}
                </Chip>
              ))}
            </View>

            {selected.aiSummary && (
              <View style={styles.summaryBox}>
                <Text variant="labelMedium" style={styles.sectionLabel}>
                  AI Summary
                </Text>
                <Text variant="bodyMedium" style={{ color: antd.text }}>
                  {selected.aiSummary}
                </Text>
              </View>
            )}

            <Divider style={{ marginVertical: 4 }} />
            <Text variant="labelMedium" style={styles.sectionLabel}>
              Transcript
            </Text>
            {selected.transcriptStatus !== 'completed' ? (
              <Text style={{ color: antd.textTertiary }}>Transcript pending…</Text>
            ) : (
              <TranscriptBubbles text={selected.transcriptText} />
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/* ──────────────────────── Transcript Chat Bubbles ──────────────────────── */

type Role = 'user' | 'assistant' | 'tool';

interface Turn {
  role: Role;
  text: string;
}

/**
 * Parse the stored transcript format: `role: text` per line.
 * The backend writes transcripts as:
 *   user: Hello, I'd like to order a pizza
 *   assistant: Of course! What size would you like?
 *   tool: Looking up menu items...
 *
 * Consecutive lines with the same role are merged into a single turn.
 */
function parseTranscript(raw: string | null): Turn[] {
  if (!raw?.trim()) return [];

  const KNOWN_ROLES = new Set(['user', 'assistant', 'tool']);
  const turns: Turn[] = [];
  let currentRole: Role | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentRole && currentLines.length > 0) {
      const text = currentLines.join('\n').trim();
      if (text) turns.push({ role: currentRole, text });
    }
    currentLines = [];
  };

  for (const line of raw.split('\n')) {
    // Check if line starts with a known role prefix
    const match = line.match(/^(user|assistant|tool):\s*(.*)/i);
    if (match) {
      const role = match[1].toLowerCase() as Role;
      if (KNOWN_ROLES.has(role)) {
        if (role !== currentRole) {
          flush();
          currentRole = role;
        }
        currentLines.push(match[2]);
        continue;
      }
    }
    // Continuation line — append to current turn
    currentLines.push(line);
  }
  flush();

  // Fallback: if nothing parsed, show as single user bubble
  if (turns.length === 0) {
    return [{ role: 'user', text: raw.trim() }];
  }
  return turns;
}

const ROLE_LABELS: Record<Role, string> = {
  user: 'Caller',
  assistant: 'AI Assistant',
  tool: 'System',
};

function TranscriptBubbles({ text }: { text: string | null }) {
  const turns = React.useMemo(() => parseTranscript(text), [text]);

  if (turns.length === 0) {
    return <Text style={{ color: antd.textTertiary }}>No transcript available.</Text>;
  }

  return (
    <View style={bubbleStyles.container}>
      {turns.map((turn, i) => {
        // ── Tool messages: compact centered system row ──
        if (turn.role === 'tool') {
          return (
            <View key={i} style={bubbleStyles.toolRow}>
              <View style={bubbleStyles.toolDivider} />
              <View style={bubbleStyles.toolPill}>
                <MaterialCommunityIcons name="cog-outline" size={12} color={antd.textTertiary} />
                <Text variant="labelSmall" style={bubbleStyles.toolText} numberOfLines={2}>
                  {turn.text}
                </Text>
              </View>
              <View style={bubbleStyles.toolDivider} />
            </View>
          );
        }

        const isAssistant = turn.role === 'assistant';

        return (
          <View
            key={i}
            style={[
              bubbleStyles.row,
              isAssistant ? bubbleStyles.rowAssistant : bubbleStyles.rowUser,
            ]}
          >
            {/* Avatar circle */}
            <View
              style={[
                bubbleStyles.avatar,
                isAssistant ? bubbleStyles.avatarAssistant : bubbleStyles.avatarUser,
              ]}
            >
              <MaterialCommunityIcons
                name={isAssistant ? 'robot-outline' : 'account-outline'}
                size={16}
                color="#fff"
              />
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <Text
                variant="labelSmall"
                style={[
                  bubbleStyles.speakerLabel,
                  isAssistant ? bubbleStyles.speakerAssistant : bubbleStyles.speakerUser,
                ]}
              >
                {ROLE_LABELS[turn.role]}
              </Text>
              <View
                style={[
                  bubbleStyles.bubble,
                  isAssistant ? bubbleStyles.bubbleAssistant : bubbleStyles.bubbleUser,
                ]}
              >
                <Text variant="bodyMedium" style={bubbleStyles.bubbleText}>
                  {turn.text}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const bubbleStyles = StyleSheet.create({
  container: { gap: 12, paddingTop: 4, paddingBottom: 16 },

  /* ── User / Assistant rows ── */
  row: { flexDirection: 'row', gap: 8, maxWidth: '85%' },
  rowUser: { alignSelf: 'flex-start' },
  rowAssistant: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },

  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  avatarUser: { backgroundColor: '#8c8c8c' },
  avatarAssistant: { backgroundColor: antd.primary },

  speakerLabel: { fontWeight: '600', marginBottom: 1 },
  speakerUser: { color: antd.textTertiary },
  speakerAssistant: { color: antd.primary, textAlign: 'right' },

  bubble: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 2,
    borderWidth: 1,
    borderColor: antd.split,
  },
  bubbleAssistant: {
    backgroundColor: antd.primaryBg,
    borderTopRightRadius: 2,
  },
  bubbleText: { color: antd.text, lineHeight: 20 },

  /* ── Tool / system rows ── */
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    maxWidth: '70%',
    marginVertical: 2,
  },
  toolDivider: {
    flex: 1,
    height: 1,
    backgroundColor: antd.split,
  },
  toolPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: antd.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: antd.bgContainer,
  },
  toolText: {
    color: antd.textTertiary,
    fontSize: 11,
    fontStyle: 'italic',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: antd.bgLayout },
  list: {
    width: 360,
    backgroundColor: antd.bgContainer,
    borderRightWidth: 1,
    borderRightColor: antd.split,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  title: { color: antd.text, fontWeight: '700' },
  search: { marginHorizontal: 12, marginBottom: 8, backgroundColor: antd.bgContainer },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  errorText: { color: antd.textTertiary, textAlign: 'center' },
  row: { borderBottomWidth: 1, borderBottomColor: antd.split },
  rowActive: { backgroundColor: antd.primaryBg },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowFrom: { color: antd.text, fontWeight: '600' },
  rowMeta: { color: antd.textTertiary },
  sentimentDot: { width: 8, height: 8, borderRadius: 4 },
  detail: { flex: 1 },
  detailTitle: { color: antd.text, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryBox: {
    backgroundColor: antd.bgContainer,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.split,
    padding: 12,
    gap: 4,
  },
  sectionLabel: { color: antd.textSecondary, fontWeight: '600' },
});

