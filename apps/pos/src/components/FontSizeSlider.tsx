import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { antd } from '../theme';

export type FontScale = -2 | -1 | 0 | 1 | 2 | 3;

const STEPS: { value: FontScale; label: string }[] = [
  { value: -2, label: 'XSmall' },
  { value: -1, label: 'Small' },
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Large' },
  { value: 2, label: 'X-Large' },
  { value: 3, label: 'Max' },
];

const THUMB_SIZE = 22;

interface Props {
  value: FontScale;
  onChange: (value: FontScale) => void;
}

/** Draggable 6-step slider for the printer's font-size scale (condensed font below Normal, ESC/POS width/height 0-3 above it). */
export function FontSizeSlider({ value, onChange }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const valueIndex = STEPS.findIndex((s) => s.value === value);

  // PanResponder.create is only called once (via useRef below), so its
  // callbacks permanently close over whatever `value`/`onChange`/`trackWidth`
  // existed on the FIRST render — trackWidth would be 0 forever, since layout
  // hasn't measured yet at mount, making every touch a silent no-op. Reading
  // through refs (kept current on every render) fixes that without recreating
  // the responder.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const trackWidthRef = useRef(trackWidth);
  trackWidthRef.current = trackWidth;

  const handleTouch = (x: number) => {
    const width = trackWidthRef.current;
    if (width <= 0) return;
    const usable = Math.max(1, width - THUMB_SIZE);
    const ratio = Math.max(0, Math.min(1, (x - THUMB_SIZE / 2) / usable));
    const index = Math.round(ratio * (STEPS.length - 1));
    const step = STEPS[index].value;
    if (step !== valueRef.current) onChangeRef.current(step);
  };

  // locationX stays relative to this track view for the whole gesture, since
  // panHandlers are attached here (not on the thumb) — no delta math needed.
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleTouch(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => handleTouch(evt.nativeEvent.locationX),
    }),
  ).current;

  const thumbLeft = trackWidth > 0 ? (valueIndex / (STEPS.length - 1)) * (trackWidth - THUMB_SIZE) : 0;

  return (
    <View style={styles.wrap}>
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
        {...responder.panHandlers}
      >
        <View style={styles.trackBase} />
        <View style={[styles.trackFill, { width: thumbLeft + THUMB_SIZE / 2 }]} />
        {STEPS.map((s, i) => (
          <View
            key={s.value}
            pointerEvents="none"
            style={[
              styles.tick,
              {
                left:
                  trackWidth > 0
                    ? (i / (STEPS.length - 1)) * (trackWidth - THUMB_SIZE) + THUMB_SIZE / 2 - 2
                    : 0,
              },
              s.value <= value && styles.tickActive,
            ]}
          />
        ))}
        <View pointerEvents="none" style={[styles.thumb, { left: thumbLeft }]} />
      </View>
      <View style={styles.labels}>
        {STEPS.map((s) => (
          <Text
            key={s.value}
            variant="labelSmall"
            style={s.value === value ? styles.labelActive : styles.label}
          >
            {s.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  track: { height: 22, justifyContent: 'center' },
  trackBase: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    right: THUMB_SIZE / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: antd.fillSecondary,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: antd.primary,
  },
  tick: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: antd.border,
  },
  tickActive: { backgroundColor: antd.primary },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: antd.primary,
    borderWidth: 2,
    borderColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  label: { color: antd.textTertiary },
  labelActive: { color: antd.primary, fontWeight: '700' },
});
