function safeDisconnect(node, target) {
  try {
    if (target === undefined) {
      node.disconnect();
      return;
    }

    node.disconnect(target);
  } catch {}
}

function safeConnect(source, target) {
  source.connect(target);
}

function setMonitorGain(graph, value) {
  if (graph.monitorGain?.gain) {
    graph.monitorGain.gain.value = value;
  }
}

export function attachExportCapture(graph) {
  safeDisconnect(graph.source, graph.destination);

  safeConnect(graph.source, graph.monitorGain);
  safeConnect(graph.monitorGain, graph.destination);
  safeConnect(graph.source, graph.processor);
  safeConnect(graph.processor, graph.silentGain);
  safeConnect(graph.silentGain, graph.destination);

  setMonitorGain(graph, 1);
}

export function setMonitorSuppressed(graph, suppressed) {
  setMonitorGain(graph, suppressed ? 0 : 1);
}

export function detachExportCapture(graph) {
  safeDisconnect(graph.source, graph.monitorGain);
  safeDisconnect(graph.source, graph.processor);
  safeDisconnect(graph.monitorGain, graph.destination);
  safeDisconnect(graph.processor, graph.silentGain);
  safeDisconnect(graph.silentGain, graph.destination);

  safeConnect(graph.source, graph.destination);

  graph.monitorGain = undefined;
  graph.processor = undefined;
  graph.silentGain = undefined;
}
