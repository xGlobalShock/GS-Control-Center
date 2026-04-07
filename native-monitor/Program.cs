// GCMonitor — Self-contained hardware monitoring sidecar for GS Control Center
// Outputs JSON lines to stdout for Electron consumption.
// No .NET runtime needed on target machine (self-contained single-file publish).

using System.Diagnostics;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

namespace GCMonitor;

#region P/Invoke

static partial class NativeMethods
{
    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    // ── GetPerformanceInfo — RAM cached (SystemCache pages) ──
    [StructLayout(LayoutKind.Sequential)]
    public struct PERFORMANCE_INFORMATION
    {
        public uint cb;
        public UIntPtr CommitTotal;
        public UIntPtr CommitLimit;
        public UIntPtr CommitPeak;
        public UIntPtr PhysicalTotal;
        public UIntPtr PhysicalAvailable;
        public UIntPtr SystemCache;
        public UIntPtr KernelTotal;
        public UIntPtr KernelPaged;
        public UIntPtr KernelNonpaged;
        public UIntPtr PageSize;
        public uint HandleCount;
        public uint ProcessCount;
        public uint ThreadCount;
    }

    [DllImport("psapi.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetPerformanceInfo(out PERFORMANCE_INFORMATION pPerformanceInformation, uint cb);
}

#endregion

#region LHM Visitor

public class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer) => computer.Traverse(this);

    public void VisitHardware(IHardware hardware)
    {
        hardware.Update();
        foreach (var sub in hardware.SubHardware)
            sub.Accept(this);
    }

    public void VisitSensor(ISensor sensor) { }
    public void VisitParameter(IParameter parameter) { }
}

#endregion

public static class Program
{
    private static volatile bool _running = true;

    // Stdout lock — prevents JSON line interleaving between main loop and hwinfo thread
    private static readonly object _stdoutLock = new();

    // One-time diagnostics flag (logs all CPU temp sensor names on first tick)
    private static bool _cpuTempDiagLogged = false;

    // Ping state (written by background thread, read by main loop)
    private static double _latencyMs;
    private static double _packetLoss = -1;
    private static readonly object _pingLock = new();
    private static readonly Queue<bool> _pingResults = new(100);
    private const int PingWindowSize = 100;
    private const int MinSamplesForLoss = 5;

    // Game-representative ping targets — real data centers, NOT anycast CDN.
    // Anycast (1.1.1.1, 8.8.8.8) gives 1-5ms because edge nodes are in every city.
    // Game servers run in specific DCs. These Akamai/Linode speedtest servers are in
    // the same data centers where game servers actually host (AWS, Azure, Vultr, etc.).
    // We round-robin ping all targets, track per-target rolling average, and report
    // the BEST (lowest) — which is what a game matchmaker would connect you to.
    private static readonly string[] PingTargets = {
        "speedtest.newark.linode.com",       // US East  (New Jersey)
        "speedtest.dallas.linode.com",       // US Central (Texas)
        "speedtest.fremont.linode.com",      // US West  (California)
        "speedtest.london.linode.com",       // EU West  (London)
        "speedtest.frankfurt.linode.com",    // EU Central (Frankfurt)
        "speedtest.singapore.linode.com",   // Asia (Singapore)
    };
    private static readonly double[] _targetAvg = new double[6];   // rolling avg per target
    private static readonly int[] _targetHits = new int[6];        // samples per target

    // PDH CPU clock fallback (lightweight perf counters, no admin needed)
    // base_freq × (% Processor Performance / 100) = actual boosted speed (like Task Manager)
    private static PerformanceCounter? _cpuFreqCounter;
    private static PerformanceCounter? _cpuPerfCounter;
    private static bool _cpuFreqCounterFailed;

    // GPU fan control state
    private static IControl? _gpuFanControl;
    private static readonly object _fanLock = new();
    private static int _pendingFanSpeed = -1; // -1 = no change, 0 = auto, 1-100 = manual %

    public static void Main(string[] args)
    {
        // Graceful shutdown on Ctrl+C
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; _running = false; };

        // Exit when stdin closes (Electron parent process died)
        var stdinThread = new Thread(() =>
        {
            try
            {
                using var reader = new StreamReader(Console.OpenStandardInput());
                string? line;
                while ((line = reader.ReadLine()) != null && _running)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try
                    {
                        var cmd = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(line);
                        if (cmd != null && cmd.TryGetValue("type", out var t))
                        {
                            var cmdType = t.GetString();
                            if (cmdType == "set-fan" && cmd.TryGetValue("speed", out var sp))
                            {
                                var speed = sp.GetInt32(); // 0 = auto, 1-100 = manual
                                lock (_fanLock) { _pendingFanSpeed = speed; }
                                Log($"FAN_CMD_RECV:{speed}");
                            }
                        }
                    }
                    catch { /* malformed JSON — ignore */ }
                }
            }
            catch { /* stdin closed */ }
            _running = false;
        }) { IsBackground = true, Name = "StdinWatcher" };
        stdinThread.Start();

        // Admin check
        bool isAdmin = false;
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            isAdmin = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch { /* non-critical */ }
        Log($"ADMIN={isAdmin}");

        // Initialize LibreHardwareMonitor
        Computer? computer = null;
        var visitor = new UpdateVisitor();

        try
        {
            computer = new Computer
            {
                IsCpuEnabled = true,
                IsGpuEnabled = true,
                IsMemoryEnabled = true,
                IsMotherboardEnabled = true,
                IsNetworkEnabled = true,
                IsStorageEnabled = true,
                IsControllerEnabled = true,
            };
            computer.Open();
            Log("LHM_READY");
        }
        catch (Exception ex)
        {
            Log($"LHM_FAIL:{ex.Message}");
            // Continue — we can still provide RAM, ping, process count, uptime
        }

        // First LHM update + emit hardware names
        if (computer != null)
        {
            try
            {
                computer.Accept(visitor);
                EmitInitMessage(computer);
            }
            catch (Exception ex)
            {
                Log($"INIT_ERR:{ex.Message}");
                // Emit a minimal init so Electron isn't stuck waiting
                EmitMinimalInit();
            }
        }
        else
        {
            EmitMinimalInit();
        }

        // Start ping thread
        var pingThread = new Thread(PingLoop)
        {
            IsBackground = true,
            Priority = ThreadPriority.BelowNormal,
            Name = "PingLoop"
        };
        pingThread.Start();

        // Start hardware info collection on background thread (fast ~1-2s, then slow ~5-10s)
        var hwinfoThread = new Thread(() =>
        {
            try
            {
                var fastInfo = HardwareInfoCollector.CollectFast(computer);
                var json = JsonSerializer.Serialize(fastInfo);
                lock (_stdoutLock) { Console.WriteLine(json); Console.Out.Flush(); }
                Log("HWINFO_FAST_DONE");

                // Slow fetch in background
                try
                {
                    var slowUpdates = HardwareInfoCollector.CollectSlow(fastInfo);
                    if (slowUpdates.Count > 1) // more than just "type" key
                    {
                        var slowJson = JsonSerializer.Serialize(slowUpdates);
                        lock (_stdoutLock) { Console.WriteLine(slowJson); Console.Out.Flush(); }
                        Log("HWINFO_SLOW_DONE");
                    }
                }
                catch (Exception ex) { Log($"HWINFO_SLOW_ERR:{ex.Message}"); }
            }
            catch (Exception ex) { Log($"HWINFO_FAST_ERR:{ex.Message}"); }
        })
        {
            IsBackground = true,
            Priority = ThreadPriority.BelowNormal,
            Name = "HWInfoCollector"
        };
        hwinfoThread.Start();

        // Main polling loop — 500ms cycle
        while (_running)
        {
            try
            {
                if (computer != null)
                    computer.Accept(visitor);

                var snapshot = CollectSnapshot(computer);
                lock (_stdoutLock) { Console.WriteLine(snapshot); Console.Out.Flush(); }
            }
            catch (Exception ex)
            {
                Log($"POLL_ERR:{ex.Message}");
            }

            // Sleep 500ms total, but check _running every 100ms for quick shutdown
            for (int i = 0; i < 5 && _running; i++)
                Thread.Sleep(100);
        }

        // Reset GPU fan to auto before shutting down
        try { _gpuFanControl?.SetDefault(); } catch { /* best-effort */ }
        try { computer?.Close(); } catch { /* best-effort cleanup */ }
        Log("SHUTDOWN");
    }

    private static void EmitInitMessage(Computer computer)
    {
        string cpuName = "", gpuName = "";

        foreach (var hw in computer.Hardware)
        {
            if (hw.HardwareType == HardwareType.Cpu && string.IsNullOrEmpty(cpuName))
                cpuName = hw.Name;

            if ((hw.HardwareType == HardwareType.GpuNvidia ||
                 hw.HardwareType == HardwareType.GpuAmd ||
                 hw.HardwareType == HardwareType.GpuIntel)
                && string.IsNullOrEmpty(gpuName))
                gpuName = hw.Name;
        }

        // RAM total via kernel32
        double ramTotalGB = 0;
        var mem = new NativeMethods.MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<NativeMethods.MEMORYSTATUSEX>() };
        if (NativeMethods.GlobalMemoryStatusEx(ref mem))
            ramTotalGB = Math.Round(mem.ullTotalPhys / (1024.0 * 1024 * 1024));

        var json = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["type"] = "init",
            ["cpuName"] = cpuName,
            ["gpuName"] = gpuName,
            ["ramTotalGB"] = ramTotalGB,
        });

        lock (_stdoutLock) { Console.WriteLine(json); Console.Out.Flush(); }
    }

    private static void EmitMinimalInit()
    {
        double ramTotalGB = 0;
        var mem = new NativeMethods.MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<NativeMethods.MEMORYSTATUSEX>() };
        if (NativeMethods.GlobalMemoryStatusEx(ref mem))
            ramTotalGB = Math.Round(mem.ullTotalPhys / (1024.0 * 1024 * 1024));

        var json = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["type"] = "init",
            ["cpuName"] = "",
            ["gpuName"] = "",
            ["ramTotalGB"] = ramTotalGB,
        });

        lock (_stdoutLock) { Console.WriteLine(json); Console.Out.Flush(); }
    }

    private static string CollectSnapshot(Computer? computer)
    {
        // ── CPU metrics ──
        double cpuTotal = -1, cpuTemp = -1, cpuClock = -1, mbCpuTemp = -1;
        double cpuPower = -1, cpuVoltage = -1;
        var perCoreCpu = new List<double>();

        // ── GPU metrics ──
        double gpuTemp = -1, gpuUsage = -1, gpuVramUsed = -1, gpuVramTotal = -1;
        double gpuClock = -1, gpuFan = -1, gpuFanRpm = -1;
        double gpuPower = -1, gpuMemClock = -1, gpuHotSpot = -1, gpuMemTemp = -1, gpuVoltage = -1;

        // ── Disk metrics ──
        double diskTemp = -1, diskLife = -1;

        // ── Network ──
        double netRx = 0, netTx = 0;

        // ── Disk I/O ──
        double diskRead = 0, diskWrite = 0;

        if (computer != null)
        {
            foreach (var hw in computer.Hardware)
            {
                // Collect all sensors including sub-hardware
                var allSensors = new List<ISensor>(hw.Sensors);
                foreach (var sub in hw.SubHardware)
                    allSensors.AddRange(sub.Sensors);

                switch (hw.HardwareType)
                {
                    case HardwareType.Cpu:
                        ExtractCpuMetrics(allSensors, ref cpuTotal, ref cpuTemp, ref cpuClock,
                            ref cpuPower, ref cpuVoltage, perCoreCpu);
                        break;

                    case HardwareType.Motherboard:
                        ExtractMoboTemp(allSensors, ref mbCpuTemp);
                        break;

                    case HardwareType.GpuNvidia:
                    case HardwareType.GpuAmd:
                    case HardwareType.GpuIntel:
                        ExtractGpuMetrics(allSensors, ref gpuTemp, ref gpuUsage, ref gpuVramUsed,
                            ref gpuVramTotal, ref gpuClock, ref gpuFan, ref gpuFanRpm,
                            ref gpuPower, ref gpuMemClock, ref gpuHotSpot, ref gpuMemTemp, ref gpuVoltage);
                        // Capture fan control handle (once)
                        if (_gpuFanControl == null)
                        {
                            foreach (var s in allSensors)
                            {
                                if (s.SensorType == SensorType.Control && s.Control != null)
                                {
                                    _gpuFanControl = s.Control;
                                    Log($"FAN_CTRL_FOUND:{s.Name}");
                                    break;
                                }
                            }
                        }
                        break;

                    case HardwareType.Network:
                        // Network sensors are on the hardware directly (no sub-hardware)
                        foreach (var s in hw.Sensors)
                        {
                            if (!s.Value.HasValue || s.SensorType != SensorType.Throughput) continue;
                            if (s.Name == "Download Speed") netRx += s.Value.Value;
                            else if (s.Name == "Upload Speed") netTx += s.Value.Value;
                        }
                        break;

                    case HardwareType.Storage:
                        foreach (var s in allSensors)
                        {
                            if (!s.Value.HasValue) continue;
                            if (s.SensorType == SensorType.Throughput)
                            {
                                if (s.Name == "Read Rate") diskRead += s.Value.Value;
                                else if (s.Name == "Write Rate") diskWrite += s.Value.Value;
                            }
                            else if (s.SensorType == SensorType.Temperature && diskTemp < 0)
                            {
                                if (s.Value.Value > 0 && s.Value.Value < 120)
                                    diskTemp = Math.Round(s.Value.Value, 1);
                            }
                            else if (s.SensorType == SensorType.Level && s.Name.Contains("Remaining") && diskLife < 0)
                            {
                                diskLife = Math.Round(s.Value.Value, 1);
                            }
                        }
                        break;
                }
            }
        }

        // Fallback chain for CPU temperature
        if (cpuTemp < 0 && mbCpuTemp > 0) cpuTemp = mbCpuTemp;

        // Last resort: WMI ACPI thermal zone (works on many AMD systems where LHM can't read temps)
        if (cpuTemp < 0)
        {
            try
            {
                using var tz = new ManagementObjectSearcher(@"root\WMI",
                    "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature");
                foreach (ManagementObject obj in tz.Get())
                {
                    var kelvinTenths = Convert.ToDouble(obj["CurrentTemperature"]);
                    var celsius = (kelvinTenths / 10.0) - 273.15;
                    if (celsius > 10 && celsius < 120)
                    {
                        cpuTemp = Math.Round(celsius, 1);
                        Log($"ACPI_THERMAL:{cpuTemp}C");
                        break;
                    }
                }
            }
            catch { /* WMI thermal zone not available — estimation will kick in on JS side */ }
        }

        // Process pending GPU fan control command
        int fanCmd;
        lock (_fanLock) { fanCmd = _pendingFanSpeed; _pendingFanSpeed = -1; }
        if (fanCmd >= 0)
        {
            if (_gpuFanControl != null)
            {
                try
                {
                    if (fanCmd == 0)
                    {
                        _gpuFanControl.SetDefault(); // auto mode
                        Log("FAN_SET:auto");
                    }
                    else
                    {
                        _gpuFanControl.SetSoftware(Math.Clamp(fanCmd, 0, 100));
                        Log($"FAN_SET:{fanCmd}%");
                    }
                }
                catch (Exception ex) { Log($"FAN_CTRL_ERR:{ex.Message}"); }
            }
            else
            {
                Log("FAN_CTRL_NONE:no IControl handle found");
            }
        }

        // Fallback: PDH perf counters for real-time CPU speed when LHM can't read it (no admin)
        // base_freq × (% Processor Performance / 100) = actual boosted speed (like Task Manager)
        if (cpuClock < 0 && !_cpuFreqCounterFailed)
        {
            try
            {
                _cpuFreqCounter ??= new PerformanceCounter(
                    "Processor Information", "Processor Frequency", "_Total");
                _cpuPerfCounter ??= new PerformanceCounter(
                    "Processor Information", "% Processor Performance", "_Total");
                var baseMhz = _cpuFreqCounter.NextValue();
                var perfPct = _cpuPerfCounter.NextValue();
                if (baseMhz > 0 && perfPct > 0)
                    cpuClock = Math.Round(baseMhz * perfPct / 100.0);
                else if (baseMhz > 0)
                    cpuClock = Math.Round(baseMhz);
            }
            catch { _cpuFreqCounterFailed = true; }
        }

        // ── RAM via kernel32 ──
        double ramPct = 0, ramUsedGB = 0, ramTotalGB = 0, ramAvailableGB = 0, ramCachedGB = 0;
        var memInfo = new NativeMethods.MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<NativeMethods.MEMORYSTATUSEX>() };
        if (NativeMethods.GlobalMemoryStatusEx(ref memInfo))
        {
            ramPct = memInfo.dwMemoryLoad;
            ramTotalGB = Math.Round(memInfo.ullTotalPhys / (1024.0 * 1024 * 1024), 1);
            ramAvailableGB = Math.Round(memInfo.ullAvailPhys / (1024.0 * 1024 * 1024), 1);
            ramUsedGB = Math.Round(ramTotalGB - ramAvailableGB, 1);
            // Cached = Available - Free (standby + modified pages)
            // Free pages from PageFile info: ullAvailPageFile minus ullAvailPhys gives a rough idea,
            // but the cleanest approach: cached = available - free, where free ≈ 0 on busy systems.
            // More accurate: use PERFORMANCE_INFORMATION via GetPerformanceInfo
        }

        // Cached RAM via GetPerformanceInfo (no admin, no WMI, lightweight kernel call)
        if (NativeMethods.GetPerformanceInfo(out var perfInfo, (uint)Marshal.SizeOf<NativeMethods.PERFORMANCE_INFORMATION>()))
        {
            var pageSize = (long)perfInfo.PageSize;
            var totalPhys = (long)perfInfo.PhysicalTotal * pageSize;
            var availPhys = (long)perfInfo.PhysicalAvailable * pageSize;
            var cacheBytes = (long)perfInfo.SystemCache * pageSize;
            ramCachedGB = Math.Round(cacheBytes / (1024.0 * 1024 * 1024), 1);
        }

        // ── Disk usage (C:) ──
        double diskPct = 0;
        try
        {
            var cDrive = new DriveInfo("C");
            if (cDrive.IsReady)
                diskPct = Math.Round((1.0 - (double)cDrive.AvailableFreeSpace / cDrive.TotalSize) * 100, 1);
        }
        catch { /* drive not available */ }

        // ── Process count ──
        int processCount = 0;
        try { processCount = Process.GetProcesses().Length; }
        catch { /* non-critical */ }

        // ── Uptime ──
        long uptimeSec = Environment.TickCount64 / 1000;
        long days = uptimeSec / 86400;
        long hours = (uptimeSec % 86400) / 3600;
        long mins = (uptimeSec % 3600) / 60;

        // ── Ping (from background thread) ──
        double lat, loss;
        lock (_pingLock)
        {
            lat = _latencyMs;
            loss = _packetLoss;
        }

        // ── Build JSON payload ──
        var dict = new Dictionary<string, object?>
        {
            ["type"] = "data",
            ["cpu"] = cpuTotal >= 0 ? Math.Round(cpuTotal, 1) : -1,
            ["perCoreCpu"] = perCoreCpu.ToArray(),
            ["cpuClock"] = cpuClock >= 0 ? cpuClock : -1,
            ["cpuPower"] = cpuPower >= 0 ? cpuPower : -1,
            ["cpuVoltage"] = cpuVoltage >= 0 ? cpuVoltage : -1,
            ["temperature"] = cpuTemp >= 0 ? cpuTemp : -1,
            ["tempSource"] = cpuTemp >= 0 ? "lhm" : "none",
            ["gpuTemp"] = gpuTemp,
            ["gpuUsage"] = gpuUsage,
            ["gpuVramUsed"] = gpuVramUsed,
            ["gpuVramTotal"] = gpuVramTotal,
            ["gpuClock"] = gpuClock,
            ["gpuFan"] = gpuFan,
            ["gpuFanRpm"] = gpuFanRpm,
            ["gpuPower"] = gpuPower,
            ["gpuMemClock"] = gpuMemClock,
            ["gpuHotSpot"] = gpuHotSpot,
            ["gpuMemTemp"] = gpuMemTemp,
            ["gpuVoltage"] = gpuVoltage,
            ["gpuFanControllable"] = _gpuFanControl != null,
            ["ram"] = ramPct,
            ["ramUsedGB"] = ramUsedGB,
            ["ramTotalGB"] = ramTotalGB,
            ["ramAvailableGB"] = ramAvailableGB,
            ["ramCachedGB"] = ramCachedGB,
            ["disk"] = diskPct,
            ["diskReadSpeed"] = Math.Round(diskRead),
            ["diskWriteSpeed"] = Math.Round(diskWrite),
            ["diskTemp"] = diskTemp,
            ["diskLife"] = diskLife,
            ["networkDown"] = Math.Round(netRx),
            ["networkUp"] = Math.Round(netTx),
            ["latencyMs"] = lat,
            ["packetLoss"] = loss,
            ["processCount"] = processCount,
            ["systemUptime"] = $"{days}d {hours}h {mins}m",
            ["lhmReady"] = computer != null,
            ["ts"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };

        return JsonSerializer.Serialize(dict);
    }

    #region Sensor Extractors

    private static void ExtractCpuMetrics(List<ISensor> sensors, ref double cpuTotal,
        ref double cpuTemp, ref double cpuClock,
        ref double cpuPower, ref double cpuVoltage, List<double> perCoreCpu)
    {
        // One-time: log all CPU temperature sensor names for diagnostics
        if (!_cpuTempDiagLogged)
        {
            _cpuTempDiagLogged = true;
            foreach (var s in sensors)
            {
                if (s.SensorType == SensorType.Temperature)
                    Log($"CPU_TEMP_SENSOR:{s.Name}={s.Value?.ToString() ?? "null"}");
            }
        }

        foreach (var s in sensors)
        {
            if (!s.Value.HasValue) continue;
            var v = s.Value.Value;

            if (s.SensorType == SensorType.Temperature)
            {
                var name = s.Name;
                // Priority: CPU Package > Tctl/Tdie > Core (AMD) > Core Average > Core Max > first Core # > any
                if (name == "CPU Package" || name.Contains("Tctl") || name.Contains("Tdie"))
                    cpuTemp = Math.Round(v, 1);
                else if ((name == "Core" || name == "CPU") && cpuTemp < 0)
                    cpuTemp = Math.Round(v, 1);
                else if (name == "Core Average" && cpuTemp < 0)
                    cpuTemp = Math.Round(v, 1);
                else if (name == "Core Max" && cpuTemp < 0)
                    cpuTemp = Math.Round(v, 1);
                else if ((name.StartsWith("Core #") || name.StartsWith("CCD")) && cpuTemp < 0 && v > 0 && v < 150)
                    cpuTemp = Math.Round(v, 1);
                else if (cpuTemp < 0 && v > 0 && v < 150)
                    cpuTemp = Math.Round(v, 1);
            }
            else if (s.SensorType == SensorType.Load)
            {
                if (s.Name == "CPU Total")
                    cpuTotal = Math.Round(v, 1);
                else if (s.Name.StartsWith("CPU Core #"))
                    perCoreCpu.Add(Math.Round(v, 1));
            }
            else if (s.SensorType == SensorType.Clock && s.Name.StartsWith("Core #"))
            {
                if (v > cpuClock) cpuClock = Math.Round(v);
            }
            else if (s.SensorType == SensorType.Power)
            {
                if (s.Name == "CPU Package" && v > 0)
                    cpuPower = Math.Round(v, 1);
                else if (s.Name.Contains("Package") && cpuPower < 0 && v > 0)
                    cpuPower = Math.Round(v, 1);
            }
            else if (s.SensorType == SensorType.Voltage)
            {
                if ((s.Name == "CPU Core" || s.Name == "Core #1") && cpuVoltage < 0 && v > 0)
                    cpuVoltage = Math.Round(v, 3);
            }
        }
    }

    private static void ExtractMoboTemp(List<ISensor> sensors, ref double mbCpuTemp)
    {
        double genericTemp = -1;
        foreach (var s in sensors)
        {
            if (!s.Value.HasValue || s.SensorType != SensorType.Temperature) continue;
            var v = s.Value.Value;
            if (v <= 0 || v >= 150) continue;
            var name = s.Name;
            // Prefer named CPU/Tctl/Core sensor
            if (name.Contains("CPU") || name.Contains("Tctl") || name.Contains("Core"))
            {
                mbCpuTemp = Math.Round(v, 1);
            }
            // Track first valid generic temp (e.g. SuperIO "Temperature #1") as fallback
            else if (genericTemp < 0 && v >= 15 && v <= 120)
            {
                genericTemp = Math.Round(v, 1);
            }
        }
        // If no named CPU sensor, use the first generic SuperIO temp
        if (mbCpuTemp < 0 && genericTemp > 0)
            mbCpuTemp = genericTemp;
    }

    private static void ExtractGpuMetrics(List<ISensor> sensors,
        ref double gpuTemp, ref double gpuUsage, ref double gpuVramUsed,
        ref double gpuVramTotal, ref double gpuClock, ref double gpuFan, ref double gpuFanRpm,
        ref double gpuPower, ref double gpuMemClock, ref double gpuHotSpot, ref double gpuMemTemp, ref double gpuVoltage)
    {
        foreach (var s in sensors)
        {
            if (!s.Value.HasValue) continue;
            var v = s.Value.Value;

            switch (s.SensorType)
            {
                case SensorType.Temperature:
                    if (s.Name == "GPU Core")
                        gpuTemp = Math.Round(v);
                    else if (s.Name == "GPU Hot Spot")
                        gpuHotSpot = Math.Round(v);
                    else if (s.Name == "GPU Memory Junction" || s.Name == "GPU Memory")
                    {
                        if (gpuMemTemp < 0) gpuMemTemp = Math.Round(v);
                    }
                    break;

                case SensorType.Load:
                    if (s.Name == "GPU Core")
                        gpuUsage = Math.Round(v);
                    break;

                case SensorType.SmallData:
                    if (s.Name == "GPU Memory Used")
                        gpuVramUsed = Math.Round(v);
                    else if (s.Name == "D3D Dedicated Memory Used" && gpuVramUsed < 0)
                        gpuVramUsed = Math.Round(v);

                    if (s.Name == "GPU Memory Total")
                        gpuVramTotal = Math.Round(v);
                    else if (s.Name == "D3D Dedicated Memory Limit" && gpuVramTotal < 0)
                        gpuVramTotal = Math.Round(v);
                    break;

                case SensorType.Clock:
                    if (s.Name == "GPU Core" || s.Name.Contains("Core"))
                    {
                        if (gpuClock < 0 && v > 100 && v < 5000)
                            gpuClock = Math.Round(v);
                    }
                    else if (s.Name == "GPU Memory" || s.Name.Contains("Memory"))
                    {
                        if (gpuMemClock < 0 && v > 0 && v < 15000)
                            gpuMemClock = Math.Round(v);
                    }
                    break;

                case SensorType.Power:
                    if ((s.Name == "GPU Power" || s.Name == "GPU Package Power" || s.Name.Contains("GPU Total"))
                        && gpuPower < 0 && v > 0)
                        gpuPower = Math.Round(v, 1);
                    break;

                case SensorType.Voltage:
                    if ((s.Name == "GPU Core" || s.Name.Contains("GPU")) && gpuVoltage < 0 && v > 0)
                        gpuVoltage = Math.Round(v, 3);
                    break;

                case SensorType.Control:
                    if ((s.Name.Contains("GPU Fan") || s.Name == "GPU Fan")
                        && gpuFan < 0 && v >= 0 && v <= 100)
                        gpuFan = Math.Round(v, 1);
                    break;

                case SensorType.Fan:
                    if ((s.Name.Contains("GPU Fan") || s.Name == "GPU Fan")
                        && gpuFanRpm < 0 && v >= 0)
                        gpuFanRpm = Math.Round(v);
                    break;
            }
        }
    }

    #endregion

    #region Ping

    private static void PingLoop()
    {
        using var pinger = new Ping();
        int targetIdx = 0;

        // Initial burst: ping every target once quickly to seed averages
        for (int i = 0; i < PingTargets.Length && _running; i++)
        {
            try
            {
                var reply = pinger.Send(PingTargets[i], 3000);
                if (reply.Status == IPStatus.Success && reply.RoundtripTime > 0)
                {
                    _targetAvg[i] = reply.RoundtripTime;
                    _targetHits[i] = 1;
                    Log($"PING_SEED:{PingTargets[i]}={reply.RoundtripTime}ms");
                }
            }
            catch { /* target unreachable — skip */ }
        }

        // Set initial latency to the best seeded target
        lock (_pingLock)
        {
            double best = double.MaxValue;
            for (int i = 0; i < PingTargets.Length; i++)
                if (_targetHits[i] > 0 && _targetAvg[i] < best)
                    best = _targetAvg[i];
            if (best < double.MaxValue)
                _latencyMs = Math.Round(best);
        }

        // Steady-state: round-robin one target per cycle
        while (_running)
        {
            var target = PingTargets[targetIdx];
            bool success = false;
            double rtt = 0;

            try
            {
                var reply = pinger.Send(target, 2000);
                success = reply.Status == IPStatus.Success;
                rtt = success ? reply.RoundtripTime : 0;
            }
            catch { /* timeout or network error */ }

            lock (_pingLock)
            {
                // Packet loss tracking (combined across all targets)
                if (_pingResults.Count >= PingWindowSize)
                    _pingResults.Dequeue();
                _pingResults.Enqueue(success);

                if (_pingResults.Count >= MinSamplesForLoss)
                {
                    int sc = 0;
                    foreach (var r in _pingResults) { if (r) sc++; }
                    _packetLoss = Math.Round((1.0 - (double)sc / _pingResults.Count) * 100, 1);
                }

                // Update per-target exponential moving average (α=0.3 for smooth but responsive)
                if (success && rtt > 0)
                {
                    if (_targetHits[targetIdx] == 0)
                        _targetAvg[targetIdx] = rtt;
                    else
                        _targetAvg[targetIdx] = _targetAvg[targetIdx] * 0.7 + rtt * 0.3;
                    _targetHits[targetIdx]++;
                }

                // Report the BEST (lowest) target average — simulates matchmaker picking closest server
                double best = double.MaxValue;
                for (int i = 0; i < PingTargets.Length; i++)
                    if (_targetHits[i] > 0 && _targetAvg[i] < best)
                        best = _targetAvg[i];
                if (best < double.MaxValue)
                    _latencyMs = Math.Round(best);
            }

            // Advance to next target (round-robin)
            targetIdx = (targetIdx + 1) % PingTargets.Length;

            // 1-second ping interval, but check _running for quick shutdown
            for (int i = 0; i < 10 && _running; i++)
                Thread.Sleep(100);
        }
    }

    #endregion

    private static void Log(string msg)
    {
        try { Console.Error.WriteLine($"GCMON:{msg}"); }
        catch { /* stderr might be closed */ }
    }
}
