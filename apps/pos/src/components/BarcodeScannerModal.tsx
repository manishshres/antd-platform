import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { antd, RADIUS } from '../theme';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Fired once per successful scan; the modal stays open so staff can rescan. */
  onScan: (code: string) => void;
  title?: string;
}

/** Full-screen camera dialog for scanning retail barcodes (or any QR code) into the cart. */
export function BarcodeScannerModal({ visible, onDismiss, onScan, title = 'Scan Barcode' }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  if (!visible) return null;

  const handleScanned = ({ data }: { data: string }) => {
    if (locked) return;
    setLocked(true);
    onScan(data);
    setTimeout(() => setLocked(false), 1200);
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content style={styles.content}>
          {!permission?.granted ? (
            <View style={styles.permissionWrap}>
              <MaterialCommunityIcons
                name="camera-off-outline"
                size={40}
                color={antd.textQuaternary}
              />
              <Text variant="bodyMedium" style={styles.permissionText}>
                Camera access is needed to scan product barcodes.
              </Text>
              <Button mode="contained" onPress={requestPermission}>
                Grant Camera Access
              </Button>
            </View>
          ) : (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: [
                    'ean13',
                    'ean8',
                    'upc_a',
                    'upc_e',
                    'code128',
                    'code39',
                    'qr',
                  ],
                }}
                onBarcodeScanned={handleScanned}
              />
              <View style={styles.frame} pointerEvents="none" />
            </View>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Done</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 460, alignSelf: 'center', width: '100%' },
  content: { paddingBottom: 8 },
  cameraWrap: {
    height: 320,
    borderRadius: RADIUS,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  frame: {
    position: 'absolute',
    top: '30%',
    left: '15%',
    right: '15%',
    bottom: '30%',
    borderWidth: 2,
    borderColor: antd.primary,
    borderRadius: RADIUS,
  },
  permissionWrap: {
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  permissionText: { color: antd.textTertiary, textAlign: 'center' },
});
