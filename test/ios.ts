import assert from "node:assert";

import { IosManager, IosRobot } from "../src/ios";
import { PNG } from "../src/png";

describe("ios", async () => {

	const manager = new IosManager();
	const devices = await manager.listDevices();
	const hasOneDevice = devices.length === 1;
	const robot = new IosRobot(devices?.[0]?.deviceId || "");

	it("should be able to get screenshot", async function() {
		hasOneDevice || this.skip();
		const screenshot = await robot.getScreenshot();
		// an black screenshot (screen is off) still consumes over 30KB
		assert.ok(screenshot.length > 128 * 1024);

		// must be a valid png image that matches the screen size
		const image = new PNG(screenshot);
		const pngSize = image.getDimensions();
		const screenSize = await robot.getScreenSize();

		// wda returns screen size as points, round up
		assert.equal(Math.ceil(pngSize.width / screenSize.scale), screenSize.width);
		assert.equal(Math.ceil(pngSize.height / screenSize.scale), screenSize.height);
	});

	it("should be able to save a screenshot to file", async function() {
		hasOneDevice || this.skip();
		const savePath = "./test_ios_screenshot.png";
		const fs = require("fs");
		const screenshot = await robot.getScreenshot();
		fs.writeFileSync(savePath, screenshot);
		assert.ok(fs.existsSync(savePath), "Screenshot file should exist");
		fs.unlinkSync(savePath);
	});

	it("should skip video recording as not supported on physical iOS", async function() {
		hasOneDevice || this.skip();
		try {
			await robot.startVideoRecording("/tmp/test_ios_video.mp4");
			assert.fail("Should not support video recording on physical iOS");
		} catch (e) {
			const msg = typeof e === "object" && e && "message" in e ? (e as any).message : String(e);
			assert.ok(msg.includes("not supported"));
		}
	});
});
