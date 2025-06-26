import { execFileSync, spawn } from "node:child_process";
import { trace } from "./logger";
import path from "node:path";

export interface EmulatorDevice {
	name: string;
	target: string;
	sdk: string;
	abi: string;
}

export class EmulatorManager {

	getAvdManager = (): string => {
		let executable = "avdmanager";
		if (process.env.ANDROID_HOME) {
			executable = path.join(process.env.ANDROID_HOME, "cmdline-tools", "latest", "bin", "avdmanager");
		}

		return executable;
	};

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

	public listEmulators(): EmulatorDevice[] {

		try {
			const avds = execFileSync(this.getAvdManager(), ["list", "avd"])
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
}
