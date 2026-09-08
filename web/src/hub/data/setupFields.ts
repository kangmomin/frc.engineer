import type { PlatformMySetupParams } from './platform';

export const SETUP_FIELDS: ReadonlyArray<{ key: keyof PlatformMySetupParams; label: string; unit?: string }> = [
  { key: 'frontWing', label: 'Front Wing' }, { key: 'rearWing', label: 'Rear Wing' }, { key: 'onThrottle', label: 'On Throttle', unit: '%' }, { key: 'offThrottle', label: 'Off Throttle', unit: '%' },
  { key: 'frontCamber', label: 'Front Camber', unit: '°' }, { key: 'rearCamber', label: 'Rear Camber', unit: '°' }, { key: 'frontToe', label: 'Front Toe', unit: '°' }, { key: 'rearToe', label: 'Rear Toe', unit: '°' },
  { key: 'frontSuspension', label: 'Front Suspension' }, { key: 'rearSuspension', label: 'Rear Suspension' }, { key: 'frontAntiRollBar', label: 'Front ARB' }, { key: 'rearAntiRollBar', label: 'Rear ARB' },
  { key: 'frontSuspensionHeight', label: 'Front Ride Height' }, { key: 'rearSuspensionHeight', label: 'Rear Ride Height' }, { key: 'brakePressure', label: 'Brake Pressure', unit: '%' }, { key: 'brakeBias', label: 'Brake Bias', unit: '%' }, { key: 'engineBraking', label: 'Engine Braking', unit: '%' },
  { key: 'rearLeftTyrePressure', label: 'RL Tyre Pressure', unit: 'PSI' }, { key: 'rearRightTyrePressure', label: 'RR Tyre Pressure', unit: 'PSI' }, { key: 'frontLeftTyrePressure', label: 'FL Tyre Pressure', unit: 'PSI' }, { key: 'frontRightTyrePressure', label: 'FR Tyre Pressure', unit: 'PSI' },
  { key: 'ballast', label: 'Ballast' }, { key: 'fuelLoad', label: 'Fuel Load', unit: 'kg' },
];
