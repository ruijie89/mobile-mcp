import { execFileSync, spawn } from "node:child_process";
import { AndroidRobot, getAdbPath, getAvdManager, getSdkManager } from "./android";

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

	public listAvailableAndroidSdks(): { path: string; description: string }[] {
		try {
			const output = execFileSync(getSdkManager(), ["--list"]).toString();
			const lines = output.split("\n");
			const sdkLines = lines.filter(line => line.trim().startsWith("system-images;"));
			return sdkLines.map(line => {
				const [path, , description] = line.split("|").map(s => s.trim());
				return { path, description };
			});
		} catch (error) {
			console.error("Error listing Android SDKs", error);
			return [];
		}
	}

	public createOrLaunchAVD(avdName: string, sdkPath: string, abi: string, device: string): string {
		const avds = this.getInstalledAVDs();
		const avdExists = avds.some(avd => avd.name === avdName);
		const avdManager = getAvdManager();
		const emulatorPath = process.env.ANDROID_HOME + "/emulator/emulator";
		if (!avdExists) {
			try {
				execFileSync(avdManager, [
					"create", "avd",
					"-n", avdName,
					"-d", device,
					"-k", sdkPath,
					"--abi", abi,
					"--force"
				], { stdio: "inherit" });
			} catch (e) {
				return `Failed to create AVD: ${e}`;
			}
		}
		// Launch the emulator
		try {
			spawn(emulatorPath, ["-avd", avdName], {
				detached: true,
				stdio: "ignore",
			});
			return avdExists ? `Launched existing AVD: ${avdName}` : `Created and launched new AVD: ${avdName}`;
		} catch (e) {
			return `Failed to launch emulator: ${e}`;
		}
	}
}
