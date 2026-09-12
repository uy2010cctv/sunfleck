# Agent Note：设备浏览器可执行文件发现

状态：已实现

[English](2026-09-12-device-browser-path.md) | 中文

## 问题

macOS LaunchAgent 会刻意使用最小系统 `PATH`。浏览器 Adapter 以裸命令名启动 `agent-browser` 和 `playwright-mcp`，因此即使已安装对应包，两者仍会返回 `ENOENT`。

## 决策

`dsh-device-agent` 将两个浏览器运行时声明为自身依赖，并解析包内 CLI 入口。每个 CLI 通过 `process.execPath` 启动，服务环境无需用户 Shell 或版本管理器路径。本机存在 Chrome 时，两个 Adapter 使用该可执行文件和隔离自动化 Profile；管理员可用 `DSH_DEVICE_BROWSER_EXECUTABLE` 覆盖自动发现。

## 考虑过的替代方案

**把用户 Node 目录加入 LaunchAgent `PATH`。** 该方案与单机和版本管理器耦合，在其他安装中仍无法保证找到包内 Playwright MCP。

**无条件下载第二套浏览器。** 即使本机已有受支持的 Chrome，仍会引入体积较大且依赖网络的安装步骤。

## 影响

浏览器执行可在最小服务环境中正常工作，并复用已安装的浏览器可执行文件，但不复用用户真实浏览器 Profile。Device Agent 发布包必须包含两个 CLI 依赖。浏览器位于非标准路径时，受管主机需设置显式覆盖。

## 验证

回归测试验证包内启动命令。macOS 真实冒烟测试在仅含系统目录的 `PATH` 下，通过 Agent Browser 和 Playwright MCP 分别成功打开并读取 Example Domain。
