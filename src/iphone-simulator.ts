import { execFileSync } from "node:child_process";

import { trace } from "./logger";
import { WebDriverAgent } from "./webdriver-agent";
import { ActionableError, Button, InstalledApp, Robot, ScreenElement, ScreenSize, SwipeDirection, Orientation, PostureStates } from "./robot";

export interface Simulator {
	name: string;
	uuid: string;
	state: string;
}

// Standalone interface for iOS runtimes
export interface IosRuntime {
	name: string;
	identifier: string;
}
interface ListDevicesResponse {
	devices: {
		[key: string]: Array<{
			state: string;
			name: string;
			isAvailable: boolean;
			udid: string;
		}>,
	},
}

interface AppInfo {
	ApplicationType: string;
	Bundle: string;
	CFBundleDisplayName: string;
	CFBundleExecutable: string;
	CFBundleIdentifier: string;
	CFBundleName: string;
	CFBundleVersion: string;
	DataContainer: string;
	Path: string;
}

const TIMEOUT = 30000;
const WDA_PORT = 8100;
const MAX_BUFFER_SIZE = 1024 * 1024 * 4;

export class Simctl implements Robot {

	constructor(private readonly simulatorUuid: string) {}

	private async isWdaInstalled(): Promise<boolean> {
		const apps = await this.listApps();
		return apps.map(app => app.packageName).includes("com.facebook.WebDriverAgentRunner.xctrunner");
	}

	private async startWda(): Promise<void> {
		if (!(await this.isWdaInstalled())) {
			// wda is not even installed, won't attempt to start it
			return;
		}

		trace("Starting WebDriverAgent");
		const webdriverPackageName = "com.facebook.WebDriverAgentRunner.xctrunner";
		this.simctl("launch", this.simulatorUuid, webdriverPackageName);

		// now we wait for wda to have a successful status
		const wda = new WebDriverAgent("localhost", WDA_PORT);

		// wait up to 10 seconds for wda to start
		const timeout = +new Date() + 10 * 1000;
		while (+new Date() < timeout) {
			// cross fingers and see if wda is already running
			if (await wda.isRunning()) {
				trace("WebDriverAgent is now running");
				return;
			}

			// wait 100ms before trying again
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		trace("Could not start WebDriverAgent in time, giving up");
	}

	private async wda(): Promise<WebDriverAgent> {
		const wda = new WebDriverAgent("localhost", WDA_PORT);

		if (!(await wda.isRunning())) {
			await this.startWda();
			if (!(await wda.isRunning())) {
				throw new ActionableError("WebDriverAgent is not running on simulator, please see https://github.com/mobile-next/mobile-mcp/wiki/");
			}

			// was successfully started
		}

		return wda;
	}

	private simctl(...args: string[]): Buffer {
		return execFileSync("xcrun", ["simctl", ...args], {
			timeout: TIMEOUT,
			maxBuffer: MAX_BUFFER_SIZE,
		});
	}

	public async getScreenshot(): Promise<Buffer> {
		const wda = await this.wda();
		return await wda.getScreenshot();
		// alternative: return this.simctl("io", this.simulatorUuid, "screenshot", "-");
	}

	public async openUrl(url: string) {
		const wda = await this.wda();
		await wda.openUrl(url);
		// alternative: this.simctl("openurl", this.simulatorUuid, url);
	}

	public async launchApp(packageName: string) {
		this.simctl("launch", this.simulatorUuid, packageName);
	}

	public async terminateApp(packageName: string) {
		this.simctl("terminate", this.simulatorUuid, packageName);
	}

	public async listApps(): Promise<InstalledApp[]> {
		const text = this.simctl("listapps", this.simulatorUuid).toString();
		const result = execFileSync("plutil", ["-convert", "json", "-o", "-", "-r", "-"], {
			input: text,
		});

		const output = JSON.parse(result.toString()) as Record<string, AppInfo>;
		return Object.values(output).map(app => ({
			packageName: app.CFBundleIdentifier,
			appName: app.CFBundleDisplayName,
		}));
	}

	public async getScreenSize(): Promise<ScreenSize> {
		const wda = await this.wda();
		return wda.getScreenSize();
	}

	public async sendKeys(keys: string) {
		const wda = await this.wda();
		return wda.sendKeys(keys);
	}

	public async swipe(direction: SwipeDirection): Promise<void> {
		const wda = await this.wda();
		return wda.swipe(direction);
	}

	public async swipeFromCoordinate(x: number, y: number, direction: SwipeDirection, distance?: number): Promise<void> {
		const wda = await this.wda();
		return wda.swipeFromCoordinate(x, y, direction, distance);
	}

	public async tap(x: number, y: number) {
		const wda = await this.wda();
		return wda.tap(x, y);
	}

	public async pressButton(button: Button) {
		const wda = await this.wda();
		return wda.pressButton(button);
	}

	public async getElementsOnScreen(): Promise<ScreenElement[]> {
		const wda = await this.wda();
		return wda.getElementsOnScreen();
	}

	public async setOrientation(orientation: Orientation): Promise<void> {
		const wda = await this.wda();
		return wda.setOrientation(orientation);
	}

	public async getOrientation(): Promise<Orientation> {
		const wda = await this.wda();
		return wda.getOrientation();
	}

	public async changeDevicePosture(posture: PostureStates): Promise<void> {
		throw new ActionableError("Posture changing is not supported for iOS");
	}

	public async installApp(options: { ipaPath?: string }): Promise<void> {
		if (!options.ipaPath) {
			throw new ActionableError("You must provide ipaPath to install an app on iOS simulator.");
		}
		this.simctl("install", this.simulatorUuid, options.ipaPath);
	}
}

export class SimctlManager {

	public listSimulators(): Simulator[] {
		// detect if this is a mac
		if (process.platform !== "darwin") {
			// don't even try to run xcrun
			return [];
		}

		try {
			const text = execFileSync("xcrun", ["simctl", "list", "devices", "-j"]).toString();
			const json: ListDevicesResponse = JSON.parse(text);
			return Object.values(json.devices).flatMap(device => {
				return device.map(d => {
					return {
						name: d.name,
						uuid: d.udid,
						state: d.state,
					};
				});
			});
		} catch (error) {
			console.error("Error listing simulators", error);
			return [];
		}
	}

	public listBootedSimulators(): Simulator[] {
		return this.listSimulators()
			.filter(simulator => simulator.state === "Booted");
	}

	public getSimulator(uuid: string): Simctl {
		return new Simctl(uuid);
	}

	// Standalone function to list available iOS runtimes
	public listAvailableIosRuntimes(): IosRuntime[] {
		try {
			const output = execFileSync("xcrun", ["simctl", "list", "runtimes"]).toString();
			const lines = output.split("\n");
			return lines
				.filter(line => line.trim().startsWith("iOS "))
				.map(line => {
					const match = line.match(/^(iOS [^\(]+) \([^)]+\) - ([^\s]+)/);
					if (match) {
						return { name: match[1].trim(), identifier: match[2].trim() };
					}
					return null;
				})
				.filter(Boolean) as IosRuntime[];
		} catch (error) {
			console.error("Error listing iOS runtimes", error);
			return [];
		}
	}

	public createOrLaunchSimulator(simName: string, runtimeId: string, deviceType: string = "iPhone 14"): string {
		const simulators = this.listSimulators();
		const found = simulators.find(sim => sim.name === simName && runtimeId && sim.state !== undefined);
		if (!found) {
			try {
				execFileSync("xcrun", ["simctl", "create", simName, deviceType, runtimeId], { stdio: "inherit" });
			} catch (e) {
				return `Failed to create simulator: ${e}`;
			}
		}
		// Find the UUID of the simulator
		const updatedSims = this.listSimulators();
		const sim = updatedSims.find(s => s.name === simName && runtimeId && s.state !== undefined);
		if (!sim) {
			return `Simulator creation failed or not found.`;
		}
		try {
			execFileSync("xcrun", ["simctl", "boot", sim.uuid], { stdio: "inherit" });
			// Open Simulator app if not running
			try {
				const isRunning = execFileSync("pgrep", ["-x", "Simulator"]).toString().trim().length > 0;
				if (!isRunning) {
					execFileSync("open", ["-a", "Simulator"]);
				}
			} catch (e) {
				// Ignore errors from pgrep/open
			}
			return found ? `Booted existing simulator: ${simName}` : `Created and booted new simulator: ${simName}`;
		} catch (e) {
			return `Failed to boot simulator: ${e}`;
		}
	}
}
