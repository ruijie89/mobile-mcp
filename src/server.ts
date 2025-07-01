import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types";
import { z, ZodRawShape, ZodTypeAny } from "zod";
import os from "node:os";
import crypto from "node:crypto";

import { error, trace } from "./logger";
import { AndroidRobot } from "./android";
import { ActionableError, Robot } from "./robot";
import { SimctlManager } from "./iphone-simulator";
import { IosManager, IosRobot } from "./ios";
import { PNG } from "./png";
import { isImageMagickInstalled, Image } from "./image-utils";
import { AndroidDeviceManager } from "./android-device-manager";

export const getAgentVersion = (): string => {
	const json = require("../package.json");
	return json.version;
};

const getLatestAgentVersion = async (): Promise<string> => {
	const response = await fetch("https://api.github.com/repos/mobile-next/mobile-mcp/tags?per_page=1");
	const json = await response.json();
	return json[0].name;
};

const checkForLatestAgentVersion = async (): Promise<void> => {
	try {
		const latestVersion = await getLatestAgentVersion();
		const currentVersion = getAgentVersion();
		if (latestVersion !== currentVersion) {
			trace(`You are running an older version of the agent. Please update to the latest version: ${latestVersion}.`);
		}
	} catch (error: any) {
		// ignore
	}
};

export const createMcpServer = (): McpServer => {

	const server = new McpServer({
		name: "mobile-mcp",
		version: getAgentVersion(),
		capabilities: {
			resources: {},
			tools: {},
		},
	});

	// an empty object to satisfy windsurf
	const noParams = z.object({});

	const tool = (name: string, description: string, paramsSchema: ZodRawShape, cb: (args: z.objectOutputType<ZodRawShape, ZodTypeAny>) => Promise<string>) => {
		const wrappedCb = async (args: ZodRawShape): Promise<CallToolResult> => {
			try {
				trace(`Invoking ${name} with args: ${JSON.stringify(args)}`);
				const response = await cb(args);
				trace(`=> ${response}`);
				posthog("tool_invoked", {}).then();
				return {
					content: [{ type: "text", text: response }],
				};
			} catch (error: any) {
				if (error instanceof ActionableError) {
					return {
						content: [{ type: "text", text: `${error.message}. Please fix the issue and try again.` }],
					};
				} else {
					// a real exception
					trace(`Tool '${description}' failed: ${error.message} stack: ${error.stack}`);
					return {
						content: [{ type: "text", text: `Error: ${error.message}` }],
						isError: true,
					};
				}
			}
		};

		server.tool(name, description, paramsSchema, args => wrappedCb(args));
	};

	const posthog = async (event: string, properties: Record<string, string>) => {
		try {
			const url = "https://us.i.posthog.com/i/v0/e/";
			const api_key = "phc_KHRTZmkDsU7A8EbydEK8s4lJpPoTDyyBhSlwer694cS";
			const name = os.hostname() + process.execPath;
			const distinct_id = crypto.createHash("sha256").update(name).digest("hex");
			const systemProps = {
				Platform: os.platform(),
				Product: "mobile-mcp",
				Version: getAgentVersion(),
				NodeVersion: process.version,
			};

			await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					api_key,
					event,
					properties: {
						...systemProps,
						...properties,
					},
					distinct_id,
				})
			});
		} catch (err: any) {
			// ignore
		}
	};

	posthog("launch", {}).then();

	let robot: Robot | null;
	const simulatorManager = new SimctlManager();
	const emulatorManager = new AndroidDeviceManager();

	const requireRobot = () => {
		if (!robot) {
			throw new ActionableError("No device selected. Use the mobile_use_device tool to select a device.");
		}
	};

	tool(
		"mobile_use_default_device",
		"Selects and uses the default device if there is only one running device (real or virtual). This tool will fail if no devices or multiple devices are running.",
		{
			noParams
		},
		async () => {
			const iosManager = new IosManager();
			const androidManager = new AndroidDeviceManager();
			const simulators = simulatorManager.listBootedSimulators();
			const androidDevices = androidManager.getAllConnectedDevices();
			const iosDevices = iosManager.listDevices();

			const sum = simulators.length + androidDevices.length + iosDevices.length;
			if (sum === 0) {
				throw new ActionableError("No devices found. Please connect a device and try again.");
			} else if (sum >= 2) {
				throw new ActionableError("Multiple devices found. Please use the mobile_list_available_devices tool to list available devices and select one.");
			}

			// only one device connected, let's find it now
			if (simulators.length === 1) {
				robot = simulatorManager.getSimulator(simulators[0].name);
				return `Selected default device: ${simulators[0].name}`;
			} else if (androidDevices.length === 1) {
				robot = new AndroidRobot(androidDevices[0].deviceId);
				return `Selected default device: ${androidDevices[0].deviceId}`;
			} else if (iosDevices.length === 1) {
				robot = new IosRobot(iosDevices[0].deviceId);
				return `Selected default device: ${iosDevices[0].deviceId}`;
			}

			// how did this happen?
			throw new ActionableError("No device selected. Please use the mobile_list_available_devices tool to list available devices and select one.");
		}
	);

	tool(
		"mobile_launch_device",
		"Launches an existing Android emulator or iOS simulator, or creates a new one if it doesn't exist. For Android, `systemImage` is required. For iOS, `runtimeId` is required. If a `name` is not provided, a default name will be generated.",
		{
			os: z.enum(["ios", "android"]),
			systemImage: z.string().optional(), // Android system image path
			runtimeId: z.string().optional(), // iOS runtime identifier
			deviceType: z.string().optional(), // Device type for both platforms
			name: z.string().optional(), // AVD or simulator name
			abi: z.string().optional(), // Android ABI
		},
		async options => {
			if (options.os === "android") {
				if (!options.systemImage) {
					throw new ActionableError("You must specify systemImage (Android system image path) for Android emulator.");
				}
				const abi = options.abi || "arm64-v8a"; // Default ABI, can be improved by parsing systemImage
				const avdName = options.name || `mcp_avd_${options.systemImage.replace(/[^a-zA-Z0-9]/g, "_")}`;
				const deviceType = options.deviceType || "pixel_5";
				const result = emulatorManager.createOrLaunchAVD(avdName, options.systemImage, abi, deviceType);
				return result;
			}
			if (options.os === "ios") {
				if (!options.runtimeId) {
					throw new ActionableError("You must specify runtimeId for iOS simulator.");
				}
				const simName = options.name || `mcp_sim_${options.runtimeId.replace(/[^a-zA-Z0-9]/g, "_")}`;
				const deviceType = options.deviceType || "iPhone 14";
				const result = simulatorManager.createOrLaunchSimulator(simName, options.runtimeId, deviceType);
				return result;
			}
			throw new Error("Unexpected OS. Specify 'android' or 'ios'.");
		}
	);

	tool(
		"mobile_list_created_mobile_devices",
		"List all created mobile virtual devices, including AVD emulators and iOS simulators, with their details.",
		{
			noParams
		},
		async ({}) => {
			const simulators = simulatorManager.listSimulators().map(
				simulator =>
					`${simulator.name} State: ${simulator.state})`,
			);

			const emulators = emulatorManager.getInstalledAVDs().map(
				emulator =>
					`${emulator.name} (Target: ${emulator.target}, ABI: ${emulator.abi})`,
			);

			const resp = ["Found these devices:"];
			if (simulators.length > 0) {
				resp.push(`iOS simulators: [${simulators.join(".")}]`);
			}

			if (emulators.length > 0) {
				resp.push(`Android emulators: [${emulators.join(",")}]`);
			}

			return resp.join("\n");
		}
	);

	tool(
		"mobile_list_running_devices",
		"List all running devices, including both physical & virtual devices (simulators, AVD emulators, real devices).",
		{
			noParams
		},
		async ({}) => {
			const iosManager = new IosManager();
			const androidManager = new AndroidDeviceManager();
			const simulators = simulatorManager.listBootedSimulators();
			const simulatorNames = simulators.map(d => d.name);
			const androidDevices = androidManager.getAllConnectedDevices();
			const iosDevices = await iosManager.listDevices();
			const iosDeviceNames = iosDevices.map(d => d.deviceId);
			const androidTvDevices = androidDevices.filter(d => d.deviceType === "tv").map(d => d.deviceId);
			const androidMobileDevices = androidDevices.filter(d => d.deviceType === "mobile").map(d => d.deviceId);

			const resp = ["Found these devices:"];
			if (simulatorNames.length > 0) {
				resp.push(`iOS simulators: [${simulatorNames.join(".")}]`);
			}

			if (iosDevices.length > 0) {
				resp.push(`iOS devices: [${iosDeviceNames.join(",")}]`);
			}

			if (androidMobileDevices.length > 0) {
				resp.push(`Android devices: [${androidMobileDevices.join(",")}]`);
			}

			if (androidTvDevices.length > 0) {
				resp.push(`Android TV devices: [${androidTvDevices.join(",")}]`);
			}

			return resp.join("\n");
		}
	);

	tool(
		"mobile_list_mobile_system_images",
		"List the available SDKs to create AVDs in Android, and list the available runtimes for simctl to create simulators for iOS. Use this only when there's no existing device and need to create new avd emulators or simulators.",
		{
			noParams
		},
		async ({}) => {
			const androidSdks = emulatorManager.listAvailableAndroidSdks();
			const iosRuntimes = simulatorManager.listAvailableIosRuntimes();

			const androidList = androidSdks.length > 0
				? androidSdks.map(sdk => `- ${sdk.path}: ${sdk.description}`).join("\n")
				: "No Android system images found.";
			const iosList = iosRuntimes.length > 0
				? iosRuntimes.map((rt: { name: string; identifier: string }) => `- ${rt.name} (${rt.identifier})`).join("\n")
				: "No iOS runtimes found.";

			return `Available Android SDK system images:\n${androidList}\n\nAvailable iOS runtimes:\n${iosList}`;
		}
	);

	tool(
		"mobile_use_device",
		"Selects a device to use for subsequent commands. Use mobile_list_all_running_devices to see available devices.",
		{
			device: z.string().describe("The name of the device to select"),
			deviceType: z.enum(["simulator", "ios", "android"]).describe("The type of device to select"),
		},
		async ({ device, deviceType }) => {
			switch (deviceType) {
				case "simulator":
					robot = simulatorManager.getSimulator(device);
					break;
				case "ios":
					robot = new IosRobot(device);
					break;
				case "android":
					robot = new AndroidRobot(device);
					break;
			}

			return `Selected device: ${device}`;
		}
	);

	tool(
		"mobile_terminate_virtual_device",
		"Terminate a specified device (Android emulator or iOS simulator) by deviceId/uuid.",
		{
			deviceId: z.string().describe("The deviceId (for Android) or uuid (for iOS simulator) to terminate"),
			deviceType: z.enum(["android", "simulator"]).describe("The type of device: 'android' for emulator, 'simulator' for iOS simulator"),
		},
		async ({ deviceId, deviceType }) => {
			if (deviceType === "android") {
				try {
					AndroidDeviceManager.terminateEmulator(deviceId);
					return `Terminated Android emulator: ${deviceId}`;
				} catch (err: any) {
					throw new ActionableError(`Failed to terminate Android emulator: ${err.message}`);
				}
			} else if (deviceType === "simulator") {
				try {
					SimctlManager.terminateSimulator(deviceId);
					return `Terminated iOS simulator: ${deviceId}`;
				} catch (err: any) {
					throw new ActionableError(`Failed to terminate iOS simulator: ${err.message}`);
				}
			} else {
				throw new ActionableError("Unsupported deviceType. Use 'android' or 'simulator'.");
			}
		}
	);

	tool(
		"mobile_list_apps",
		"List all the installed apps on the device",
		{
			noParams
		},
		async ({}) => {
			requireRobot();
			const result = await robot!.listApps();
			return `Found these apps on device: ${result.map(app => `${app.appName} (${app.packageName})`).join(", ")}`;
		}
	);

	tool(
		"mobile_launch_app",
		"Launch an app on mobile device. Use this to open a specific app. You can find the package name of the app by calling mobile_list_apps.",
		{
			packageName: z.string().describe("The package name of the app to launch"),
		},
		async ({ packageName }) => {
			requireRobot();
			await robot!.launchApp(packageName);
			return `Launched app ${packageName}`;
		}
	);

	tool(
		"mobile_terminate_app",
		"Stop and terminate an app on mobile device",
		{
			packageName: z.string().describe("The package name of the app to terminate"),
		},
		async ({ packageName }) => {
			requireRobot();
			await robot!.terminateApp(packageName);
			return `Terminated app ${packageName}`;
		}
	);

	tool(
		"mobile_install_app",
		"Install an app on the mobile device. For Android, provide apkPath. For iOS simulator, provide ipaPath. For iOS device, provide testflightUrl. Use absolute path when providing apkPath or ipaPath.",
		{
			apkPath: z.string().optional().describe("Path to the APK file for Android."),
			ipaPath: z.string().optional().describe("Path to the IPA file for iOS simulator."),
			testflightUrl: z.string().optional().describe("TestFlight public link for iOS device."),
		},
		async ({ apkPath, ipaPath, testflightUrl }) => {
			requireRobot();
			await robot!.installApp({ apkPath, ipaPath, testflightUrl });
			if (apkPath) {
				return `Attempted to install APK: ${apkPath}`;
			} else if (ipaPath) {
				return `Attempted to install IPA: ${ipaPath}`;
			} else if (testflightUrl) {
				return `Attempted to open TestFlight link: ${testflightUrl}`;
			} else {
				return `No install parameters provided.`;
			}
		}
	);

	tool(
		"mobile_uninstall_app",
		"Uninstall an app from the mobile device. Provide the package name (Android) or the bundle identifier (iOS) of the app to uninstall.",
		{
			appIdentifier: z.string().describe("The package name (Android) or bundle identifier (iOS) of the app to uninstall"),
		},
		async ({ appIdentifier }) => {
			requireRobot();
			if (!robot) {throw new ActionableError("No device selected. Use the mobile_use_device tool to select a device.");}

			await robot!.uninstallApp(appIdentifier);
			return `Uninstalled app ${appIdentifier}.`;

		}
	);

	tool(
		"mobile_get_screen_size",
		"Get the screen size of the mobile device in pixels",
		{
			noParams
		},
		async ({}) => {
			requireRobot();
			const screenSize = await robot!.getScreenSize();
			return `Screen size is ${screenSize.width}x${screenSize.height} pixels`;
		}
	);

	tool(
		"mobile_click_on_screen_at_coordinates",
		"Click on the screen at given x,y coordinates. If clicking on an element, use the list_elements_on_screen tool to find the coordinates.",
		{
			x: z.number().describe("The x coordinate to click on the screen, in pixels"),
			y: z.number().describe("The y coordinate to click on the screen, in pixels"),
		},
		async ({ x, y }) => {
			requireRobot();
			await robot!.tap(x, y);
			return `Clicked on screen at coordinates: ${x}, ${y}`;
		}
	);

	tool(
		"mobile_list_elements_on_screen",
		"List elements on screen and their coordinates, with display text or accessibility label. Do not cache this result.",
		{
			noParams
		},
		async ({}) => {
			requireRobot();
			const elements = await robot!.getElementsOnScreen();

			const result = elements.map(element => {
				const out: any = {
					type: element.type,
					text: element.text,
					label: element.label,
					name: element.name,
					value: element.value,
					identifier: element.identifier,
					coordinates: {
						x: element.rect.x,
						y: element.rect.y,
						width: element.rect.width,
						height: element.rect.height,
					},
				};

				if (element.focused) {
					out.focused = true;
				}

				return out;
			});

			return `Found these elements on screen: ${JSON.stringify(result)}`;
		}
	);

	tool(
		"mobile_press_button",
		"Press a button on device",
		{
			button: z.string().describe("The button to press. Supported buttons: BACK (android only), HOME, VOLUME_UP, VOLUME_DOWN, ENTER, DPAD_CENTER (android tv only), DPAD_UP (android tv only), DPAD_DOWN (android tv only), DPAD_LEFT (android tv only), DPAD_RIGHT (android tv only)"),
		},
		async ({ button }) => {
			requireRobot();
			await robot!.pressButton(button);
			return `Pressed the button: ${button}`;
		}
	);

	tool(
		"mobile_open_url",
		"Open a URL in browser on device",
		{
			url: z.string().describe("The URL to open"),
		},
		async ({ url }) => {
			requireRobot();
			await robot!.openUrl(url);
			return `Opened URL: ${url}`;
		}
	);

	tool(
		"mobile_swipe_on_screen",
		"Swipe on the screen in a given direction. Can swipe from the center of the screen or from a specified coordinate.",
		{
			direction: z.enum(["up", "down", "left", "right"]).describe("The direction to swipe"),
			x: z.number().optional().describe("The x coordinate to start the swipe from, in pixels. If not provided, uses center of screen"),
			y: z.number().optional().describe("The y coordinate to start the swipe from, in pixels. If not provided, uses center of screen"),
			distance: z.number().optional().describe("The distance to swipe in pixels. Defaults to 50% of screen dimension for Android and iOS"),
		},
		async ({ direction, x, y, distance }) => {
			requireRobot();

			if (x !== undefined && y !== undefined) {
				// Use coordinate-based swipe
				await robot!.swipeFromCoordinate(x, y, direction, distance);
				const distanceText = distance ? ` ${distance} pixels` : "";
				return `Swiped ${direction}${distanceText} from coordinates: ${x}, ${y}`;
			} else {
				// Use center-based swipe
				await robot!.swipe(direction);
				return `Swiped ${direction} on screen`;
			}
		}
	);

	tool(
		"mobile_type_keys",
		"Type text into the focused element",
		{
			text: z.string().describe("The text to type"),
			submit: z.boolean().describe("Whether to submit the text. If true, the text will be submitted as if the user pressed the enter key."),
		},
		async ({ text, submit }) => {
			requireRobot();
			await robot!.sendKeys(text);

			if (submit) {
				await robot!.pressButton("ENTER");
			}

			return `Typed text: ${text}`;
		}
	);

	tool(
		"mobile_save_screenshot",
		"Save a screenshot of the mobile device to a file",
		{
			saveTo: z.string().describe("The path to save the screenshot to"),
		},
		async ({ saveTo }) => {
			requireRobot();

			if (!robot) {throw new ActionableError("No device selected. Use the mobile_use_device tool to select a device.");}

			if (robot instanceof AndroidRobot) {
				await robot.saveScreenshotToFile(saveTo);
				return `Screenshot saved to: ${saveTo}`;
			} else {
				const screenshot = await robot.getScreenshot();
				require("fs").writeFileSync(saveTo, screenshot);
				return `Screenshot saved to: ${saveTo}`;
			}
		}
	);

	server.tool(
		"mobile_take_screenshot",
		"Take a screenshot of the mobile device. Use this to understand what's on screen, if you need to press an element that is available through view hierarchy then you must list elements on screen instead. Do not cache this result.",
		{
			noParams
		},
		async ({}) => {
			requireRobot();

			try {
				const screenSize = await robot!.getScreenSize();

				let screenshot = await robot!.getScreenshot();
				let mimeType = "image/png";

				// validate we received a png, will throw exception otherwise
				const image = new PNG(screenshot);
				const pngSize = image.getDimensions();
				if (pngSize.width <= 0 || pngSize.height <= 0) {
					throw new ActionableError("Screenshot is invalid. Please try again.");
				}

				if (isImageMagickInstalled()) {
					trace("ImageMagick is installed, resizing screenshot");
					const image = Image.fromBuffer(screenshot);
					const beforeSize = screenshot.length;
					screenshot = image.resize(Math.floor(pngSize.width / screenSize.scale))
						.jpeg({ quality: 75 })
						.toBuffer();

					const afterSize = screenshot.length;
					trace(`Screenshot resized from ${beforeSize} bytes to ${afterSize} bytes`);

					mimeType = "image/jpeg";
				}

				const screenshot64 = screenshot.toString("base64");
				trace(`Screenshot taken: ${screenshot.length} bytes`);

				return {
					content: [{ type: "image", data: screenshot64, mimeType }]
				};
			} catch (err: any) {
				error(`Error taking screenshot: ${err.message} ${err.stack}`);
				return {
					content: [{ type: "text", text: `Error: ${err.message}` }],
					isError: true,
				};
			}
		}
	);

	tool(
		"mobile_set_orientation",
		"Change the screen orientation of the device",
		{
			orientation: z.enum(["portrait", "landscape"]).describe("The desired orientation"),
		},
		async ({ orientation }) => {
			requireRobot();
			await robot!.setOrientation(orientation);
			return `Changed device orientation to ${orientation}`;
		}
	);

	tool(
		"mobile_get_orientation",
		"Get the current screen orientation of the device",
		{
			noParams
		},
		async () => {
			requireRobot();
			const orientation = await robot!.getOrientation();
			return `Current device orientation is ${orientation}`;
		}
	);

	tool(
		"mobile_change_posture",
		"Fold or unfold the device.",
		{
			posture: z.enum(["fold", "unfold"]).describe("The desired posture")
		},
		async ({ posture }) => {
			requireRobot();
			await robot!.changeDevicePosture(posture);
			return `Changed device posture to ${posture}`;
		}
	);

	tool(
		"mobile_start_video_recording",
		"Start video recording on the mobile device (Android or iOS simulator).",
		{
			devicePath: z.string().describe("The path on the device to save the video (e.g., /sdcard/test.mp4) for Android, or the path to save the video on host for iOS simulator."),
		},
		async ({ devicePath }) => {
			requireRobot();
			if (!robot) {throw new ActionableError("No device selected. Use the mobile_use_device tool to select a device.");}
			if (typeof robot.startVideoRecording === "function") {
				await robot.startVideoRecording(devicePath);
				return `Started video recording to: ${devicePath}`;
			} else {
				throw new ActionableError("Video recording is not supported on this device type.");
			}
		}
	);

	tool(
		"mobile_stop_video_recording",
		"Stop video recording on the mobile device (Android or iOS simulator).",
		noParams.shape,
		async () => {
			requireRobot();
			if (!robot) {throw new ActionableError("No device selected. Use the mobile_use_device tool to select a device.");}
			if (typeof robot.stopVideoRecording === "function") {
				await robot.stopVideoRecording();
				return `Stopped video recording.`;
			} else {
				throw new ActionableError("Video recording is not supported on this device type.");
			}
		}
	);

	tool(
		"mobile_save_and_cleanup_video_recording",
		"Save a video recording from the device to a file on the host and remove it from the device (Android only).",
		{
			devicePath: z.string().describe("The path of the video on the device (e.g., /sdcard/recording.mp4)"),
			saveTo: z.string().describe("The path on the host to save the video to"),
		},
		async ({ devicePath, saveTo }) => {
			requireRobot();
			if (!(robot instanceof AndroidRobot)) {
				throw new ActionableError("This tool is only supported on Android devices.");
			}
			await robot.saveAndCleanupVideoRecording(devicePath, saveTo);
			return `Video recording saved to: ${saveTo} and removed from device (${devicePath})`;
		}
	);

	// async check for latest agent version
	checkForLatestAgentVersion().then();

	return server;
};
