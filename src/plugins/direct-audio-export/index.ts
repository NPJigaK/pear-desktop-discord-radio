import { createPlugin } from '@/utils';

import { Platform } from '@/types/plugins';

import { backend } from './backend';
import { renderer } from './renderer';

export interface DirectAudioExportPluginConfig {
  enabled: boolean;
}

export default createPlugin({
  name: () => 'Direct Audio Export (Spike)',
  description: () =>
    'Exports live renderer PCM to a local named pipe for the Discord radio spike.',
  restartNeeded: false,
  platform: Platform.Windows,
  config: {
    enabled: false,
  } as DirectAudioExportPluginConfig,
  backend,
  renderer,
});
