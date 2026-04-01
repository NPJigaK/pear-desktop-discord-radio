export function isUnsupportedDirectAudioExportConflictPlugin(
  pluginId: string,
): boolean;

export function getUnsupportedDirectAudioExportConflictIds(
  pluginConfigs: Record<string, { enabled?: boolean } | undefined> | undefined,
): string[];
