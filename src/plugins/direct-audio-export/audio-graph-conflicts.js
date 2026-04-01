const UNSUPPORTED_GRAPH_PLUGINS = ['audio-compressor', 'equalizer'];

export function isUnsupportedDirectAudioExportConflictPlugin(pluginId) {
  return UNSUPPORTED_GRAPH_PLUGINS.includes(pluginId);
}

export function getUnsupportedDirectAudioExportConflictIds(pluginConfigs) {
  return UNSUPPORTED_GRAPH_PLUGINS.filter((pluginId) =>
    isUnsupportedDirectAudioExportConflictPlugin(pluginId),
  ).filter((pluginId) => pluginConfigs?.[pluginId]?.enabled);
}
