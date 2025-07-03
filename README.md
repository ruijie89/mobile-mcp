# Mobile Next - MCP server for Mobile Development and Automation  | iOS, Android, Simulator, Emulator, and physical devices

This is a [Model Context Protocol (MCP) server](https://github.com/modelcontextprotocol) that enables scalable mobile automation, development through a platform-agnostic interface, eliminating the need for distinct iOS or Android knowledge. You can run it on emulators, simulators, and physical devices (iOS and Android).
This server allows Agents and LLMs to interact with native iOS/Android applications and devices through structured accessibility snapshots or coordinate-based taps based on screenshots.

## Main Features

- Launch, create, and terminate Android emulators and iOS simulators with a single command.
- List all created and running devices (emulators, simulators, and physical devices).
- Install, uninstall, launch, and terminate apps (APK, IPA, TestFlight supported).
- List all installed apps on the device.
- Take and save screenshots at any point in your workflow.
- List all UI elements on screen, including coordinates, labels, and text.
- Tap/click on screen at specific coordinates or on detected UI elements.
- Swipe in any direction (up, down, left, right) from center or custom coordinates.
- Type text into focused elements, with optional submit/enter.
- Press device buttons (HOME, BACK, VOLUME, DPAD, etc.).
- Fold or unfold supported Android emulators for foldable device testing.
- Open URLs in the device browser for web automation.
- Start and stop video recording of the device or simulator screen, and save recordings to your host machine.
- Automate step-by-step test workflows, saving screenshots and videos for each step.

## Installation and configuration

Setup our MCP with Cline, Cursor, Claude, VS Code, Github Copilot:

As there's no releases yet, we can still set up after checking out the project.

### Local Setup for Claude or Cursor

1. **Clone this repository, install dependencies, and build:**

   ```sh
   npm install
   npm run build
   ```

2. **Configure your agent (Claude, Cursor, etc) to connect to your local MCP:**
   - For Claude, Cursor or Cline, add to your MCP config:

     ```json
     {
       "mcpServers": {
         "mobile-mcp": {
           "command": "npx",
           "args": ["<absolute file path to project root>/lib/index.js"]
         }
       }
     }
     ```

3. **(Optional) For development, you can run tests:**

   ```sh
   npm test
   ```

### 🛠️ How to Use 📝

After adding the MCP server to your IDE/Client, you can instruct your AI assistant to use the available tools.
For example, in Cursor's agent mode, you could use the prompts below to quickly validate, test and iterate on UI intereactions, read information from screen, go through complex workflows.

Be descriptive, straight to the point.

## Prerequisites

What you will need to connect MCP with your agent and mobile devices:

- [Xcode command line tools](https://developer.apple.com/xcode/resources/)
- [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools)
- [node.js](https://nodejs.org/en/download/) v22+
- [MCP](https://modelcontextprotocol.io/introduction) supported foundational models or agents, like [Claude MCP](https://modelcontextprotocol.io/quickstart/server), [OpenAI Agent SDK](https://openai.github.io/openai-agents-python/mcp/), [Copilot Studio](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/introducing-model-context-protocol-mcp-in-copilot-studio-simplified-integration-with-ai-apps-and-agents/)

### Simulators, Emulators, and Physical Devices

When launched, Mobile MCP can connect to:

- iOS Simulators on macOS/Linux
- Android Emulators on Linux/Windows/macOS
- Physical iOS or Android devices (requires proper platform tools and drivers)

Make sure you have your mobile platform SDKs (Xcode, Android SDK) installed and configured properly before running Mobile Next Mobile MCP.
