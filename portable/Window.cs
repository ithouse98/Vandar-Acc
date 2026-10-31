using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyCompany("Behrouz Kazemi - IPS-Co")]
[assembly: AssemblyCopyright("Copyright © Behrouz Kazemi - IPS-Co 2026")]

internal static class VandarWindow
{
    [STAThread]
    private static void Main(string[] args)
    {
        string url = args.Length > 0 ? args[0] : "http://localhost:17432";
        Uri address;
        if (!Uri.TryCreate(url, UriKind.Absolute, out address) || address.Host != "localhost" || address.Scheme != "http") return;
        string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe");
        if (!File.Exists(edge)) edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe");
        string chrome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe");
        string browser = File.Exists(edge) ? edge : chrome;
        if (!File.Exists(browser)) { MessageBox.Show("برای اجرای تمام‌صفحه، Microsoft Edge یا Google Chrome لازم است.", "وَندار"); return; }
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vandar", "Browser");
        Directory.CreateDirectory(profile);
        string arguments = "--user-data-dir=\"" + profile + "\" --kiosk " + url + (browser == edge ? " --edge-kiosk-type=fullscreen --no-first-run" : "");
        using (var process = Process.Start(new ProcessStartInfo(browser, arguments) { UseShellExecute = false }))
        {
            var listener = new TcpListener(IPAddress.Loopback, 17433);
            try
            {
                listener.Start();
                while (!process.HasExited)
                {
                    if (!listener.Pending()) { Thread.Sleep(250); continue; }
                    using (var client = listener.AcceptTcpClient())
                    {
                        client.ReceiveTimeout = 3000;
                        var stream = client.GetStream();
                        var buffer = new byte[4096];
                        int count;
                        try { count = stream.Read(buffer, 0, buffer.Length); }
                        catch (IOException) { continue; }
                        bool close = Encoding.ASCII.GetString(buffer, 0, count).StartsWith("POST /close HTTP/1.", StringComparison.Ordinal);
                        byte[] reply = Encoding.ASCII.GetBytes(close ? "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK" : "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        stream.Write(reply, 0, reply.Length);
                        if (!close) continue;
                        Thread.Sleep(500);
                        if (!process.HasExited)
                        {
                            using (var taskkill = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + process.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true })) taskkill.WaitForExit(5000);
                        }
                        return;
                    }
                }
            }
            catch (SocketException) { MessageBox.Show("درگاه کنترل پنجره وَندار اشغال است.", "وَندار"); }
            finally { listener.Stop(); }
        }
    }
}
