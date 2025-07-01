import { Socket } from "node:net";
import { execFileSync } from "node:child_process";

import { WebDriverAgent } from "./webdriver-agent";
import { ActionableError, Button, InstalledApp, Robot, ScreenSize, SwipeDirection, ScreenElement, Orientation, PostureStates } from "./robot";

const WDA_PORT = 8100;
const IOS_TUNNEL_PORT = 60105;

interface ListCommandOutput {
	deviceList: string[];
}

interface VersionCommandOutput {
	version: string;
}

interface InfoCommandOutput {
	DeviceClass: string;
	DeviceName: string;
	ProductName: string;
	ProductType: string;
	ProductVersion: string;
	PhoneNumber: string;
	TimeZone: string;
}

export interface IosDevice {
	deviceId: string;
	deviceName: string;
}

const getGoIosPath = (): string => {
	if (process.env.GO_IOS_PATH) {
		return process.env.GO_IOS_PATH;
	}

	// fallback to go-ios in PATH via `npm install -g go-ios`
	return "ios";
};

export class IosRobot implements Robot {

	public constructor(private deviceId: string) {
	}

	private isListeningOnPort(port: number): Promise<boolean> {
		return new Promise((resolve, reject) => {
			const client = new Socket();
			client.connect(port, "localhost", () => {
				client.destroy();
				resolve(true);
			});

			client.on("error", (err: any) => {
				resolve(false);
			});
		});
	}

	private async isTunnelRunning(): Promise<boolean> {
		return await this.isListeningOnPort(IOS_TUNNEL_PORT);
	}

	private async isWdaForwardRunning(): Promise<boolean> {
		return await this.isListeningOnPort(WDA_PORT);
	}

	private async assertTunnelRunning(): Promise<void> {
		if (await this.isTunnelRequired()) {
			if (!(await this.isTunnelRunning())) {
				throw new ActionableError("iOS tunnel is not running, please see https://github.com/mobile-next/mobile-mcp/wiki/");
			}
		}
	}

	private async wda(): Promise<WebDriverAgent> {

		await this.assertTunnelRunning();

		if (!(await this.isWdaForwardRunning())) {
			throw new ActionableError("Port forwarding to WebDriverAgent is not running (tunnel okay), please see https://github.com/mobile-next/mobile-mcp/wiki/");
		}

		const wda = new WebDriverAgent("localhost", WDA_PORT);

		if (!(await wda.isRunning())) {
			throw new ActionableError("WebDriverAgent is not running on device (tunnel okay, port forwarding okay), please see https://github.com/mobile-next/mobile-mcp/wiki/");
		}

		return wda;
	}

	private async ios(...args: string[]): Promise<string> {
		return execFileSync(getGoIosPath(), ["--udid", this.deviceId, ...args], {}).toString();
	}

	public async getIosVersion(): Promise<string> {
		const output = await this.ios("info");
		const json = JSON.parse(output);
		return json.ProductVersion;
	}

	private async isTunnelRequired(): Promise<boolean> {
		const version = await this.getIosVersion();
		const args = version.split(".");
		return parseInt(args[0], 10) >= 17;
	}

	public async getScreenSize(): Promise<ScreenSize> {
		const wda = await this.wda();
		return await wda.getScreenSize();
	}

	public async swipe(direction: SwipeDirection): Promise<void> {
		const wda = await this.wda();
		await wda.swipe(direction);
	}

	public async swipeFromCoordinate(x: number, y: number, direction: SwipeDirection, distance?: number): Promise<void> {
		const wda = await this.wda();
		await wda.swipeFromCoordinate(x, y, direction, distance);
	}

	public async listApps(): Promise<InstalledApp[]> {
		await this.assertTunnelRunning();

		const output = await this.ios("apps", "--all", "--list");
		return output
			.split("\n")
			.map(line => {
				const [packageName, appName] = line.split(" ");
				return {
					packageName,
					appName,
				};
			});
	}

	public async launchApp(packageName: string): Promise<void> {
		await this.assertTunnelRunning();
		await this.ios("launch", packageName);
	}

	public async terminateApp(packageName: string): Promise<void> {
		await this.assertTunnelRunning();
		await this.ios("kill", packageName);
	}

	public async openUrl(url: string): Promise<void> {
		const wda = await this.wda();
		await wda.openUrl(url);
	}

	public async sendKeys(text: string): Promise<void> {
		const wda = await this.wda();
		await wda.sendKeys(text);
	}

	public async pressButton(button: Button): Promise<void> {
		const wda = await this.wda();
		await wda.pressButton(button);
	}

	public async tap(x: number, y: number): Promise<void> {
		const wda = await this.wda();
		await wda.tap(x, y);
	}

	public async getElementsOnScreen(): Promise<ScreenElement[]> {
		const wda = await this.wda();
		return await wda.getElementsOnScreen();
	}

	public async getScreenshot(): Promise<Buffer> {
		const wda = await this.wda();
		return await wda.getScreenshot();

		/* alternative:
		await this.assertTunnelRunning();
		const tmpFilename = path.join(tmpdir(), `screenshot-${randomBytes(8).toString("hex")}.png`);
		await this.ios("screenshot", "--output", tmpFilename);
		const buffer = readFileSync(tmpFilename);
		unlinkSync(tmpFilename);
		return buffer;
		*/
	}

	public async setOrientation(orientation: Orientation): Promise<void> {
		const wda = await this.wda();
		await wda.setOrientation(orientation);
	}

	public async getOrientation(): Promise<Orientation> {
		const wda = await this.wda();
		return await wda.getOrientation();
	}

	public async changeDevicePosture(posture: PostureStates): Promise<void> {
		throw new ActionableError("Posture changing is not supported for iOS");
	}

	public async installApp(options: { testflightUrl?: string }): Promise<void> {
		if (!options.testflightUrl) {
			throw new ActionableError("You must provide testflightUrl to install an app on iOS device via TestFlight.");
		}
		// Open the TestFlight link in Safari
		await this.openUrl(options.testflightUrl);
	}

	public async uninstallApp(bundleIdentifier: string): Promise<void> {
		await this.assertTunnelRunning();
		await this.ios("uninstall", bundleIdentifier);
	}
}

export class IosManager {

	public async isGoIosInstalled(): Promise<boolean> {
		try {
			const output = execFileSync(getGoIosPath(), ["version"], { stdio: ["pipe", "pipe", "ignore"] }).toString();
			const json: VersionCommandOutput = JSON.parse(output);
			return json.version !== undefined && (json.version.startsWith("v") || json.version === "local-build");
		} catch (error) {
			return false;
		}
	}

	public getDeviceName(deviceId: string): string {
		const output = execFileSync(getGoIosPath(), ["info", "--udid", deviceId]).toString();
		const json: InfoCommandOutput = JSON.parse(output);
		return json.DeviceName;
	}

	public listDevices(): IosDevice[] {
		if (!this.isGoIosInstalled()) {
			console.error("go-ios is not installed, no physical iOS devices can be detected");
			return [];
		}

		const output = execFileSync(getGoIosPath(), ["list"]).toString();
		const json: ListCommandOutput = JSON.parse(output);
		const devices = json.deviceList.map(device => ({
			deviceId: device,
			deviceName: this.getDeviceName(device),
		}));

		return devices;
	}
}
