# DeepSeek 微信聊天小程序

## 1. 配置后端

在 `server/.env` 中填写：

```ini
LLM_PROVIDER=deepseek
LLM_API_KEY=你的_DeepSeek_API_Key
LLM_MODEL=deepseek-v4-flash
QE_HOST=0.0.0.0
QE_CORS=https://你的接口域名
WECHAT_RATE_LIMIT=20
# 可选；设置后还需同步填写 app.js 的 accessToken
WECHAT_ACCESS_TOKEN=换成随机长字符串
```

不要把 `LLM_API_KEY` 写进小程序。公网服务必须使用 HTTPS；建议在 Nginx、云托管或 API 网关处配置证书、日志脱敏与全局限流。

独立启动微信聊天服务：

```bash
cd server
pip install -r requirements-wechat.txt
uvicorn wechat_api:app --host 0.0.0.0 --port 8770
```

## 2. 配置小程序

1. 在微信公众平台把 `https://你的接口域名` 加入“开发管理 → 开发设置 → 服务器域名 → request 合法域名”。
2. 修改 `app.js` 的 `apiBaseUrl`；如启用访问令牌，同时填写 `accessToken`。
3. 用微信开发者工具导入本目录，把 `project.config.json` 中的 `appid` 换成你的小程序 AppID。

开发工具可临时关闭“校验合法域名”，真机和上线版本不能依赖此开关。当前聊天记录保存在微信本地存储，每次只向后端发送最近 20 条消息。

> `WECHAT_ACCESS_TOKEN` 会随小程序代码分发，只能作为基础防滥用措施，不属于真正秘密。正式上线建议增加 `wx.login` 登录态校验，并在网关按用户/IP/额度限流。
