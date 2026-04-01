export type {
  DoctorCheck,
  DoctorConfig,
  DoctorDependencies,
  DoctorReport,
  DoctorStatus,
} from './types.js';
export { loadDoctorConfig } from './loadDoctorConfig.js';
export {
  assertRuntimePreflight,
  probePearWebSocketReachability,
  runDoctor,
} from './doctor.js';
