App({
  globalData: {
    // 改为已在微信公众平台配置的 HTTPS request 合法域名，末尾不要加 /。
    apiBaseUrl: 'https://your-api.example.com',
    // 若服务端未设置 WECHAT_ACCESS_TOKEN，请保持为空。
    accessToken: ''
  }
})
