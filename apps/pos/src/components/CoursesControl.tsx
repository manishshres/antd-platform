import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { antd, RADIUS } from '../theme';
import { COURSE_LABELS, type Course, type LocalOrder } from '../types';

const COURSES: Course[] = [1, 2, 3];

interface Props {
  fireMode: LocalOrder['fireMode'];
  onFireModeChange: (mode: LocalOrder['fireMode']) => void;
  activeCourse: Course | undefined;
  onActiveCourseChange: (course: Course | undefined) => void;
}

/**
 * Coursing controls for the cart: how this ticket reaches the kitchen, and
 * which course new items land on.
 *
 * The course chips only appear in "by course" mode — assigning courses to an
 * order that fires all at once would be a setting with no effect, which is
 * worse than no setting at all.
 */
export function CoursesControl({
  fireMode,
  onFireModeChange,
  activeCourse,
  onActiveCourseChange,
}: Props) {
  const byCourse = fireMode === 'by_course';

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        <TouchableRipple
          onPress={() => {
            onFireModeChange('all');
            onActiveCourseChange(undefined);
          }}
          style={[styles.modeTab, !byCourse && styles.modeTabActive]}
          borderless
        >
          <Text style={[styles.modeText, !byCourse && styles.modeTextActive]}>
            Fire all at once
          </Text>
        </TouchableRipple>
        <TouchableRipple
          onPress={() => {
            onFireModeChange('by_course');
            // Land on Apps by default — the first wave is what gets rung first.
            onActiveCourseChange(activeCourse ?? 1);
          }}
          style={[styles.modeTab, byCourse && styles.modeTabActive]}
          borderless
        >
          <Text style={[styles.modeText, byCourse && styles.modeTextActive]}>
            By course
          </Text>
        </TouchableRipple>
      </View>

      {byCourse && (
        <View style={styles.courseRow}>
          {COURSES.map((course) => {
            const active = activeCourse === course;
            return (
              <TouchableRipple
                key={course}
                onPress={() => onActiveCourseChange(course)}
                style={[styles.chip, active && styles.chipActive]}
                borderless
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {COURSE_LABELS[course]}
                </Text>
              </TouchableRipple>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, marginBottom: 8 },
  modeRow: { flexDirection: 'row', gap: 6 },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
    alignItems: 'center',
  },
  modeTabActive: { borderColor: antd.primary, backgroundColor: antd.primaryBg },
  modeText: { fontSize: 12, fontWeight: '600', color: antd.textSecondary },
  modeTextActive: { color: antd.primary },

  courseRow: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: antd.border,
    backgroundColor: antd.bgContainer,
    alignItems: 'center',
  },
  chipActive: { borderColor: antd.primary, backgroundColor: antd.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: antd.textSecondary },
  chipTextActive: { color: '#fff' },
});
