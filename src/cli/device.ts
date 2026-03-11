import { InjectionError, ErrorCode } from "./errors.js";

export type ExecFn = (command: string) => string;

const SERIAL_PATTERN = /^[a-zA-Z0-9._:-]+$/;

function validateSerial(serial: string): void {
  if (!SERIAL_PATTERN.test(serial)) {
    throw new InjectionError(ErrorCode.DEVICE_NOT_FOUND, { serial });
  }
}

export interface Device {
  serial: string;
  type: "device" | "emulator";
  model: string;
}

export interface DeviceManager {
  detectDevices(): Device[];
  selectDevice(devices: Device[], serial?: string): Device;
}

export function createDeviceManager(deps: { exec: ExecFn }): DeviceManager {
  return {
    detectDevices(): Device[] {
      const output = deps.exec("adb devices");
      const lines = output.split("\n").slice(1);
      const devices: Device[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split("\t");
        const serial = parts[0];
        const state = parts[1];

        if (!serial || state !== "device") continue;

        validateSerial(serial);

        const type = serial.startsWith("emulator-") ? "emulator" : "device";
        const model = deps
          .exec(`adb -s ${serial} shell getprop ro.product.model`)
          .trim();

        devices.push({ serial, type, model });
      }

      if (devices.length === 0) {
        throw new InjectionError(ErrorCode.NO_DEVICE);
      }

      return devices;
    },

    selectDevice(devices: Device[], serial?: string): Device {
      if (!serial) {
        if (devices.length !== 1) {
          throw new InjectionError(ErrorCode.NO_DEVICE);
        }
        return devices[0] as Device;
      }

      validateSerial(serial);

      const found = devices.find((d) => d.serial === serial);
      if (!found) {
        throw new InjectionError(ErrorCode.DEVICE_NOT_FOUND, { serial });
      }
      return found;
    },
  };
}
