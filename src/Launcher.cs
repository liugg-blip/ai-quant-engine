using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

// 量化引擎 v10.0 启动器
// 把内嵌的单文件 HTML 释放到本地，然后用系统默认浏览器打开。
namespace QuantEngine
{
    static class Program
    {
        public const string Version = "v10.0";
        public static string HtmlPath;
        public static string BackendScript;
        public static string SessionToken;
        public static int BackendPort;
        public static string UiLanguage = "zh-CN";
        public static string DataDir;

        static string TokenPath
        {
            get { return Path.Combine(Path.GetDirectoryName(BackendScript), "data", "session.token"); }
        }

        static string LanguagePath
        {
            get { return Path.Combine(DataDir, "ui-language.txt"); }
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            DataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "QuantEngine");
            LoadUiLanguage();
            HtmlPath = Path.Combine(DataDir, "QUANT_ENGINE_v10.html");
            BackendScript = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "run.bat");

            try
            {
                Directory.CreateDirectory(DataDir);
                WriteTerminalHtml(UiLanguage);
            }
            catch (Exception ex)
            {
                MessageBox.Show("释放终端页面失败：\r\n" + ex.Message,
                    "量化引擎", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            Application.Run(new MainForm());
        }

        static void WriteTerminalHtml(string language)
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("QE.html"))
            {
                if (stream == null) throw new Exception("内嵌页面资源缺失");
                string html;
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                    html = reader.ReadToEnd();
                html = html.Replace("__QE_RUNTIME_LANGUAGE__",
                    language == "en-US" ? "en-US" : "zh-CN");
                File.WriteAllText(HtmlPath, html, new UTF8Encoding(false));
            }
        }

        static void LoadUiLanguage()
        {
            try
            {
                if (!File.Exists(LanguagePath)) return;
                string value = File.ReadAllText(LanguagePath, Encoding.UTF8).Trim();
                UiLanguage = value == "en-US" ? "en-US" : "zh-CN";
            }
            catch { UiLanguage = "zh-CN"; }
        }

        public static void SaveUiLanguage(string value)
        {
            UiLanguage = value == "en-US" ? "en-US" : "zh-CN";
            try
            {
                Directory.CreateDirectory(DataDir);
                File.WriteAllText(LanguagePath, UiLanguage, new UTF8Encoding(false));
            }
            catch { }
        }

        public static bool BackendHealthy(int port, bool requireAuthenticated)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(
                    "http://127.0.0.1:" + port + "/api/health");
                req.Timeout = 650;
                req.ReadWriteTimeout = 650;
                req.Proxy = null;
                if (!string.IsNullOrEmpty(SessionToken))
                    req.Headers["X-QE-Token"] = SessionToken;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    return res.StatusCode == HttpStatusCode.OK &&
                        body.Contains("\"app_id\":\"quant-engine-v10\"") &&
                        body.Contains("\"api_version\":\"2.0\"") &&
                        (!requireAuthenticated || body.Contains("\"authenticated\":true"));
                }
            }
            catch { return false; }
        }

        static bool EnsureSessionToken()
        {
            try
            {
                if (File.Exists(TokenPath))
                {
                    string existing = File.ReadAllText(TokenPath, Encoding.ASCII).Trim();
                    if (existing.Length >= 32)
                    {
                        SessionToken = existing;
                        return true;
                    }
                }

                Directory.CreateDirectory(Path.GetDirectoryName(TokenPath));
                byte[] bytes = new byte[32];
                using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
                SessionToken = Convert.ToBase64String(bytes)
                    .TrimEnd('=').Replace('+', '-').Replace('/', '_');
                File.WriteAllText(TokenPath, SessionToken, Encoding.ASCII);
                return true;
            }
            catch { return false; }
        }

        static bool PortAvailable(int port)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                return true;
            }
            catch { return false; }
            finally
            {
                if (listener != null)
                {
                    try { listener.Stop(); }
                    catch { }
                }
            }
        }

        public static bool PrepareBackend()
        {
            if (!EnsureSessionToken() || !File.Exists(BackendScript)) return false;

            // 优先复用已经运行且身份匹配的 v10 后端。
            for (int port = 8770; port <= 8780; port++)
            {
                if (!PortAvailable(port) && BackendHealthy(port, true))
                {
                    BackendPort = port;
                    return true;
                }
            }

            // 固定端口被旧版本或其他程序占用时，自动选择下一个空闲端口。
            for (int port = 8770; port <= 8780; port++)
            {
                if (PortAvailable(port))
                {
                    BackendPort = port;
                    break;
                }
            }
            if (BackendPort == 0) return false;

            try
            {
                var p = new ProcessStartInfo
                {
                    FileName = Environment.GetEnvironmentVariable("COMSPEC") ?? "cmd.exe",
                    Arguments = "/d /c call \"" + BackendScript + "\" " + BackendPort,
                    WorkingDirectory = Path.GetDirectoryName(BackendScript),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                p.EnvironmentVariables["QE_SESSION_TOKEN"] = SessionToken;
                Process.Start(p);
                return true;
            }
            catch { return false; }
        }

        public static bool RefreshBackendStatus()
        {
            return BackendPort > 0 && EnsureSessionToken() && BackendHealthy(BackendPort, true);
        }

        public static void OpenTerminal()
        {
            try
            {
                // 每次进入都从内嵌模板重新写入所选语言，彻底摆脱浏览器缓存和旧标签页状态。
                WriteTerminalHtml(UiLanguage);
                string target = new Uri(HtmlPath).AbsoluteUri;
                // 语言放在查询参数而不是 # 片段中。浏览器复用已有标签页时，
                // 仅修改片段不会重新载入页面，翻译脚本也就不会再次执行。
                target += "?qe_lang=" + Uri.EscapeDataString(UiLanguage) +
                    "&qe_launch=" + DateTime.UtcNow.Ticks;
                string fragment = "";
                if (BackendPort > 0)
                    fragment = "qe_api=" + Uri.EscapeDataString(
                        "http://127.0.0.1:" + BackendPort);
                if (!string.IsNullOrEmpty(SessionToken))
                    fragment = "qe_token=" + Uri.EscapeDataString(SessionToken) +
                        (fragment.Length > 0 ? "&" + fragment : "");
                if (fragment.Length > 0) target += "#" + fragment;
                Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                string message = UiLanguage == "en-US"
                    ? "Unable to open the browser:\r\n" + ex.Message + "\r\n\r\nOpen this file manually:\r\n" + HtmlPath
                    : "无法打开浏览器：\r\n" + ex.Message + "\r\n\r\n请手动打开：\r\n" + HtmlPath;
                MessageBox.Show(message, UiLanguage == "en-US" ? "Quant Engine" : "量化引擎",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }

    class MainForm : Form
    {
        static readonly Color BG = Color.FromArgb(6, 10, 16);
        static readonly Color PANEL = Color.FromArgb(13, 20, 30);
        static readonly Color GOLD = Color.FromArgb(245, 197, 66);
        static readonly Color CYAN = Color.FromArgb(34, 211, 238);
        static readonly Color DIM = Color.FromArgb(93, 111, 130);
        static readonly Color TXT = Color.FromArgb(195, 209, 224);
        readonly Label title;
        readonly Label ver;
        readonly Label status;
        readonly Label note;
        readonly Label languageLabel;
        readonly Button open;
        readonly Button folder;
        readonly ComboBox language;
        int backendState;
        bool languageReady;

        public MainForm()
        {
            Text = "量化引擎 " + Program.Version;
            ClientSize = new Size(460, 264);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = BG;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            title = new Label
            {
                Text = "量 化 引 擎",
                Font = new Font("Microsoft YaHei", 19F, FontStyle.Bold),
                ForeColor = GOLD, BackColor = Color.Transparent,
                Location = new Point(22, 18), AutoSize = true
            };
            ver = new Label
            {
                Text = Program.Version + "   量化交易演练终端",
                Font = new Font("Microsoft YaHei", 8.5F),
                ForeColor = DIM, BackColor = Color.Transparent,
                Location = new Point(26, 58), AutoSize = true
            };
            languageLabel = new Label
            {
                Text = "界面语言 / Language",
                Font = new Font("Microsoft YaHei", 8.5F),
                ForeColor = TXT, BackColor = Color.Transparent,
                Location = new Point(24, 91), AutoSize = true
            };
            language = new ComboBox
            {
                Location = new Point(156, 87), Size = new Size(150, 27),
                DropDownStyle = ComboBoxStyle.DropDownList,
                FlatStyle = FlatStyle.Flat, BackColor = PANEL, ForeColor = TXT,
                Font = new Font("Microsoft YaHei", 9F),
                Cursor = Cursors.Hand
            };
            language.Items.AddRange(new object[] { "简体中文", "English" });
            language.SelectedIndex = Program.UiLanguage == "en-US" ? 1 : 0;
            language.SelectedIndexChanged += delegate
            {
                if (!languageReady) return;
                Program.SaveUiLanguage(language.SelectedIndex == 1 ? "en-US" : "zh-CN");
                ApplyLanguage();
            };
            languageReady = true;

            status = new Label
            {
                Text = "● 正在启动持仓与市场情绪后端…",
                Font = new Font("Microsoft YaHei", 9F),
                ForeColor = CYAN, BackColor = Color.Transparent,
                Location = new Point(24, 123), AutoSize = true
            };

            open = MakeBtn("▶  进入终端", 24, 153, 200, GOLD);
            open.Enabled = false;
            open.Click += delegate
            {
                Program.SaveUiLanguage(language.SelectedIndex == 1 ? "en-US" : "zh-CN");
                Program.OpenTerminal();
            };

            folder = MakeBtn("📁  打开所在文件夹", 236, 153, 200, CYAN);
            folder.Click += delegate
            {
                try { Process.Start("explorer.exe", "/select,\"" + Program.HtmlPath + "\""); }
                catch { }
            };

            note = new Label
            {
                Text = "支持 A 股、基金与美股日线；公开行情不是交易所逐笔，美股通常有延迟。\r\n断网时只能演示本地模拟数据。回测和模拟盘仅供学习，不构成任何投资建议。",
                Font = new Font("Microsoft YaHei", 7.5F),
                ForeColor = Color.FromArgb(70, 86, 102), BackColor = Color.Transparent,
                Location = new Point(24, 199), Size = new Size(412, 48)
            };

            Controls.AddRange(new Control[] { title, ver, languageLabel, language, status, open, folder, note });
            AcceptButton = open;
            ApplyLanguage();
            Shown += async delegate { await StartTerminalAsync(); };
        }

        void ApplyLanguage()
        {
            bool en = Program.UiLanguage == "en-US";
            Text = (en ? "Quant Engine " : "量化引擎 ") + Program.Version;
            title.Text = en ? "QUANT ENGINE" : "量 化 引 擎";
            ver.Text = Program.Version + (en ? "   Quant research terminal" : "   量化交易演练终端");
            open.Text = en ? "▶  ENTER TERMINAL" : "▶  进入终端";
            folder.Text = en ? "📁  OPEN FILE LOCATION" : "📁  打开所在文件夹";
            note.Text = en
                ? "China stocks, funds and US daily bars are supported. Public quotes are not exchange tick data\r\nand US quotes may be delayed. Backtests and paper trading are educational, not investment advice."
                : "支持 A 股、基金与美股日线；公开行情不是交易所逐笔，美股通常有延迟。\r\n断网时只能演示本地模拟数据。回测和模拟盘仅供学习，不构成任何投资建议。";
            if (backendState == 0)
                status.Text = en ? "● Selecting a local backend port..." : "● 正在选择本机后端端口…";
            else if (backendState == 1)
                status.Text = en
                    ? "● Backend connected on port " + Program.BackendPort + ". Ready."
                    : "● 后端已连接（端口 " + Program.BackendPort + "），可以进入终端";
            else if (backendState == 3)
                status.Text = en
                    ? "● Backend is connecting. You can enter the basic terminal now."
                    : "● 后端正在连接，可先进入基础终端";
            else
                status.Text = en
                    ? "● Backend unavailable. Basic terminal remains available."
                    : "● 后端暂不可用，基础终端仍可进入";
        }

        async Task StartTerminalAsync()
        {
            bool started = await Task.Run((Func<bool>)Program.PrepareBackend);
            if (IsDisposed) return;
            if (!started)
            {
                backendState = 2;
                status.ForeColor = Color.FromArgb(255, 110, 96);
                open.Enabled = true;
                ApplyLanguage();
                return;
            }

            backendState = 3;
            status.ForeColor = GOLD;
            open.Enabled = true;
            ApplyLanguage();

            // 依赖首次安装可以在后台继续，不能再阻塞用户进入终端。
            for (int i = 0; i < 120; i++)
            {
                bool ready = await Task.Run((Func<bool>)Program.RefreshBackendStatus);
                if (IsDisposed) return;
                if (ready)
                {
                    backendState = 1;
                    status.ForeColor = CYAN;
                    ApplyLanguage();
                    return;
                }
                await Task.Delay(1000);
            }

            backendState = 2;
            status.ForeColor = Color.FromArgb(255, 110, 96);
            ApplyLanguage();
        }

        Button MakeBtn(string text, int x, int y, int w, Color fg)
        {
            var b = new Button
            {
                Text = text, Location = new Point(x, y), Size = new Size(w, 34),
                FlatStyle = FlatStyle.Flat, BackColor = PANEL, ForeColor = fg,
                Font = new Font("Microsoft YaHei", 9F), Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderColor = Color.FromArgb(31, 45, 61);
            b.FlatAppearance.MouseOverBackColor = Color.FromArgb(20, 30, 44);
            return b;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (var p = new Pen(Color.FromArgb(31, 45, 61)))
                e.Graphics.DrawLine(p, 22, 80, ClientSize.Width - 22, 80);
            using (var b = new SolidBrush(GOLD))
                e.Graphics.FillRectangle(b, 0, 0, ClientSize.Width, 3);
        }
    }
}
