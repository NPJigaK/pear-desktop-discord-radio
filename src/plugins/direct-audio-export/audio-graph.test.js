import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachExportCapture,
  detachExportCapture,
  setMonitorSuppressed,
} from './audio-graph.js';

class FakeNode {
  constructor(name) {
    this.name = name;
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
  }

  disconnect(target) {
    if (target === undefined) {
      this.connections = [];
      return;
    }

    this.connections = this.connections.filter((connection) => connection !== target);
  }
}

function createGraph() {
  const source = new FakeNode('source');
  const destination = new FakeNode('destination');
  const monitorGain = new FakeNode('monitorGain');
  monitorGain.gain = { value: 1 };
  const processor = new FakeNode('processor');
  const silentGain = new FakeNode('silentGain');
  silentGain.gain = { value: 0 };

  source.connect(destination);

  return {
    source,
    destination,
    monitorGain,
    processor,
    silentGain,
  };
}

test('attachExportCapture rewires the source through monitor and export paths', () => {
  const graph = createGraph();

  attachExportCapture(graph);

  assert.deepEqual(graph.source.connections, [graph.monitorGain, graph.processor]);
  assert.deepEqual(graph.monitorGain.connections, [graph.destination]);
  assert.deepEqual(graph.processor.connections, [graph.silentGain]);
  assert.deepEqual(graph.silentGain.connections, [graph.destination]);
  assert.equal(graph.monitorGain.gain.value, 1);
});

test('setMonitorSuppressed only changes the monitor path gain', () => {
  const graph = createGraph();

  attachExportCapture(graph);
  setMonitorSuppressed(graph, true);

  assert.equal(graph.monitorGain.gain.value, 0);
  assert.deepEqual(graph.source.connections, [graph.monitorGain, graph.processor]);
  assert.deepEqual(graph.processor.connections, [graph.silentGain]);
  assert.deepEqual(graph.silentGain.connections, [graph.destination]);

  setMonitorSuppressed(graph, false);

  assert.equal(graph.monitorGain.gain.value, 1);
});

test('detachExportCapture restores the direct source to destination path', () => {
  const graph = createGraph();

  attachExportCapture(graph);
  const { monitorGain, processor, silentGain } = graph;
  detachExportCapture(graph);

  assert.deepEqual(graph.source.connections, [graph.destination]);
  assert.deepEqual(monitorGain.connections, []);
  assert.deepEqual(processor.connections, []);
  assert.deepEqual(silentGain.connections, []);
  assert.equal(graph.monitorGain, undefined);
  assert.equal(graph.processor, undefined);
  assert.equal(graph.silentGain, undefined);
});
