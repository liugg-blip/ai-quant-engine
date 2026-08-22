const app = getApp()

Page({
  data: { input: '', canSend: false, messages: [], loading: false, scrollId: 'bottom' },

  onLoad() {
    const saved = wx.getStorageSync('deepseek_messages')
    if (Array.isArray(saved)) this.setData({ messages: saved.slice(-40) })
  },

  onInput(event) {
    const input = event.detail.value
    this.setData({ input, canSend: Boolean(input.trim()) })
  },

  send() {
    const text = this.data.input.trim()
    if (!text || this.data.loading) return
    const userMessage = { id: Date.now(), role: 'user', content: text }
    const messages = [...this.data.messages, userMessage]
    this.setData({ input: '', canSend: false, messages, loading: true, scrollId: 'typing' })

    const headers = { 'content-type': 'application/json' }
    if (app.globalData.accessToken) headers['X-App-Token'] = app.globalData.accessToken
    wx.request({
      url: `${app.globalData.apiBaseUrl}/api/wechat/chat`,
      method: 'POST',
      header: headers,
      timeout: 120000,
      data: { messages: messages.slice(-20).map(({ role, content }) => ({ role, content })) },
      success: (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300 || !response.data.reply) {
          this.showError((response.data && response.data.detail) || '服务暂时不可用')
          return
        }
        const next = [...messages, { id: Date.now() + 1, role: 'assistant', content: response.data.reply }]
        this.setData({ messages: next, scrollId: `msg-${next[next.length - 1].id}` })
        wx.setStorageSync('deepseek_messages', next.slice(-40))
      },
      fail: () => this.showError('网络连接失败，请检查服务地址与合法域名配置'),
      complete: () => this.setData({ loading: false })
    })
  },

  showError(message) {
    wx.showToast({ title: message, icon: 'none', duration: 3000 })
  }
})
