using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Vandar Setup")]
[assembly: AssemblyProduct("Vandar")]
[assembly: AssemblyVersion("1.1.0.0")]

internal static class SetupProgram
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm(args.Length > 0 && args[0] == "--preview"));
    }
}

internal sealed class SetupForm : Form
{
    private readonly Label heading;
    private readonly Label message;
    private readonly Label status;
    private readonly ProgressBar progress;
    private readonly TextBox tokenBox;
    private readonly Button action;
    private readonly Button copy;
    private readonly Button close;
    private bool installing;

    internal SetupForm(bool preview)
    {
        Text = "نصب وَندار";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        ClientSize = new Size(760, 460);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(249, 249, 245);
        Font = new Font("Tahoma", 10);

        var brand = new Panel { Dock = DockStyle.Left, Width = 250, BackColor = Color.FromArgb(21, 63, 53) };
        Controls.Add(brand);
        var logo = new PictureBox { Size = new Size(128, 128), Location = new Point(61, 55), SizeMode = PictureBoxSizeMode.Zoom, BackColor = brand.BackColor };
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Vandar.Brand"))
        {
            if (stream != null) logo.Image = new Bitmap(stream);
        }
        brand.Controls.Add(logo);
        brand.Controls.Add(new Label { Text = "وَندار", Location = new Point(20, 214), Size = new Size(210, 58), TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Tahoma", 27, FontStyle.Bold), ForeColor = Color.White });
        brand.Controls.Add(new Label { Text = "مدیریت فروش و فاکتور\nدر فضای شخصی شما", Location = new Point(20, 285), Size = new Size(210, 70), TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.FromArgb(216, 227, 217), Font = new Font("Tahoma", 10) });
        brand.Controls.Add(new Label { Text = "نصب امن و آفلاین", Location = new Point(20, 416), Size = new Size(210, 25), TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.FromArgb(216, 179, 107), Font = new Font("Tahoma", 9) });

        var content = new Panel { Dock = DockStyle.Fill, RightToLeft = RightToLeft.Yes };
        Controls.Add(content);
        content.BringToFront();
        heading = new Label { Text = "وَندار آمادهٔ نصب است", Location = new Point(28, 39), Size = new Size(460, 42), Font = new Font("Tahoma", 18, FontStyle.Bold), ForeColor = Color.FromArgb(25, 58, 48), TextAlign = ContentAlignment.MiddleRight };
        message = new Label { Text = "سرویس پس از روشن شدن ویندوز خودکار اجرا می‌شود.\nمیانبر تمام‌صفحه روی دسکتاپ ساخته خواهد شد.\nاطلاعات حساب هنگام به‌روزرسانی محفوظ می‌ماند.", Location = new Point(28, 102), Size = new Size(450, 92), ForeColor = Color.FromArgb(76, 89, 80), TextAlign = ContentAlignment.TopRight };
        status = new Label { Text = "محل نصب: ProgramData\\Vandar", Location = new Point(28, 210), Size = new Size(450, 34), ForeColor = Color.FromArgb(88, 103, 94), TextAlign = ContentAlignment.MiddleRight };
        progress = new ProgressBar { Location = new Point(28, 265), Size = new Size(450, 14), Minimum = 0, Maximum = 100, Value = 0 };
        tokenBox = new TextBox { Location = new Point(28, 252), Size = new Size(450, 33), ReadOnly = true, RightToLeft = RightToLeft.No, Visible = false, Font = new Font("Consolas", 11) };
        action = new Button { Text = "نصب و اجرای سرویس", Location = new Point(307, 351), Size = new Size(171, 48), BackColor = Color.FromArgb(30, 91, 71), ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Font = new Font("Tahoma", 10, FontStyle.Bold) };
        action.FlatAppearance.BorderSize = 0;
        action.Click += (s, e) => BeginInstall();
        if (Directory.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Vandar")))
        {
            heading.Text = "به‌روزرسانی وَندار";
            action.Text = "به‌روزرسانی و اجرای سرویس";
        }
        if (preview) { action.Enabled = false; action.Text = "پیش‌نمایش نصب‌کننده"; }
        copy = new Button { Text = "کپی کد راه‌اندازی", Location = new Point(170, 351), Size = new Size(138, 48), BackColor = Color.FromArgb(231, 242, 234), ForeColor = Color.FromArgb(30, 91, 71), FlatStyle = FlatStyle.Flat, Visible = false };
        copy.FlatAppearance.BorderSize = 0;
        copy.Click += (s, e) => { Clipboard.SetText(tokenBox.Text); MessageBox.Show(this, "کد راه‌اندازی کپی شد. پس از بستن نصب‌کننده، از میانبر دسکتاپ وارد وَندار شوید.", "وَندار"); };
        close = new Button { Text = "انصراف", Location = new Point(28, 351), Size = new Size(116, 48), FlatStyle = FlatStyle.Flat };
        close.Click += (s, e) => Close();
        content.Controls.Add(heading);
        content.Controls.Add(message);
        content.Controls.Add(status);
        content.Controls.Add(progress);
        content.Controls.Add(tokenBox);
        content.Controls.Add(action);
        content.Controls.Add(copy);
        content.Controls.Add(close);
        FormClosing += (s, e) => { if (installing) e.Cancel = true; };
    }

    private void UpdateStep(string text, int percent)
    {
        BeginInvoke((Action)(() => { status.Text = text; progress.Value = Math.Max(0, Math.Min(100, percent)); }));
    }

    private void BeginInstall()
    {
        if (installing) return;
        installing = true;
        action.Enabled = false;
        close.Enabled = false;
        heading.Text = "در حال نصب وَندار";
        var worker = new Thread(() =>
        {
            try
            {
                string token = Install();
                BeginInvoke((Action)(() =>
                {
                    installing = false;
                    heading.Text = "وَندار نصب و اجرا شد";
                    message.Text = token == null
                        ? "سرویس فعال است. برای باز کردن برنامه، میانبر وَندار را روی دسکتاپ بزنید."
                        : "کد زیر را کپی کنید. سپس میانبر وَندار روی دسکتاپ را باز کنید و حساب مدیر را بسازید.";
                    status.Text = token == null ? "آمادهٔ استفاده" : "کد راه‌اندازی نخستین اجرا";
                    progress.Visible = false;
                    tokenBox.Visible = token != null;
                    tokenBox.Text = token ?? "";
                    copy.Visible = token != null;
                    action.Visible = false;
                    close.Text = "پایان";
                    close.Enabled = true;
                }));
            }
            catch (Exception error)
            {
                BeginInvoke((Action)(() =>
                {
                    installing = false;
                    heading.Text = "نصب کامل نشد";
                    message.Text = error.Message;
                    status.Text = "فایل‌های موجود در ProgramData\\Vandar را پیش از تلاش دوباره بررسی کنید.";
                    action.Visible = false;
                    close.Text = "بستن";
                    close.Enabled = true;
                }));
            }
        });
        worker.IsBackground = true;
        worker.Start();
    }

    private string Install()
    {
        string temporary = Path.Combine(Path.GetTempPath(), "VandarSetup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        try
        {
            UpdateStep("در حال آماده‌سازی فایل‌ها…", 8);
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Vandar.Payload"))
            {
                if (stream == null) throw new InvalidOperationException("بستهٔ نصب در فایل Setup پیدا نشد.");
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    int index = 0;
                    foreach (var entry in archive.Entries)
                    {
                        string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                        string destination = Path.GetFullPath(Path.Combine(temporary, relative));
                        if (!destination.StartsWith(temporary + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("مسیر نامعتبر در بستهٔ نصب.");
                        if (relative.EndsWith(Path.DirectorySeparatorChar.ToString()))
                        {
                            Directory.CreateDirectory(destination);
                        }
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(destination));
                            using (var input = entry.Open())
                            using (var output = File.Create(destination)) input.CopyTo(output);
                        }
                        index++;
                        if (index % 40 == 0) UpdateStep("در حال استخراج فایل‌ها…", 10 + index * 42 / archive.Entries.Count);
                    }
                }
            }
            string[] directories = Directory.GetDirectories(temporary);
            if (directories.Length != 1) throw new InvalidDataException("ساختار بستهٔ نصب معتبر نیست.");
            string payload = directories[0];
            string data = Path.Combine(payload, "data");
            if (!Directory.Exists(data) || Directory.GetFileSystemEntries(data).Length != 0) throw new InvalidDataException("بستهٔ نصب نباید دادهٔ شخصی داشته باشد.");
            if (!File.Exists(Path.Combine(payload, "VandarService.exe")) || !File.Exists(Path.Combine(payload, "Vandar.ico"))) throw new InvalidDataException("فایل‌های سرویس یا آیکن ناقص‌اند.");
            bool upgrade = Directory.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Vandar"));
            UpdateStep(upgrade ? "در حال به‌روزرسانی سرویس…" : "در حال نصب سرویس ویندوز…", 65);
            var start = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(payload, "Install-Service.ps1") + "\" " + (upgrade ? "-Upgrade" : "-Fresh"))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(start))
            {
                string output = process.StandardOutput.ReadToEnd();
                string errors = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException(String.IsNullOrWhiteSpace(errors) ? output : errors);
            }
            UpdateStep("در حال آماده‌سازی نخستین اجرا…", 92);
            bool ready = false;
            for (int i = 0; i < 60 && !ready; i++)
            {
                try
                {
                    var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:17432/api/session");
                    request.Timeout = 1000;
                    using (var response = (HttpWebResponse)request.GetResponse()) ready = response.StatusCode == HttpStatusCode.OK;
                }
                catch (WebException) { Thread.Sleep(250); }
            }
            if (!ready) throw new InvalidOperationException("سرویس نصب شد، اما سرور آماده نشد. گزارش خطا را در ProgramData\\Vandar\\data\\service-error.log بررسی کنید.");
            string tokenFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Vandar", "data", "setup-token.txt");
            if (!upgrade) for (int i = 0; i < 40 && !File.Exists(tokenFile); i++) Thread.Sleep(250);
            UpdateStep("نصب کامل شد", 100);
            return !upgrade && File.Exists(tokenFile) ? File.ReadAllText(tokenFile).Trim() : null;
        }
        finally
        {
            string tempRoot = Path.GetFullPath(Path.GetTempPath());
            if (temporary.StartsWith(tempRoot, StringComparison.OrdinalIgnoreCase))
            {
                try { Directory.Delete(temporary, true); } catch { }
            }
        }
    }
}
