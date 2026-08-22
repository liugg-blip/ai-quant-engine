using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
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

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "QuantEngine");
            HtmlPath = Path.Combine(dir, "QUANT_ENGINE_v10.html");
            BackendScript = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "run.bat");

            try
            {
                Directory.CreateDirectory(dir);
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("QE.html"))
                {
                    if (s == null) throw new Exception("内嵌页面资源缺失");
                    using (FileStream o = File.Create(HtmlPath)) s.CopyTo(o);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("释放终端页面失败：\r\n" + ex.Message,
                    "量化引擎", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            Application.Run(new MainForm());
        }

        public static bool BackendHealthy()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:8770/api/health");
                req.Timeout = 1200;
                req.ReadWriteTimeout = 1200;
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse())
                    return res.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        public static bool EnsureBackend()
        {
            if (BackendHealthy()) return true;
            if (!File.Exists(BackendScript)) return false;
            try
            {
                var p = new ProcessStartInfo
                {
                    FileName = Environment.GetEnvironmentVariable("COMSPEC") ?? "cmd.exe",
                    Arguments = "/d /c call \"" + BackendScript + "\"",
                    WorkingDirectory = Path.GetDirectoryName(BackendScript),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(p);
            }
            catch { return false; }

            // 首次启动可能需要创建虚拟环境并安装依赖。
            for (int i = 0; i < 180; i++)
            {
                if (BackendHealthy()) return true;
                Thread.Sleep(1000);
            }
            return false;
        }

        public static void OpenTerminal()
        {
            try
            {
                Process.Start(new ProcessStartInfo(HtmlPath) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show("无法打开浏览器：\r\n" + ex.Message + "\r\n\r\n请手动打开：\r\n" + HtmlPath,
                    "量化引擎", MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
        readonly Label status;
        readonly Button open;

        public MainForm()
        {
            Text = "量化引擎 " + Program.Version;
            ClientSize = new Size(460, 232);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = BG;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            var title = new Label
            {
                Text = "量 化 引 擎",
                Font = new Font("Microsoft YaHei", 19F, FontStyle.Bold),
                ForeColor = GOLD, BackColor = Color.Transparent,
                Location = new Point(22, 18), AutoSize = true
            };
            var ver = new Label
            {
                Text = Program.Version + "   量化交易演练终端",
                Font = new Font("Microsoft YaHei", 8.5F),
                ForeColor = DIM, BackColor = Color.Transparent,
                Location = new Point(26, 58), AutoSize = true
            };
            status = new Label
            {
                Text = "● 正在启动持仓与市场情绪后端…",
                Font = new Font("Microsoft YaHei", 9F),
                ForeColor = CYAN, BackColor = Color.Transparent,
                Location = new Point(24, 90), AutoSize = true
            };

            open = MakeBtn("↻  重新打开终端", 24, 122, 200, GOLD);
            open.Enabled = false;
            open.Click += delegate { Program.OpenTerminal(); };

            var folder = MakeBtn("📁  打开所在文件夹", 236, 122, 200, CYAN);
            folder.Click += delegate
            {
                try { Process.Start("explorer.exe", "/select,\"" + Program.HtmlPath + "\""); }
                catch { }
            };

            var note = new Label
            {
                Text = "行情为 A 股与场内基金的日线历史数据（非实时逐笔），来自东方财富公开接口，\r\n断网时自动切换本地模拟。回测仅供量化学习与策略演练，不构成任何投资建议。",
                Font = new Font("Microsoft YaHei", 7.5F),
                ForeColor = Color.FromArgb(70, 86, 102), BackColor = Color.Transparent,
                Location = new Point(24, 168), Size = new Size(412, 46)
            };

            Controls.AddRange(new Control[] { title, ver, status, open, folder, note });
            Shown += async delegate { await StartTerminalAsync(); };
        }

        async Task StartTerminalAsync()
        {
            bool ok = await Task.Run((Func<bool>)Program.EnsureBackend);
            if (IsDisposed) return;
            status.Text = ok
                ? "● 后端已连接，持仓与市场情绪功能可用"
                : "● 后端启动失败，持仓与市场情绪暂不可用";
            status.ForeColor = ok ? CYAN : Color.FromArgb(255, 110, 96);
            open.Enabled = true;
            Program.OpenTerminal();
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
