# MusicWorld · 长期约定

## 项目

- 纯静态单页音乐播放器：`index.html` + `css/style.css` + `js/core.js`（基础设施）+ `js/app.js`（业务）
- 约定：音乐放 `music/`，同名歌词放 `lyrics/`；用户已部署 IIS，页面自动扫描目录
- 侧边栏导入按钮已按要求移除，仅保留顶栏「导入文件夹」与空状态按钮

## 关联资产

- 由本项目沉淀的用户级技能 `static-web-app` 已创建；其云端版本文档：
  https://www.workbuddy.cn/space/d/b91Xijz0k0YitqIWdRPBWy
  用户要求后续改动直接更新该云端文档，并同步回本地技能目录保持技能生效。

## 验证方式

- 本地起服务：`python tools/server.py 端口`，浏览器验证用 `_check` 脚本 + playwright-core（channel: msedge）
