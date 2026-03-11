// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createDeviceManager } from "../../src/cli/device.js";
import { ErrorCode, InjectionError } from "../../src/cli/errors.js";

const SINGLE_DEVICE_OUTPUT =
  "List of devices attached\nemulator-5554\tdevice\n\n";
const MULTI_DEVICE_OUTPUT =
  "List of devices attached\nemulator-5554\tdevice\nHVA7N18A14000257\tdevice\n\n";
const NO_DEVICE_OUTPUT = "List of devices attached\n\n";
const OFFLINE_DEVICE_OUTPUT =
  "List of devices attached\nemulator-5554\toffline\n\n";
const UNAUTHORIZED_DEVICE_OUTPUT =
  "List of devices attached\nHVA7N\tunauthorized\n\n";
const MIXED_STATE_OUTPUT =
  "List of devices attached\nemulator-5554\tdevice\nHVA7N\tunauthorized\nABC123\toffline\n\n";

function createMockExec(responses: Record<string, string>) {
  return vi.fn((command: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (command.includes(pattern)) return response;
    }
    return "";
  });
}

describe("detectDevices", () => {
  it("returns a single device with correct fields", () => {
    const exec = createMockExec({
      "adb devices": SINGLE_DEVICE_OUTPUT,
      "ro.product.model": "sdk_gphone64_arm64",
    });
    const dm = createDeviceManager({ exec });

    const devices = dm.detectDevices();

    expect(devices).toEqual([
      {
        serial: "emulator-5554",
        type: "emulator",
        model: "sdk_gphone64_arm64",
      },
    ]);
  });

  it("detects emulator type from serial prefix", () => {
    const exec = createMockExec({
      "adb devices": SINGLE_DEVICE_OUTPUT,
      "ro.product.model": "sdk_gphone64_arm64",
    });
    const dm = createDeviceManager({ exec });

    const devices = dm.detectDevices();
    expect(devices[0]?.type).toBe("emulator");
  });

  it("detects physical device type from non-emulator serial", () => {
    const exec = createMockExec({
      "adb devices": "List of devices attached\nHVA7N18A14000257\tdevice\n\n",
      "ro.product.model": "Pixel 7",
    });
    const dm = createDeviceManager({ exec });

    const devices = dm.detectDevices();
    expect(devices[0]?.type).toBe("device");
  });

  it("returns multiple devices", () => {
    const exec = vi.fn((command: string) => {
      if (command === "adb devices") return MULTI_DEVICE_OUTPUT;
      if (command.includes("emulator-5554")) return "sdk_gphone64_arm64";
      if (command.includes("HVA7N18A14000257")) return "Pixel 7";
      return "";
    });
    const dm = createDeviceManager({ exec });

    const devices = dm.detectDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0]?.serial).toBe("emulator-5554");
    expect(devices[1]?.serial).toBe("HVA7N18A14000257");
  });

  it("throws InjectionError with NO_DEVICE when zero devices found", () => {
    const exec = createMockExec({ "adb devices": NO_DEVICE_OUTPUT });
    const dm = createDeviceManager({ exec });

    expect(() => dm.detectDevices()).toThrow(InjectionError);
    try {
      dm.detectDevices();
    } catch (e) {
      expect(e).toBeInstanceOf(InjectionError);
      expect((e as InjectionError).code).toBe(ErrorCode.NO_DEVICE);
    }
  });

  it("filters out offline devices", () => {
    const exec = createMockExec({ "adb devices": OFFLINE_DEVICE_OUTPUT });
    const dm = createDeviceManager({ exec });

    expect(() => dm.detectDevices()).toThrow(InjectionError);
  });

  it("filters out unauthorized devices", () => {
    const exec = createMockExec({
      "adb devices": UNAUTHORIZED_DEVICE_OUTPUT,
    });
    const dm = createDeviceManager({ exec });

    expect(() => dm.detectDevices()).toThrow(InjectionError);
  });

  it("only includes devices with 'device' state from mixed output", () => {
    const exec = vi.fn((command: string) => {
      if (command === "adb devices") return MIXED_STATE_OUTPUT;
      if (command.includes("emulator-5554")) return "sdk_gphone64_arm64";
      return "";
    });
    const dm = createDeviceManager({ exec });

    const devices = dm.detectDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.serial).toBe("emulator-5554");
  });
});

describe("selectDevice", () => {
  const devices = [
    { serial: "emulator-5554", type: "emulator" as const, model: "sdk" },
    { serial: "HVA7N18A14000257", type: "device" as const, model: "Pixel 7" },
  ];

  it("returns first device when no serial specified and single device", () => {
    const exec = vi.fn();
    const dm = createDeviceManager({ exec });

    const first = devices[0];
    if (!first) throw new Error("test setup error");
    const result = dm.selectDevice([first]);
    expect(result.serial).toBe("emulator-5554");
  });

  it("returns matching device by serial", () => {
    const exec = vi.fn();
    const dm = createDeviceManager({ exec });

    const result = dm.selectDevice(devices, "HVA7N18A14000257");
    expect(result.serial).toBe("HVA7N18A14000257");
  });

  it("throws DEVICE_NOT_FOUND for unknown serial", () => {
    const exec = vi.fn();
    const dm = createDeviceManager({ exec });

    expect(() => dm.selectDevice(devices, "unknown-serial")).toThrow(
      InjectionError,
    );
    try {
      dm.selectDevice(devices, "unknown-serial");
    } catch (e) {
      expect((e as InjectionError).code).toBe(ErrorCode.DEVICE_NOT_FOUND);
      expect((e as InjectionError).message).toContain("unknown-serial");
    }
  });

  it("returns correct device from multiple when serial matches", () => {
    const exec = vi.fn();
    const dm = createDeviceManager({ exec });

    const result = dm.selectDevice(devices, "emulator-5554");
    expect(result.serial).toBe("emulator-5554");
    expect(result.type).toBe("emulator");
  });

  it("throws when multiple devices and no serial specified", () => {
    const exec = vi.fn();
    const dm = createDeviceManager({ exec });

    expect(() => dm.selectDevice(devices)).toThrow(InjectionError);
  });

  it("rejects serial with shell metacharacters", () => {
    const exec = vi.fn();
    const dm = createDeviceManager({ exec });

    expect(() => dm.selectDevice(devices, "foo;rm -rf /")).toThrow(
      InjectionError,
    );
  });
});
