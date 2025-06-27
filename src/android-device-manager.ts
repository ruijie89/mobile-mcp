import { execFileSync, spawn } from "node:child_process";
import { trace } from "./logger";
import { AndroidRobot, getAdbPath, getAvdManager } from "./android";

export interface AndroidDevice {
	deviceId: string;
	deviceType: "tv" | "mobile";
	port: string;
}

export interface AVD {
	name: string;
	target: string;
	sdk: string;
	abi: string;
}

type AndroidDeviceType = "tv" | "mobile";
export class AndroidDeviceManager {

	private getDeviceType(name: string): AndroidDeviceType {
		const device = new AndroidRobot(name);
		const features = device.getSystemFeatures();
		if (features.includes("android.software.leanback") || features.includes("android.hardware.type.television")) {
			return "tv";
		}

		return "mobile";
	}

	launch(options: {
		sdk?: number;
		type?: "foldable" | "tablet" | "phone";
		os?: "ios" | "android";
	}) {
		const { sdk, type, os = "android" } = options;
		if (os === "android") {
			this.launchAndroid(sdk, type);
		} else {
			throw new Error("iOS emulators are not supported yet.");
		}
	}

	private launchAndroid(sdk?: number, type?: "foldable" | "tablet" | "phone") {
		const sdkPath = process.env.ANDROID_HOME;
		if (!sdkPath) {
			throw new Error(
				"ANDROID_HOME environment variable is not set. Please set it to your Android SDK path."
			);
		}
		// const avdManager = `${sdkPath}/cmdline-tools/latest/bin/avdmanager`;
		const emulator = `${sdkPath}/emulator/emulator`;

		// TO-DO: avdmanager create avd -n "foldable" -d "pixel_fold" --package "system-images;android-35;google_apis;x86_64"
		const command = `-avd foldable`;
		trace(`exec: ${emulator} ${command}`);

		const child = spawn(emulator, command.split(" "), {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
	}

	public getInstalledAVDs(): AVD[] {
		try {
			const avds = execFileSync(getAvdManager(), ["list", "avd"])
				.toString()
				.split("Name: ").slice(1);

			return avds.map(block => {
				const lines = block.split("\n");
				const name = lines[0].trim();
				const target = lines
					.find(l => l.includes("Target:"))
					?.split("Target: ")[1]
					?.trim() || "Unknown";
				const abi =
					lines
						.find(l => l.includes("ABI:"))
						?.split("ABI: ")[1]
						?.trim() || "Unknown";
				return {
					name: name,
					target: target,
					sdk: target,
					abi: abi,
				};
			});
		} catch (error) {
			console.error("Error listing emulators", error);
			return [];
		}
	}

	public getAllConnectedDevices(): AndroidDevice[] {
		try {
			const names = execFileSync(getAdbPath(), ["devices"])
				.toString()
				.split("\n")
				.filter(line => !line.startsWith("List of devices attached"))
				.filter(line => line.trim() !== "")
				.map(line => line.split("\t")[0]);

			return names.map(name => ({
				deviceId: name,
				deviceType: this.getDeviceType(name),
				port: name.includes("emulator-") ? (name.split("emulator-")[1]?.split("\t")[0] ?? "") : ""
			}));
		} catch (error) {
			console.error("Could not execute adb command, maybe ANDROID_HOME is not set?");
			return [];
		}
	}

	public getConnectedAVDs(): AndroidDevice[] {
		try {
			const devices = this.getAllConnectedDevices();

			return devices.filter(device => device.deviceId.includes("emulator"))
				.map(device => ({
					deviceId: device.deviceId,
					deviceType: device.deviceType,
					port: device.port
				}));
		} catch (error) {
			console.error("Error listing emulators", error);
			return [];
		}
	}
}
