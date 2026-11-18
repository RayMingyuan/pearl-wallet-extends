# Pearla

[English](README.md) | 中文

Pearla 是 Pearl 的社区版 Chrome 钱包扩展，安全、开源、简洁、免费。

## 能做什么

- 创建 12 词或 24 词钱包，或导入英文助记词、十六进制种子
- 一次安装保存一个保管库，库内可有多个派生账户，并可为账户命名
- 添加观察地址，只查看余额，不持有对应密钥
- 展示收款地址和二维码
- 在 Pearl 主网或测试网发送。签名前须输入密码；广播结果未能确认时不会自动重发
- 查看近期活动，并在对应网络的公开区块浏览器中打开交易
- 按公开行情显示美元估值
- 在设置中切换界面语言、自动锁定时间、网络和索引节点，以及查看助记词、修改密码

## 从源码安装

需要 Node.js 22 或更高版本，以及 Chrome 113 或更高版本。

```sh
npm ci
npm run build
```

`npm run build` 生成可加载的 `dist/`。在 Chrome 打开 `chrome://extensions`，开启开发者模式，选择「加载未打包的扩展程序」，并选中 `dist/`。请加载 `dist/`，不要加载 `src/`。`src/manifest.json` 只是构建输入。

发布用的压缩包需要带上版本号：

```sh
npm run pack -- 1.0.0
```

产物为 `artifacts/pearla-release-v1.0.0.zip`。压缩包根目录包含 `manifest.json`，可直接提交到 Chrome 应用商店，或解压后按上面的方式加载。

## 开发

运行全部测试：

```sh
npm test
```

该命令会先构建正式包和本地 simnet 包，再执行测试。测试使用公开夹具和模拟响应，不会使用用户资金签名或广播。

本地 simnet 仅用于开发验证，不进入商店包。需要自行提供 `pearld`：

```sh
npm run dev:simnet -- /绝对路径/pearld
```

`npm run pack:simnet` 只生成本地验证包，不要上传到 Chrome 应用商店。

## 许可

本项目以 [MIT 许可证](LICENSE) 发布。Copyright (c) 2026 RayMingyuan。
