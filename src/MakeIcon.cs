using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

// 生成 app.ico（256x256，PNG 载荷的 ICO 容器）
static class MakeIcon
{
    static void Main(string[] a)
    {
        string outPath = a.Length > 0 ? a[0] : "app.ico";
        const int S = 256;
        using (var bmp = new Bitmap(S, S, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                g.Clear(Color.Transparent);

                // 圆角深色底 + 金边
                int r = 44;
                using (var path = new GraphicsPath())
                {
                    path.AddArc(5, 5, r, r, 180, 90);
                    path.AddArc(S - 5 - r, 5, r, r, 270, 90);
                    path.AddArc(S - 5 - r, S - 5 - r, r, r, 0, 90);
                    path.AddArc(5, S - 5 - r, r, r, 90, 90);
                    path.CloseFigure();
                    using (var b = new SolidBrush(Color.FromArgb(255, 6, 10, 16))) g.FillPath(b, path);
                    using (var p = new Pen(Color.FromArgb(255, 245, 197, 66), 6f)) g.DrawPath(p, path);
                }

                Color red = Color.FromArgb(255, 255, 59, 71);
                Color green = Color.FromArgb(255, 18, 209, 138);
                // x, 影线高, 影线低, 实体顶, 实体高, 颜色
                int[][] bars = {
                    new[]{ 52, 168, 206, 182, 20, 0 },
                    new[]{ 90, 118, 192, 132, 44, 1 },
                    new[]{128, 136, 178, 148, 22, 0 },
                    new[]{166,  72, 152,  96, 46, 1 },
                    new[]{204,  92, 166, 104, 40, 1 }
                };
                foreach (var b in bars)
                {
                    Color c = b[5] == 1 ? red : green;
                    using (var pen = new Pen(c, 5f)) g.DrawLine(pen, b[0], b[1], b[0], b[2]);
                    using (var br = new SolidBrush(c)) g.FillRectangle(br, b[0] - 11, b[3], 22, b[4]);
                }

                // MA20 金色均线
                using (var gold = new Pen(Color.FromArgb(255, 245, 197, 66), 6f))
                {
                    gold.StartCap = LineCap.Round; gold.EndCap = LineCap.Round;
                    gold.LineJoin = LineJoin.Round;
                    g.DrawLines(gold, new[] {
                        new Point(34,196), new Point(90,158), new Point(128,164),
                        new Point(166,110), new Point(222,78)
                    });
                }

                using (var f = new Font("Consolas", 30f, FontStyle.Bold))
                using (var br = new SolidBrush(Color.FromArgb(255, 34, 211, 238)))
                using (var sf = new StringFormat { Alignment = StringAlignment.Center })
                    g.DrawString("QE", f, br, new RectangleF(0, 202, S, 50), sf);
            }

            byte[] png;
            using (var ms = new MemoryStream()) { bmp.Save(ms, ImageFormat.Png); png = ms.ToArray(); }

            using (var fs = File.Create(outPath))
            using (var w = new BinaryWriter(fs))
            {
                w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)1);   // ICONDIR
                w.Write((byte)0); w.Write((byte)0);                            // 256 记为 0
                w.Write((byte)0); w.Write((byte)0);
                w.Write((ushort)1); w.Write((ushort)32);
                w.Write((uint)png.Length); w.Write((uint)22);
                w.Write(png);
            }
        }
        Console.WriteLine("ICON OK -> " + Path.GetFullPath(outPath) + "  " + new FileInfo(outPath).Length + " bytes");
    }
}
