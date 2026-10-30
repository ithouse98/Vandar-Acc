using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

internal sealed class VandarService : ServiceBase
{
    private Process server;

    private VandarService() { ServiceName = "Vandar"; CanStop = true; }

    protected override void OnStart(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
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
        start.EnvironmentVariables["PORT"] = "17432";
        start.EnvironmentVariables["PUBLIC_ORIGIN"] = "http://localhost:17432";
        start.EnvironmentVariables["NODE_ENV"] = "portable";
        start.EnvironmentVariables["NODE_OPTIONS"] = "";
        start.EnvironmentVariables["PORTABLE_CONTROL"] = "1";
        server = new Process { StartInfo = start };
        server.OutputDataReceived += (s, e) => { if (e.Data != null && e.Data.StartsWith("First-run setup token: ")) File.WriteAllText(Path.Combine(root, "data", "setup-token.txt"), e.Data.Substring(23)); };
        server.ErrorDataReceived += (s, e) => { if (e.Data != null) { try { File.AppendAllText(Path.Combine(root, "data", "service-error.log"), e.Data + Environment.NewLine); } catch { } } };
        server.EnableRaisingEvents = true;
        server.Exited += (s, e) => { if (!serverWasStopped) Stop(); };
        server.Start();
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
    }

    private bool serverWasStopped;
    protected override void OnStop()
    {
        serverWasStopped = true;
        if (server == null) return;
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
    }

    private static void Main() { Run(new VandarService()); }
}
