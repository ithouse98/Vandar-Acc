using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        bool created;
        using (var mutex = new Mutex(true, "Local\\VandarPortable", out created))
        {
            if (!created)
            {
                MessageBox.Show("وَندار از قبل کنار ساعت ویندوز در حال اجراست.", "وَندار");
                return;
            }
            try { Application.Run(new VandarTray()); }
            catch (Exception error) { MessageBox.Show(error.Message, "خطای اجرای وَندار", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
    }
}

internal sealed class VandarTray : ApplicationContext
{
    private readonly NotifyIcon icon;
    private readonly ToolStripMenuItem openItem;
    private readonly ToolStripMenuItem tokenItem;
    private readonly System.Windows.Forms.Timer timer;
    private readonly Process server;
    private readonly string url;
    private string token;
    private string lastError;
    private bool ready;
    private bool opened;

    internal VandarTray()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        int port;
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        url = "http://localhost:" + port;

        var menu = new ContextMenuStrip { RightToLeft = RightToLeft.Yes };
        openItem = new ToolStripMenuItem("باز کردن وَندار", null, (s, e) => Open()) { Enabled = false };
        tokenItem = new ToolStripMenuItem("کپی کد راه‌اندازی", null, (s, e) => CopyToken()) { Enabled = false };
        menu.Items.Add(openItem);
        menu.Items.Add(new ToolStripMenuItem("کپی نشانی صفحه", null, (s, e) => Clipboard.SetText(url)));
        menu.Items.Add(tokenItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("بستن وَندار", null, (s, e) => ExitThread()));
        icon = new NotifyIcon { Icon = new Icon(Path.Combine(root, "Vandar.ico")), Text = "وَندار", ContextMenuStrip = menu, Visible = true };
        icon.DoubleClick += (s, e) => Open();

        var start = new ProcessStartInfo(Path.Combine(root, "node.exe"), "\"" + Path.Combine(root, "server.js") + "\"")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        start.EnvironmentVariables["DATA_DIR"] = Path.Combine(root, "data");
        start.EnvironmentVariables["HOST"] = "127.0.0.1";
        start.EnvironmentVariables["PORT"] = port.ToString();
        start.EnvironmentVariables["PUBLIC_ORIGIN"] = url;
        start.EnvironmentVariables["NODE_ENV"] = "portable";
        start.EnvironmentVariables["NODE_OPTIONS"] = "";
        start.EnvironmentVariables["PORTABLE_CONTROL"] = "1";
        server = new Process { StartInfo = start };
        server.OutputDataReceived += (s, e) =>
        {
            if (e.Data == null) return;
            if (e.Data.StartsWith("First-run setup token: ")) token = e.Data.Substring(23);
            if (e.Data.StartsWith("IPS Factor: ")) ready = true;
        };
        server.ErrorDataReceived += (s, e) => { if (e.Data != null) lastError = e.Data; };
        server.Start();
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
        timer = new System.Windows.Forms.Timer { Interval = 300 };
        timer.Tick += (s, e) =>
        {
            if (server.HasExited)
            {
                timer.Stop();
                MessageBox.Show(lastError ?? "سرور وَندار متوقف شد.", "خطای وَندار", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitThread();
                return;
            }
            openItem.Enabled = ready;
            tokenItem.Enabled = token != null;
            if (ready && !opened) { opened = true; Open(); }
        };
        timer.Start();
    }

    private void Open()
    {
        if (!ready) return;
        try
        {
            string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe");
            if (!File.Exists(edge)) edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe");
            string chrome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe");
            if (File.Exists(edge)) Process.Start(new ProcessStartInfo(edge, "--kiosk " + url + " --edge-kiosk-type=fullscreen --no-first-run") { UseShellExecute = true });
            else if (File.Exists(chrome)) Process.Start(new ProcessStartInfo(chrome, "--kiosk " + url) { UseShellExecute = true });
            else Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch { icon.ShowBalloonTip(3000, "وَندار", "مرورگر باز نشد؛ نشانی صفحه را از منو کپی کنید.", ToolTipIcon.Warning); }
    }

    private void CopyToken()
    {
        if (token == null) return;
        Clipboard.SetText(token);
        icon.ShowBalloonTip(2000, "وَندار", "کد راه‌اندازی کپی شد.", ToolTipIcon.Info);
    }

    protected override void ExitThreadCore()
    {
        timer.Stop();
        icon.Visible = false;
        icon.Dispose();
        if (!server.HasExited)
        {
            try
            {
                server.StandardInput.WriteLine("stop");
                server.StandardInput.Flush();
                if (!server.WaitForExit(5000)) server.Kill();
            }
            catch { if (!server.HasExited) server.Kill(); }
        }
        server.Dispose();
        base.ExitThreadCore();
    }
}
