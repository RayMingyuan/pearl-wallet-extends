import { mountSimnet } from "./simnet-ui.js";

try { mountSimnet(document); }
catch { document.getElementById("simnet-error").textContent = "本地 simnet 测试界面初始化失败"; }
