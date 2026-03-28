import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Paths, File, Directory } from 'expo-file-system';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { ModelFile } from '../types';
import { getModels, saveModel, removeModel } from '../services/storage';

export default function FilesScreen() {
  const navigation = useNavigation<any>();
  const [models, setModels] = useState<ModelFile[]>([]);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloading, setDownloading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadModels();
    }, [])
  );

  async function loadModels() {
    const m = await getModels();
    setModels(m);
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/sla', 'model/stl', 'model/3mf', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext !== 'stl' && ext !== '3mf') {
        Alert.alert('Invalid File', 'Please select an STL or 3MF file.');
        return;
      }

      // Copy to app documents directory
      const modelsDir = new Directory(Paths.document, 'models');
      modelsDir.create();
      const destName = `${Date.now()}_${file.name}`;
      const sourceFile = new File(file.uri);
      const destFile = new File(modelsDir, destName);
      sourceFile.copy(destFile);

      const model: ModelFile = {
        id: `model_${Date.now()}`,
        name: file.name,
        uri: destFile.uri,
        size: file.size || 0,
        type: ext as 'stl' | '3mf',
        addedAt: Date.now(),
      };

      await saveModel(model);
      await loadModels();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  }

  async function downloadFile() {
    if (!downloadUrl.trim()) return;

    setDownloading(true);
    try {
      const filename = downloadUrl.split('/').pop() || 'model.stl';
      const ext = filename.split('.').pop()?.toLowerCase();

      const modelsDir = new Directory(Paths.document, 'models');
      modelsDir.create();

      const downloaded = await File.downloadFileAsync(downloadUrl.trim(), modelsDir);

      const model: ModelFile = {
        id: `model_${Date.now()}`,
        name: filename,
        uri: downloaded.uri,
        size: downloaded.size || 0,
        type: (ext === '3mf' ? '3mf' : 'stl') as 'stl' | '3mf',
        addedAt: Date.now(),
      };

      await saveModel(model);
      await loadModels();
      setShowUrlModal(false);
      setDownloadUrl('');
    } catch (err: any) {
      Alert.alert('Download Failed', err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function deleteModel(model: ModelFile) {
    Alert.alert('Delete Model', `Remove "${model.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const file = new File(model.uri);
            file.delete();
          } catch {}
          await removeModel(model.id);
          await loadModels();
        },
      },
    ]);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function renderModel({ item }: { item: ModelFile }) {
    return (
      <TouchableOpacity
        style={styles.modelCard}
        onPress={() => navigation.navigate('SliceSettings', { modelId: item.id })}
        onLongPress={() => deleteModel(item)}
      >
        <View style={styles.modelIcon}>
          <Ionicons
            name={item.type === '3mf' ? 'cube' : 'cube-outline'}
            size={28}
            color={COLORS.primary}
          />
        </View>
        <View style={styles.modelInfo}>
          <Text style={styles.modelName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.modelMeta}>
            {item.type.toUpperCase()} · {formatSize(item.size)} · {formatDate(item.addedAt)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Models</Text>
        <Text style={styles.subtitle}>{models.length} file{models.length !== 1 ? 's' : ''}</Text>
      </View>

      {models.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="cube-outline" size={64} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>No models yet</Text>
          <Text style={styles.emptyText}>
            Import an STL or 3MF file to get started
          </Text>
        </View>
      ) : (
        <FlatList
          data={models}
          keyExtractor={(item) => item.id}
          renderItem={renderModel}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={pickFile}>
          <Ionicons name="folder-open" size={22} color={COLORS.bg} />
          <Text style={styles.actionText}>Import File</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={() => setShowUrlModal(true)}
        >
          <Ionicons name="cloud-download" size={22} color={COLORS.primary} />
          <Text style={[styles.actionText, { color: COLORS.primary }]}>Download URL</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showUrlModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Download Model</Text>
            <Text style={styles.modalSubtitle}>
              Enter a direct URL to an STL or 3MF file
            </Text>
            <TextInput
              style={styles.input}
              placeholder="https://example.com/model.stl"
              placeholderTextColor={COLORS.textMuted}
              value={downloadUrl}
              onChangeText={setDownloadUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowUrlModal(false);
                  setDownloadUrl('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, !downloadUrl.trim() && { opacity: 0.5 }]}
                onPress={downloadFile}
                disabled={!downloadUrl.trim() || downloading}
              >
                {downloading ? (
                  <ActivityIndicator color={COLORS.bg} size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Download</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingTop: 60, paddingBottom: SPACING.md },
  title: { ...FONTS.title },
  subtitle: { ...FONTS.small, marginTop: SPACING.xs },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: 120 },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modelIcon: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  modelInfo: { flex: 1 },
  modelName: { ...FONTS.body, fontWeight: '600' },
  modelMeta: { ...FONTS.small, marginTop: 2 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 100,
  },
  emptyTitle: { ...FONTS.heading, fontSize: 20, marginTop: SPACING.md },
  emptyText: { ...FONTS.small, marginTop: SPACING.xs, textAlign: 'center' },
  actions: {
    position: 'absolute',
    bottom: 30,
    left: SPACING.lg,
    right: SPACING.lg,
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    gap: SPACING.sm,
  },
  actionBtnSecondary: {
    backgroundColor: COLORS.primaryDim,
  },
  actionText: { fontWeight: '700', fontSize: 15, color: COLORS.bg },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  modal: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalTitle: { ...FONTS.heading, fontSize: 20 },
  modalSubtitle: { ...FONTS.small, marginTop: SPACING.xs, marginBottom: SPACING.md },
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: SPACING.lg,
    gap: SPACING.sm,
  },
  modalCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceLight,
  },
  modalCancelText: { color: COLORS.textSecondary, fontWeight: '600' },
  modalConfirm: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  modalConfirmText: { color: COLORS.bg, fontWeight: '700' },
});
