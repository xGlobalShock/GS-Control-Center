// GCMonitor — Self-contained hardware monitoring sidecar for GS Control Center
// Outputs JSON lines to stdout for Electron consumption.
// No .NET runtime needed on target machine (self-contained single-file publish).

using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
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

    // Persist last valid disk temp so transient LHM null reads don't blank the UI
    private static double _lastDiskTemp = -1;

    // LHM re-init state — if CPU temp stays null for too long, try reopening
    private static int _cpuTempNullTicks = 0;
    private static bool _lhmReinitAttempted = false;

    // Periodic status logging — every 60 ticks (~30s)
    private static int _statusLogCounter = 0;
    private static bool _firstTempLogged = false;

    // Ping state (written by background thread, read by main loop)
    private static double _latencyMs;
    private static double _latencyMin = double.MaxValue;
    private static double _latencyMax;
    private static double _latencyAvg;
    private static double _latencyJitter;        // EWMA of |RTT - avgRTT|
    private static double _internetLoss = -1;    // loss % to 8.8.8.8
    private static readonly object _pingLock = new();
    // MikroTik-style cumulative counters (reset each epoch)
    private static long _epochSent;
    private static long _epochRecv;
    private const int EpochLength = 120;          // 2 min @ 1 ping/sec → reset
    private const int MinReportSamples = 5;       // need 5 pings before reporting %
    private static long _pingSent;                // lifetime counters for UI
    private static long _pingRecv;
    // Gateway ping state (written by GatewayPingLoop thread)
    private static double _gatewayLoss = -1;      // loss % to default gateway
    private static double _gatewayLatency;
    private static string _pingGatewayIp = "";
    private static long _gwEpochSent;
    private static long _gwEpochRecv;
    // NIC adapter error counters (updated in CollectSnapshot)
    private static long _prevNicErrors = -1;
    private static long _prevNicDiscards = -1;
    private static double _nicErrorRate;
    private static double _nicDiscardRate;
    private static long _lastNicTicks;
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

        // Parse --drivers <path> argument (bundled PawnIO driver directory)
        string? bundledDriverDir = null;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--drivers") { bundledDriverDir = args[i + 1]; break; }
        }

        // ── Start hwinfo collection immediately (WMI-only, no LHM needed) ──────────────
        // This runs in parallel with PawnIO/LHM init so the 10s JS timeout is never hit.
        // computer is passed as null; a follow-up hwinfo-update emits GPU VRAM from LHM.
        var hwinfoThread = new Thread(() =>
        {
            try
            {
                var fastInfo = HardwareInfoCollector.CollectFast(null);
                var json = JsonSerializer.Serialize(fastInfo);
                lock (_stdoutLock) { Console.WriteLine(json); Console.Out.Flush(); }
                Log("HWINFO_FAST_DONE");

                // Slow fetch in background
                try
                {
                    var slowUpdates = HardwareInfoCollector.CollectSlow(fastInfo);
                    if (slowUpdates.Count > 1)
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

        // Initialize LibreHardwareMonitor
        Computer? computer = null;
        var visitor = new UpdateVisitor();

        // Ensure PawnIO driver is ready (required by LHM 0.9.6+ for CPU temp MSR access)
        try { PawnIoHelper.EnsureReady(Log, bundledDriverDir); }
        catch (Exception ex) { Log($"PAWNIO_SETUP_ERR:{ex.Message}"); }

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

        // First LHM update — warm-up loop until CPU temp sensor values populate.
        // LHM's ring-0 driver (Inpx64/WinRing0) may need several passes to initialize.
        if (computer != null)
        {
            try
            {
                bool tempFound = false;
                for (int pass = 0; pass < 8 && !tempFound; pass++) // up to 4 seconds
                {
                    computer.Accept(visitor);
                    if (pass > 0) Thread.Sleep(500);

                    // Check if any CPU temp sensor has a value
                    foreach (var hw in computer.Hardware)
                    {
                        if (hw.HardwareType != HardwareType.Cpu) continue;
                        foreach (var s in hw.Sensors)
                        {
                            if (s.SensorType == SensorType.Temperature && s.Value.HasValue && s.Value.Value > 0)
                            {
                                tempFound = true;
                                Log($"WARMUP_TEMP_OK:pass={pass} sensor={s.Name} val={s.Value.Value}");
                                break;
                            }
                        }
                        // Also check sub-hardware
                        if (!tempFound)
                        {
                            foreach (var sub in hw.SubHardware)
                            {
                                foreach (var s in sub.Sensors)
                                {
                                    if (s.SensorType == SensorType.Temperature && s.Value.HasValue && s.Value.Value > 0)
                                    {
                                        tempFound = true;
                                        Log($"WARMUP_TEMP_OK:pass={pass} sub={sub.Name} sensor={s.Name} val={s.Value.Value}");
                                        break;
                                    }
                                }
                                if (tempFound) break;
                            }
                        }
                        break; // only check first CPU
                    }
                }
                if (!tempFound)
                    Log("WARMUP_TEMP_FAIL:no CPU temp value after 8 passes");

                // Log driver file detection
                try
                {
                    var tempDir = Path.GetTempPath();
                    var driverFiles = Directory.GetFiles(tempDir, "*Ring0*", SearchOption.TopDirectoryOnly)
                        .Concat(Directory.GetFiles(tempDir, "*Inpx*", SearchOption.TopDirectoryOnly))
                        .ToArray();
                    if (driverFiles.Length > 0)
                        Log($"DRIVER_FILES:{string.Join(";", driverFiles.Select(Path.GetFileName))}");
                    else
                        Log("DRIVER_FILES:NONE_FOUND");
                }
                catch { Log("DRIVER_FILES:CHECK_ERROR"); }

                EmitInitMessage(computer);
                // Emit GPU VRAM from LHM sensors as a follow-up hwinfo-update
                // (the hwinfo thread started before LHM, so it used computer=null)
                EmitGpuVramUpdate(computer);
            }
            catch (Exception ex)
            {
                Log($"INIT_ERR:{ex.Message}");
                EmitMinimalInit();
            }
        }
        else
        {
            EmitMinimalInit();
        }

        // Start ping threads
        var pingThread = new Thread(PingLoop)
        {
            IsBackground = true,
            Priority = ThreadPriority.BelowNormal,
            Name = "PingLoop"
        };
        pingThread.Start();

        var gwPingThread = new Thread(GatewayPingLoop)
        {
            IsBackground = true,
            Priority = ThreadPriority.BelowNormal,
            Name = "GatewayPingLoop"
        };
        gwPingThread.Start();

        // Main polling loop — 500ms cycle
        while (_running)
        {
            try
            {
                if (computer != null)
                    computer.Accept(visitor);

                // If CPU temp has been null too long, try re-initializing LHM
                computer = TryReinitLhm(computer, visitor);

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

        // Keep fan at user's chosen speed — don't reset to auto on shutdown
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

    /// <summary>
    /// Emits an hwinfo-update with GPU VRAM from LHM sensors.
    /// Called after LHM is ready so the hwinfo thread (which ran before LHM) gets updated GPU data.
    /// </summary>
    private static void EmitGpuVramUpdate(Computer computer)
    {
        try
        {
            double vramTotal = -1;
            foreach (var hw in computer.Hardware)
            {
                if (hw.HardwareType is not (HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel))
                    continue;
                foreach (var s in hw.Sensors)
                {
                    if (s.SensorType == SensorType.SmallData && s.Name == "GPU Memory Total" && s.Value.HasValue)
                    {
                        vramTotal = s.Value.Value; // MiB
                        break;
                    }
                }
                if (vramTotal > 0) break;
            }

            if (vramTotal > 0)
            {
                var gb = Math.Round(vramTotal / 1024.0, 1);
                var update = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["type"] = "hwinfo-update",
                    ["gpuVramTotal"] = $"{gb} GB",
                });
                lock (_stdoutLock) { Console.WriteLine(update); Console.Out.Flush(); }
                Log($"GPU_VRAM_UPDATE:{gb} GB");
            }
        }
        catch (Exception ex) { Log($"GPU_VRAM_UPDATE_ERR:{ex.Message}"); }
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
                                {
                                    diskTemp = Math.Round(s.Value.Value, 1);
                                    _lastDiskTemp = diskTemp;
                                }
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

        // Use last valid disk temp if LHM returned null this tick
        if (diskTemp < 0 && _lastDiskTemp > 0) diskTemp = _lastDiskTemp;

        // Fallback chain for CPU temperature — track source for diagnostics
        string tempSource = "none";

        if (cpuTemp > 0)
        {
            tempSource = "lhm";
        }

        // 1. Use motherboard CPU sensor if LHM couldn't read the CPU directly
        if (cpuTemp < 0 && mbCpuTemp > 0)
        {
            cpuTemp = mbCpuTemp;
            tempSource = "mobo";
        }

        // No cached/estimated/WMI fallback — only real hardware sensor data.
        // If no source has a reading, cpuTemp stays -1 and JS shows 0.

        // Track consecutive null ticks for LHM re-init logic
        if (cpuTemp < 0) _cpuTempNullTicks++;
        else _cpuTempNullTicks = 0;

        // Periodic status logging for diagnostics
        _statusLogCounter++;
        if (!_firstTempLogged && cpuTemp > 0)
        {
            _firstTempLogged = true;
            Log($"TEMP_FIRST_READING:{cpuTemp}°C source={tempSource} tick={_statusLogCounter}");
        }
        if (_statusLogCounter % 60 == 0) // every ~30 seconds
        {
            Log($"TEMP_STATUS:{cpuTemp}°C source={tempSource} nullTicks={_cpuTempNullTicks}");
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

        // ── NIC adapter error counters ──
        UpdateNicCounters();

        // ── Uptime ──
        long uptimeSec = Environment.TickCount64 / 1000;
        long days = uptimeSec / 86400;
        long hours = (uptimeSec % 86400) / 3600;
        long mins = (uptimeSec % 3600) / 60;

        // ── Ping (from background threads) ──
        double lat, inetLoss, gwLoss, gwLat, latMin, latMax, latAvg, latJitter;
        long pSent, pRecv;
        string gwIp;
        lock (_pingLock)
        {
            lat = _latencyMs;
            inetLoss = _internetLoss;
            gwLoss = _gatewayLoss;
            gwLat = _gatewayLatency;
            gwIp = _pingGatewayIp;
            latMin = _latencyMin == double.MaxValue ? 0 : _latencyMin;
            latMax = _latencyMax;
            latAvg = _latencyAvg;
            latJitter = _latencyJitter;
            pSent = _pingSent;
            pRecv = _pingRecv;
        }

        // Headline packetLoss = worst-case of internet + gateway targets
        double combinedLoss;
        if (inetLoss >= 0 && gwLoss >= 0)
            combinedLoss = Math.Max(inetLoss, gwLoss);
        else if (inetLoss >= 0)
            combinedLoss = inetLoss;
        else
            combinedLoss = gwLoss;

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
            ["tempSource"] = tempSource,
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
            ["packetLoss"] = combinedLoss,
            ["internetLoss"] = inetLoss,
            ["gatewayLoss"] = gwLoss,
            ["gatewayLatency"] = gwLat,
            ["pingGateway"] = gwIp,
            ["pingMin"] = latMin,
            ["pingMax"] = latMax,
            ["pingAvg"] = latAvg,
            ["pingJitter"] = latJitter,
            ["pingSent"] = pSent,
            ["pingRecv"] = pRecv,
            ["nicErrors"] = _nicErrorRate,
            ["nicDiscards"] = _nicDiscardRate,
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
        // Log all CPU temperature sensor names+values on first tick, tick 20 (~10s), and tick 60 (~30s)
        if (_statusLogCounter <= 1 || _statusLogCounter == 20 || _statusLogCounter == 60)
        {
            foreach (var s in sensors)
            {
                if (s.SensorType == SensorType.Temperature)
                    Log($"CPU_TEMP_SENSOR[t={_statusLogCounter}]:{s.Name}={s.Value?.ToString() ?? "null"}");
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
                else if ((name.StartsWith("Core #") || name.StartsWith("CPU Core #") || name.StartsWith("CCD")) && cpuTemp < 0 && v > 0 && v < 150)
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
                // AMD fallback: report total core power if package is unavailable
                else if ((s.Name == "CPU Cores" || s.Name == "Core Power") && cpuPower < 0 && v > 0)
                    cpuPower = Math.Round(v, 1);
            }
            else if (s.SensorType == SensorType.Voltage)
            {
                // Intel: "CPU Core" | AMD Zen: "Core #1 VID" per-core VID sensors |
                // SuperIO fallback: "CPU VCore" / "Vcore"
                if (cpuVoltage < 0 && v > 0 && v < 3.0)
                {
                    var vname = s.Name;
                    if (vname == "CPU Core" || vname == "Core #1" ||
                        vname == "CPU VCore" || vname == "Vcore" ||
                        vname == "CPU Core Voltage" ||
                        (vname.StartsWith("Core #") && vname.Contains("VID")))
                        cpuVoltage = Math.Round(v, 3);
                }
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
        const double alpha = 0.15;          // EWMA smoothing factor for latency
        double ewmaRtt = -1;
        double ewmaJitter = 0;
        double prevRtt = -1;
        var sw = System.Diagnostics.Stopwatch.StartNew();

        while (_running)
        {
            long loopStart = sw.ElapsedMilliseconds;
            bool success = false;
            long rtt = 0;

            try
            {
                var reply = pinger.Send("8.8.8.8", 2000);
                success = reply.Status == IPStatus.Success;
                if (success) rtt = reply.RoundtripTime;
            }
            catch { /* timeout or network error */ }

            lock (_pingLock)
            {
                // ── MikroTik-style cumulative counters ──
                // loss% = (sent - received) / sent * 100
                // Same formula as RouterOS /tool/ping
                _pingSent++;
                _epochSent++;
                if (success) { _pingRecv++; _epochRecv++; }

                // Packet loss: simple ratio, no windowing
                // MikroTik floors: 3 lost / 63 sent = 4.76% → displays 4%
                if (_epochSent >= MinReportSamples)
                {
                    _internetLoss = (int)(
                        (_epochSent - _epochRecv) * 100.0 / _epochSent);
                }

                // Epoch reset: every 2 min, start fresh counters
                // _internetLoss retains its last value until new epoch has enough samples
                if (_epochSent >= EpochLength)
                {
                    _epochSent = 0;
                    _epochRecv = 0;
                }

                // ── Latency stats (EWMA, jitter, min/max) ──
                if (success && rtt >= 0)
                {
                    double r = rtt;

                    // EWMA latency smoothing
                    if (ewmaRtt < 0)
                        ewmaRtt = r;
                    else
                        ewmaRtt = alpha * r + (1.0 - alpha) * ewmaRtt;

                    // Jitter = EWMA of |current - previous|
                    if (prevRtt >= 0)
                    {
                        double diff = Math.Abs(r - prevRtt);
                        ewmaJitter = alpha * diff + (1.0 - alpha) * ewmaJitter;
                    }
                    prevRtt = r;

                    // Min/max (reset every 600 samples ≈ 10 min)
                    if (_pingSent % 600 == 0)
                    {
                        _latencyMin = r;
                        _latencyMax = r;
                    }
                    if (r < _latencyMin) _latencyMin = r;
                    if (r > _latencyMax) _latencyMax = r;

                    _latencyMs = Math.Round(ewmaRtt);
                    _latencyAvg = Math.Round(ewmaRtt, 1);
                    _latencyJitter = Math.Round(ewmaJitter, 1);
                }
            }

            // Precise 1-second interval (Stopwatch drift-compensated)
            long elapsed = sw.ElapsedMilliseconds - loopStart;
            int sleepMs = (int)Math.Max(1000 - elapsed, 50);
            for (int i = 0; i < sleepMs / 100 && _running; i++)
                Thread.Sleep(100);
            int remainder = sleepMs % 100;
            if (remainder > 0 && _running)
                Thread.Sleep(remainder);
        }
    }

    #endregion

    #region Gateway Ping

    /// <summary>
    /// Detect the default IPv4 gateway from the active network adapter.
    /// </summary>
    private static string? DetectDefaultGateway()
    {
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                var props = ni.GetIPProperties();
                foreach (var gw in props.GatewayAddresses)
                {
                    var addr = gw.Address.ToString();
                    if (gw.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
                        && addr != "0.0.0.0")
                        return addr;
                }
            }
        }
        catch { /* non-critical */ }
        return null;
    }

    /// <summary>
    /// Background thread: ICMP ping to the default gateway at 1/sec.
    /// Catches local network issues (WiFi drops, router problems, cable faults)
    /// that pinging 8.8.8.8 alone would miss.
    /// </summary>
    private static void GatewayPingLoop()
    {
        var gateway = DetectDefaultGateway();
        if (gateway == null) { Log("PING_NO_GATEWAY"); return; }

        lock (_pingLock) { _pingGatewayIp = gateway; }
        Log($"PING_GATEWAY={gateway}");

        using var pinger = new Ping();
        const double alpha = 0.15;
        double ewmaRtt = -1;
        var sw = System.Diagnostics.Stopwatch.StartNew();

        while (_running)
        {
            long loopStart = sw.ElapsedMilliseconds;
            bool success = false;
            long rtt = 0;

            try
            {
                var reply = pinger.Send(gateway, 1500);
                success = reply.Status == IPStatus.Success;
                if (success) rtt = reply.RoundtripTime;
            }
            catch { /* timeout or network error */ }

            lock (_pingLock)
            {
                _gwEpochSent++;
                if (success) _gwEpochRecv++;

                if (_gwEpochSent >= MinReportSamples)
                {
                    _gatewayLoss = (int)(
                        (_gwEpochSent - _gwEpochRecv) * 100.0 / _gwEpochSent);
                }

                if (_gwEpochSent >= EpochLength)
                {
                    _gwEpochSent = 0;
                    _gwEpochRecv = 0;
                }

                if (success && rtt >= 0)
                {
                    double r = rtt;
                    if (ewmaRtt < 0) ewmaRtt = r;
                    else ewmaRtt = alpha * r + (1.0 - alpha) * ewmaRtt;
                    _gatewayLatency = Math.Round(ewmaRtt);
                }
            }

            // 1-second interval (drift-compensated)
            long elapsed = sw.ElapsedMilliseconds - loopStart;
            int sleepMs = (int)Math.Max(1000 - elapsed, 50);
            for (int i = 0; i < sleepMs / 100 && _running; i++)
                Thread.Sleep(100);
            int remainder = sleepMs % 100;
            if (remainder > 0 && _running)
                Thread.Sleep(remainder);
        }
    }

    #endregion

    #region NIC Counters

    /// <summary>
    /// Read actual NIC adapter error/discard counters from the OS.
    /// These catch adapter-level packet drops that ICMP pings cannot detect
    /// (driver bugs, buffer overflows, CRC errors, etc.).
    /// </summary>
    private static void UpdateNicCounters()
    {
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

                var stats = ni.GetIPv4Statistics();
                long errors = stats.IncomingPacketsWithErrors + stats.OutgoingPacketsWithErrors;
                long discards = stats.IncomingPacketsDiscarded + stats.OutgoingPacketsDiscarded;
                long nowTicks = Environment.TickCount64;

                if (_prevNicErrors >= 0 && _lastNicTicks > 0)
                {
                    double dt = (nowTicks - _lastNicTicks) / 1000.0;
                    if (dt > 0.1)
                    {
                        _nicErrorRate = Math.Round(Math.Max(0, (errors - _prevNicErrors) / dt), 1);
                        _nicDiscardRate = Math.Round(Math.Max(0, (discards - _prevNicDiscards) / dt), 1);
                    }
                }

                _prevNicErrors = errors;
                _prevNicDiscards = discards;
                _lastNicTicks = nowTicks;
                break; // first active adapter only
            }
        }
        catch { /* non-critical */ }
    }

    #endregion

    /// <summary>
    /// Attempt to re-initialize LHM if CPU temp has been null for too long.
    /// Returns the (possibly new) Computer instance.
    /// </summary>
    private static Computer? TryReinitLhm(Computer? computer, UpdateVisitor visitor)
    {
        if (_lhmReinitAttempted || computer == null) return computer;
        if (_cpuTempNullTicks < 20) return computer; // wait ~10 seconds before trying

        _lhmReinitAttempted = true;
        Log("LHM_REINIT_ATTEMPT");

        try
        {
            computer.Close();
            Thread.Sleep(500);

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

            // Warm-up passes
            computer.Accept(visitor);
            Thread.Sleep(250);
            computer.Accept(visitor);

            Log("LHM_REINIT_OK");
        }
        catch (Exception ex)
        {
            Log($"LHM_REINIT_FAIL:{ex.Message}");
        }

        return computer;
    }

    private static void Log(string msg)
    {
        try { Console.Error.WriteLine($"GCMON:{msg}"); }
        catch { /* stderr might be closed */ }
    }
}

/// <summary>
/// Ensures the PawnIO kernel driver (used by LHM 0.9.6+) is installed and running.
/// PawnIO is a PnP software device — on some systems the driver package is in the
/// DriverStore but the device node was never created, so LHM can't open \\.\PawnIO.
/// This helper creates the Root\PawnIO device node and installs the driver on it.
/// </summary>
static class PawnIoHelper
{
    const int DICD_GENERATE_ID = 1;
    const int SPDRP_HARDWAREID = 1;
    const int DIF_REGISTERDEVICE = 0x19;
    static readonly Guid GUID_DEVCLASS_SOFTWAREDEVICE = new("{62f9c741-b25a-46ce-b54c-9bccce08b6f2}");

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid classGuid, IntPtr hwndParent);

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool SetupDiCreateDeviceInfoW(IntPtr devInfoSet, string deviceName,
        ref Guid classGuid, string? description, IntPtr hwndParent, int creationFlags, ref SP_DEVINFO_DATA devInfoData);

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool SetupDiSetDeviceRegistryPropertyW(IntPtr devInfoSet,
        ref SP_DEVINFO_DATA devInfoData, int property, byte[] propertyBuffer, int propertyBufferSize);

    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiCallClassInstaller(int installFunction, IntPtr devInfoSet, ref SP_DEVINFO_DATA devInfoData);

    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiDestroyDeviceInfoList(IntPtr devInfoSet);

    [DllImport("newdev.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool UpdateDriverForPlugAndPlayDevicesW(IntPtr hwndParent, string hardwareId,
        string fullInfPath, uint installFlags, out bool rebootRequired);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    struct SP_DEVINFO_DATA
    {
        public int cbSize;
        public Guid ClassGuid;
        public int DevInst;
        public IntPtr Reserved;
    }

    /// <summary>
    /// Returns true if \\.\PawnIO device is accessible (driver is running and device node exists).
    /// </summary>
    static bool IsDeviceReady()
    {
        var h = CreateFileW(@"\\.\PawnIO", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        if (h != IntPtr.Zero && h != (IntPtr)(-1))
        {
            CloseHandle(h);
            return true;
        }
        return false;
    }

    /// <summary>
    /// Finds the PawnIO INF file in the DriverStore.
    /// </summary>
    static string? FindDriverStoreInf()
    {
        var driverStoreDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            "System32", "DriverStore", "FileRepository");

        if (!Directory.Exists(driverStoreDir)) return null;

        foreach (var dir in Directory.GetDirectories(driverStoreDir, "pawnio.inf_*"))
        {
            var inf = Path.Combine(dir, "pawnio.inf");
            if (File.Exists(inf)) return inf;
        }
        return null;
    }

    /// <summary>
    /// Creates the Root\PawnIO PnP device node and installs the driver on it.
    /// Requires admin privileges. Returns a status message for logging.
    /// </summary>
    static string CreateAndInstallDevice(string infPath)
    {
        var classGuid = GUID_DEVCLASS_SOFTWAREDEVICE;
        var devInfoSet = SetupDiCreateDeviceInfoList(ref classGuid, IntPtr.Zero);
        if (devInfoSet == (IntPtr)(-1))
            return $"CreateDeviceInfoList failed: {Marshal.GetLastWin32Error()}";

        try
        {
            var devInfoData = new SP_DEVINFO_DATA { cbSize = Marshal.SizeOf<SP_DEVINFO_DATA>() };

            if (!SetupDiCreateDeviceInfoW(devInfoSet, "PawnIO", ref classGuid, "PawnIO",
                IntPtr.Zero, DICD_GENERATE_ID, ref devInfoData))
            {
                var err = Marshal.GetLastWin32Error();
                // If device already exists, try driver install anyway
                if (err != unchecked((int)0xE0000203))
                    return $"CreateDeviceInfo failed: {err}";
            }

            var hwid = System.Text.Encoding.Unicode.GetBytes("Root\\PawnIO\0\0");
            if (!SetupDiSetDeviceRegistryPropertyW(devInfoSet, ref devInfoData, SPDRP_HARDWAREID, hwid, hwid.Length))
            {
                var err = Marshal.GetLastWin32Error();
                if (err != 0) return $"SetHardwareId failed: {err}";
            }

            if (!SetupDiCallClassInstaller(DIF_REGISTERDEVICE, devInfoSet, ref devInfoData))
                return $"RegisterDevice failed: {Marshal.GetLastWin32Error()}";

            if (!UpdateDriverForPlugAndPlayDevicesW(IntPtr.Zero, "Root\\PawnIO", infPath,
                0x1 /* INSTALLFLAG_FORCE */, out _))
                return $"InstallDriver failed: {Marshal.GetLastWin32Error()}";

            return "OK";
        }
        finally
        {
            SetupDiDestroyDeviceInfoList(devInfoSet);
        }
    }

    /// <summary>
    /// Ensures PawnIO is ready for LHM to use. Call before Computer.Open().
    /// </summary>
    public static void EnsureReady(Action<string> log, string? bundledDriverDir = null)
    {
        // 1. Already working
        if (IsDeviceReady())
        {
            log("PAWNIO:DEVICE_OK");
            return;
        }

        // 2. Check if driver package is in DriverStore
        var infPath = FindDriverStoreInf();

        // 3. If not in DriverStore, stage from bundled files
        if (infPath == null && !string.IsNullOrEmpty(bundledDriverDir))
        {
            var bundledInf = Path.Combine(bundledDriverDir, "pawnio.inf");
            if (File.Exists(bundledInf))
            {
                log($"PAWNIO:STAGING_FROM_BUNDLE:{bundledDriverDir}");
                var staged = StageDriverFromBundle(bundledInf);
                log($"PAWNIO:STAGE_RESULT:{staged}");
                if (staged.StartsWith("OK"))
                    infPath = FindDriverStoreInf(); // Re-check after staging
            }
            else
            {
                log($"PAWNIO:BUNDLE_NOT_FOUND:{bundledInf}");
            }
        }

        if (infPath == null)
        {
            log("PAWNIO:NOT_INSTALLED");
            return;
        }

        log($"PAWNIO:INF_FOUND:{infPath}");

        // 4. Create device node and install driver
        var result = CreateAndInstallDevice(infPath);
        log($"PAWNIO:INSTALL_RESULT:{result}");

        // 5. Give the driver a moment to initialize
        Thread.Sleep(500);

        // 6. Verify
        if (IsDeviceReady())
            log("PAWNIO:READY");
        else
            log("PAWNIO:STILL_NOT_READY");
    }

    /// <summary>
    /// Stages the bundled PawnIO driver into the Windows DriverStore via pnputil.
    /// Requires admin privileges.
    /// </summary>
    static string StageDriverFromBundle(string infPath)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "pnputil.exe"),
                Arguments = $"/add-driver \"{infPath}\" /install",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            if (proc == null) return "FAILED:could not start pnputil";
            var stdout = proc.StandardOutput.ReadToEnd();
            var stderr = proc.StandardError.ReadToEnd();
            proc.WaitForExit(15000);
            var exit = proc.ExitCode;
            var output = (stdout + " " + stderr).Replace("\r", "").Replace("\n", " ").Trim();
            return exit == 0 ? $"OK:{output}" : $"FAILED(exit={exit}):{output}";
        }
        catch (Exception ex)
        {
            return $"EXCEPTION:{ex.Message}";
        }
    }
}
