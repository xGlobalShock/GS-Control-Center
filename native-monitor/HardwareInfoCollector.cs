// HardwareInfoCollector.cs — One-shot static hardware information collector
// Replaces the massive PowerShell script in hardwareInfo.js with native C# WMI queries.
// Emits two message types:
//   {"type":"hwinfo", ...}        — fast data (< 2 seconds)
//   {"type":"hwinfo-update", ...} — slow background data (serial, activation, updates)

using System.Diagnostics;
using System.Management;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using LibreHardwareMonitor.Hardware;
using Microsoft.Win32;

namespace GCMonitor;

public static class HardwareInfoCollector
{
    private const int WmiTimeoutMs = 5000;

    private static void RunTimed(Action action, string label)
    {
        var task = Task.Run(action);
        if (!task.Wait(WmiTimeoutMs))
            Log($"{label}_TIMEOUT:exceeded {WmiTimeoutMs}ms");
        else if (task.IsFaulted)
            throw task.Exception!.InnerException ?? task.Exception;
    }

    /// <summary>
    /// Collect all "fast" hardware info (runs in ~1-2 seconds).
    /// Called once at startup on a background thread.
    /// </summary>
    public static Dictionary<string, object?> CollectFast(Computer? computer)
    {
        var info = new Dictionary<string, object?> { ["type"] = "hwinfo" };

        try { RunTimed(() => CollectCpu(info), "CPU"); } catch (Exception ex) { Log($"CPU_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectGpu(info, computer), "GPU"); } catch (Exception ex) { Log($"GPU_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectRam(info), "RAM"); } catch (Exception ex) { Log($"RAM_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectDisk(info), "DISK"); } catch (Exception ex) { Log($"DISK_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectAllDrives(info), "DRIVES"); } catch (Exception ex) { Log($"DRIVES_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectNetwork(info), "NET"); } catch (Exception ex) { Log($"NET_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectWindows(info), "WIN"); } catch (Exception ex) { Log($"WIN_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectUptime(info), "UPTIME"); } catch (Exception ex) { Log($"UPTIME_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectPowerPlan(info), "POWER"); } catch (Exception ex) { Log($"POWER_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectBattery(info), "BATT"); } catch (Exception ex) { Log($"BATT_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectMotherboard(info), "MOBO"); } catch (Exception ex) { Log($"MOBO_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectBios(info), "BIOS"); } catch (Exception ex) { Log($"BIOS_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectSecureBoot(info), "SBOOT"); } catch (Exception ex) { Log($"SBOOT_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectKeyboard(info), "KB"); } catch (Exception ex) { Log($"KB_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectMemoryStats(info), "MEMSTAT"); } catch (Exception ex) { Log($"MEMSTAT_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectTopProcesses(info), "PROC"); } catch (Exception ex) { Log($"PROC_ERR:{ex.Message}"); }
        try { RunTimed(() => CollectPhysicalDisks(info), "PDISK"); } catch (Exception ex) { Log($"PDISK_ERR:{ex.Message}"); }

        return info;
    }

    /// <summary>
    /// Collect "slow" hardware info (things that may take 5-10 seconds).
    /// Called on background thread after fast data is emitted.
    /// Only collects fields missing from fastInfo.
    /// </summary>
    public static Dictionary<string, object?> CollectSlow(Dictionary<string, object?> fastInfo)
    {
        var updates = new Dictionary<string, object?> { ["type"] = "hwinfo-update" };

        if (IsEmpty(fastInfo, "motherboardSerial"))
        {
            try { CollectMotherboardSerial(updates); } catch { }
        }

        if (IsEmpty(fastInfo, "lastWindowsUpdate"))
        {
            try { CollectLastWindowsUpdate(updates); } catch { }
        }

        if (IsEmpty(fastInfo, "windowsActivation"))
        {
            try { CollectWindowsActivation(updates); } catch { }
        }

        // nvidia-smi fallback for driver version / VRAM if WMI didn't have it
        if (IsEmpty(fastInfo, "gpuDriverVersion"))
        {
            try { CollectNvidiaSmiDriver(updates); } catch { }
        }

        return updates;
    }

    #region CPU

    private static void CollectCpu(Dictionary<string, object?> info)
    {
        using var searcher = new ManagementObjectSearcher(
            "SELECT Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, " +
            "SocketDesignation, L2CacheSize, L3CacheSize, Architecture FROM Win32_Processor");
        foreach (ManagementObject cpu in searcher.Get())
        {
            info["cpuName"] = WmiStr(cpu, "Name") ?? "Unknown CPU";
            var cores = WmiInt(cpu, "NumberOfCores");
            var threads = WmiInt(cpu, "NumberOfLogicalProcessors");
            // Sanity: cores <= threads
            if (cores > threads && threads > 0) (cores, threads) = (threads, cores);
            if (cores > 0 && threads == 0) threads = cores;
            if (threads > 0 && cores == 0) cores = (int)Math.Ceiling(threads / 2.0);
            info["cpuCores"] = cores;
            info["cpuThreads"] = threads;
            var maxMhz = WmiInt(cpu, "MaxClockSpeed");
            info["cpuMaxClock"] = maxMhz > 0 ? $"{(maxMhz / 1000.0):F2} GHz" : "";

            // Socket
            var socket = WmiStr(cpu, "SocketDesignation");
            if (!string.IsNullOrWhiteSpace(socket)) info["cpuSocket"] = socket.Trim();

            // Cache (KB → MB display)
            var l2 = WmiInt(cpu, "L2CacheSize");  // per-core KB
            var l3 = WmiInt(cpu, "L3CacheSize");   // shared KB
            if (l2 > 0) info["cpuL2Cache"] = l2 >= 1024 ? $"{l2 / 1024} MB" : $"{l2} KB";
            if (l3 > 0) info["cpuL3Cache"] = l3 >= 1024 ? $"{l3 / 1024} MB" : $"{l3} KB";

            // Architecture (0=x86, 9=x64, 12=ARM64)
            var arch = WmiInt(cpu, "Architecture");
            info["cpuArch"] = arch switch { 0 => "x86", 9 => "x64", 12 => "ARM64", _ => $"Unknown ({arch})" };

            break; // first CPU only
        }
    }

    #endregion

    #region GPU

    private static void CollectGpu(Dictionary<string, object?> info, Computer? computer)
    {
        // Try WMI first for name + driver + VRAM
        string gpuName = "", driverVersion = "";
        double vramGB = 0;

        using var searcher = new ManagementObjectSearcher(
            "SELECT Name, DriverVersion, AdapterRAM, ConfigManagerErrorCode FROM Win32_VideoController");

        // Two-pass: first prefer real (non-virtual) working GPUs, then fall back
        string? fallbackName = null, fallbackDriver = null;
        long fallbackRam = 0;

        foreach (ManagementObject gpu in searcher.Get())
        {
            var errCode = WmiInt(gpu, "ConfigManagerErrorCode");
            var name = WmiStr(gpu, "Name") ?? "";
            if (name.Length == 0) continue;

            bool isVirtual = Regex.IsMatch(name, @"(Virtual|Dummy|Parsec|Remote|Generic)", RegexOptions.IgnoreCase);

            if (isVirtual)
            {
                // Keep as fallback in case there's no real GPU at all
                if (fallbackName == null) { fallbackName = name; fallbackDriver = WmiStr(gpu, "DriverVersion"); fallbackRam = WmiLong(gpu, "AdapterRAM"); }
                continue;
            }

            if (errCode != 0 && gpuName.Length > 0) continue; // prefer working adapters

            gpuName = name;
            driverVersion = WmiStr(gpu, "DriverVersion") ?? "";

            var adapterRam = WmiLong(gpu, "AdapterRAM");
            if (adapterRam > 0)
                vramGB = Math.Round(adapterRam / (1024.0 * 1024 * 1024), 1);

            if (errCode == 0) break; // found a working non-virtual GPU
        }

        // If no real GPU found, use the virtual fallback
        if (gpuName.Length == 0 && fallbackName != null)
        {
            gpuName = fallbackName;
            driverVersion = fallbackDriver ?? "";
            if (fallbackRam > 0)
                vramGB = Math.Round(fallbackRam / (1024.0 * 1024 * 1024), 1);
        }

        // Registry fallback for VRAM (AdapterRAM often returns 4GB max on 32-bit field)
        if (vramGB <= 0 || vramGB >= 3.9)
        {
            var regVram = GetRegistryVramGB(gpuName);
            if (regVram > vramGB) vramGB = regVram;
        }

        // AMD driver version from registry (user-friendly Adrenalin version)
        if (Regex.IsMatch(gpuName, @"AMD|Radeon|ATI", RegexOptions.IgnoreCase))
        {
            var amdVer = GetRegistryString(@"SOFTWARE\AMD\CN", "DriverVersion")
                         ?? GetRegistryString(@"SOFTWARE\ATI Technologies\CBT", "ReleaseVersion");
            if (!string.IsNullOrEmpty(amdVer)) driverVersion = amdVer;
        }

        // LHM may provide better GPU VRAM total from sensors
        if (computer != null)
        {
            foreach (var hw in computer.Hardware)
            {
                if (hw.HardwareType is not (HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel))
                    continue;

                if (string.IsNullOrEmpty(gpuName)) gpuName = hw.Name;

                foreach (var s in hw.Sensors)
                {
                    if (s is { SensorType: SensorType.SmallData, Name: "GPU Memory Total" } && s.Value > 0)
                    {
                        var lhmVramGB = Math.Round(s.Value.Value / 1024.0, 1);
                        if (lhmVramGB > vramGB) vramGB = lhmVramGB;
                    }
                }

                foreach (var sub in hw.SubHardware)
                {
                    foreach (var s in sub.Sensors)
                    {
                        if (s is { SensorType: SensorType.SmallData, Name: "GPU Memory Total" } && s.Value > 0)
                        {
                            var lhmVramGB = Math.Round(s.Value.Value / 1024.0, 1);
                            if (lhmVramGB > vramGB) vramGB = lhmVramGB;
                        }
                    }
                }

                break; // first GPU
            }
        }

        info["gpuName"] = gpuName.Length > 0 ? gpuName : "Unknown GPU";
        info["gpuVramTotal"] = vramGB > 0 ? (vramGB % 1 == 0 ? $"{(int)vramGB} GB" : $"{vramGB} GB") : "";
        info["gpuDriverVersion"] = driverVersion;
    }

    private static double GetRegistryVramGB(string gpuName)
    {
        try
        {
            using var classKey = Registry.LocalMachine.OpenSubKey(
                @"SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}");
            if (classKey == null) return 0;

            foreach (var subName in classKey.GetSubKeyNames())
            {
                try
                {
                    using var sub = classKey.OpenSubKey(subName);
                    if (sub == null) continue;

                    var qw = sub.GetValue("HardwareInformation.qwMemorySize");
                    if (qw is long lv && lv > 0)
                    {
                        // Check if this sub-key matches our GPU
                        var desc = sub.GetValue("DriverDesc")?.ToString();
                        var provider = sub.GetValue("ProviderName")?.ToString();
                        var gpuFirst = gpuName.Split(' ').FirstOrDefault() ?? "";

                        if (desc == gpuName || (!string.IsNullOrEmpty(provider) && !string.IsNullOrEmpty(gpuFirst)
                                                && provider.Contains(gpuFirst, StringComparison.OrdinalIgnoreCase)))
                        {
                            return Math.Round(lv / (1024.0 * 1024 * 1024), 1);
                        }
                    }
                }
                catch { }
            }

            // Second pass: take any qwMemorySize
            foreach (var subName in classKey.GetSubKeyNames())
            {
                try
                {
                    using var sub = classKey.OpenSubKey(subName);
                    if (sub == null) continue;
                    var qw = sub.GetValue("HardwareInformation.qwMemorySize");
                    if (qw is long lv && lv > 0)
                        return Math.Round(lv / (1024.0 * 1024 * 1024), 1);
                }
                catch { }
            }
        }
        catch { }
        return 0;
    }

    private static void CollectNvidiaSmiDriver(Dictionary<string, object?> updates)
    {
        try
        {
            var psi = new ProcessStartInfo("nvidia-smi",
                "--query-gpu=driver_version,memory.total --format=csv,noheader,nounits")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
            };
            using var proc = Process.Start(psi);
            if (proc == null) return;
            var output = proc.StandardOutput.ReadToEnd().Trim();
            proc.WaitForExit(3000);

            var parts = output.Split('\n')[0].Split(',');
            if (parts.Length >= 1 && parts[0].Trim().Length > 0)
                updates["gpuDriverVersion"] = parts[0].Trim();
            if (parts.Length >= 2 && int.TryParse(parts[1].Trim(), out var mib) && mib > 0)
            {
                var gb = mib / 1024.0;
                updates["gpuVramTotal"] = gb % 1 == 0 ? $"{(int)gb} GB" : $"{gb:F1} GB";
            }
        }
        catch { }
    }

    #endregion

    #region RAM

    private static void CollectRam(Dictionary<string, object?> info)
    {
        using var searcher = new ManagementObjectSearcher(
            "SELECT Capacity, Speed, ConfiguredClockSpeed, Manufacturer, PartNumber, DeviceLocator FROM Win32_PhysicalMemory");
        var sticks = searcher.Get().Cast<ManagementObject>().ToList();

        if (sticks.Count == 0)
        {
            // Fallback: use kernel32 for total RAM
            var mem = new NativeMethods.MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<NativeMethods.MEMORYSTATUSEX>() };
            if (NativeMethods.GlobalMemoryStatusEx(ref mem))
                info["ramTotalGB"] = NormalizeRamTotal(Math.Round(mem.ullTotalPhys / (1024.0 * 1024 * 1024), 1));
            info["ramInfo"] = $"{info.GetValueOrDefault("ramTotalGB", 0)} GB";
            return;
        }

        long totalBytes = sticks.Sum(s => WmiLong(s, "Capacity"));
        double totalGB = NormalizeRamTotal(Math.Round(totalBytes / (1024.0 * 1024 * 1024), 1));

        var first = sticks[0];
        int jedecSpeed = WmiInt(first, "Speed");
        int configSpeed = WmiInt(first, "ConfiguredClockSpeed");
        int speed = (configSpeed > 0) ? configSpeed : jedecSpeed;

        string manufacturer = WmiStr(first, "Manufacturer") ?? "";
        string partNumber = (WmiStr(first, "PartNumber") ?? "").Trim();

        // Slot map — normalize DeviceLocator to A1/A2/B1/B2 etc.
        var slotLabels = sticks.Select(s =>
        {
            var loc = (WmiStr(s, "DeviceLocator") ?? "").Replace(" ", "").ToUpper();
            if (Regex.IsMatch(loc, @"CHANNELA.*DIMM0")) return "A1";
            if (Regex.IsMatch(loc, @"CHANNELA.*DIMM1")) return "A2";
            if (Regex.IsMatch(loc, @"CHANNELB.*DIMM0")) return "B1";
            if (Regex.IsMatch(loc, @"CHANNELB.*DIMM1")) return "B2";
            if (Regex.IsMatch(loc, @"CHANNELC.*DIMM0")) return "C1";
            if (Regex.IsMatch(loc, @"CHANNELC.*DIMM1")) return "C2";
            if (Regex.IsMatch(loc, @"CHANNELD.*DIMM0")) return "D1";
            if (Regex.IsMatch(loc, @"CHANNELD.*DIMM1")) return "D2";
            var m = Regex.Match(loc, @"^([A-D])([12])");
            if (m.Success) return $"{m.Groups[1].Value}{m.Groups[2].Value}";
            return Regex.Replace(Regex.Replace(loc, @"DIMM_?", ""), @"[^A-D0-9]", "");
        }).ToList();

        // DRAM chip brand via JEDEC manufacturer ID
        string dramBrand = ResolveDramBrand(manufacturer);

        info["ramTotalGB"] = totalGB;
        info["ramInfo"] = speed > 0 ? $"{totalGB} GB @ {speed} MHz" : $"{totalGB} GB";
        info["ramSpeed"] = speed > 0 ? $"{speed} MT/s" : "";
        info["ramSticks"] = $"{sticks.Count} stick(s)";
        info["ramBrand"] = ResolveRamBrand(manufacturer, partNumber);
        info["ramPartNumber"] = CleanField(partNumber);
        info["ramSlotMap"] = string.Join(" / ", slotLabels);
        info["ramDramBrand"] = dramBrand;

        // RAM usage from kernel32
        var mem2 = new NativeMethods.MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<NativeMethods.MEMORYSTATUSEX>() };
        if (NativeMethods.GlobalMemoryStatusEx(ref mem2))
        {
            double ramTotalK = Math.Round(mem2.ullTotalPhys / (1024.0 * 1024 * 1024), 1);
            double ramAvailK = Math.Round(mem2.ullAvailPhys / (1024.0 * 1024 * 1024), 1);
            info["ramUsedGB"] = Math.Round(ramTotalK - ramAvailK, 1);
        }
    }

    private static double NormalizeRamTotal(double reportedGB)
    {
        if (reportedGB <= 0) return 0;
        int[] standardSizes = [2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];
        foreach (var size in standardSizes)
        {
            double tolerance = size * 0.05;
            if (reportedGB >= size - tolerance && reportedGB <= size + 0.1)
                return size;
        }
        return Math.Round(reportedGB);
    }

    private static string ResolveDramBrand(string manufacturer)
    {
        var raw = manufacturer.Replace(" ", "").ToUpper();
        if (Regex.IsMatch(raw, @"80CE|CE00|SAMSUNG")) return "Samsung";
        if (Regex.IsMatch(raw, @"80AD|AD00|HYNIX|SKHY")) return "SK Hynix";
        if (Regex.IsMatch(raw, @"802C|2C00|MICRON|MT")) return "Micron";
        if (Regex.IsMatch(raw, @"KINGSTON|04F4")) return "Kingston";
        if (raw.Contains("CRUCIAL")) return "Crucial";
        if (Regex.IsMatch(raw, @"CORSAIR|029E")) return "Corsair";
        if (Regex.IsMatch(raw, @"GSKILL|G\.SKILL|04CD")) return "G.Skill";
        if (Regex.IsMatch(raw, @"TEAMGROUP|04CB")) return "TeamGroup";
        if (Regex.IsMatch(raw, @"PATRIOT|04C8")) return "Patriot";
        if (Regex.IsMatch(raw, @"ADATA|04F1")) return "ADATA";
        return "";
    }

    /// <summary>Port of resolveRamBrand() from hardwareInfo.js</summary>
    private static string ResolveRamBrand(string? mfr, string? partNum)
    {
        var part = (partNum ?? "").Trim();
        var partLow = part.ToLower();
        var mfrLow = (mfr ?? "").Trim().ToLower();

        // G.Skill F3-/F4- part numbers
        if (Regex.IsMatch(part, @"^[fF][34]-\d"))
        {
            var suffix = (part.Split('-').Last() ?? "").ToUpper();
            suffix = Regex.Replace(suffix, @"^\d+", "");
            var gskillSeries = new Dictionary<string, string>
            {
                ["GTZRX"] = "G.Skill Trident Z Royal", ["GTZRS"] = "G.Skill Trident Z Royal Silver",
                ["GTZR"] = "G.Skill Trident Z RGB", ["GTZ"] = "G.Skill Trident Z",
                ["GTZN"] = "G.Skill Trident Z Neo", ["GTZNR"] = "G.Skill Trident Z Neo",
                ["GFX"] = "G.Skill Trident Z5 RGB", ["GX"] = "G.Skill Trident Z5",
                ["GVK"] = "G.Skill Ripjaws V", ["GRK"] = "G.Skill Ripjaws V",
                ["GBKD"] = "G.Skill Ripjaws 4", ["GNT"] = "G.Skill Aegis",
                ["GIS"] = "G.Skill ARES", ["GQSB"] = "G.Skill Sniper X",
            };
            foreach (var (code, name) in gskillSeries)
            {
                if (suffix.EndsWith(code)) return name;
            }
            return "G.Skill";
        }

        // Corsair
        if (Regex.IsMatch(part, @"^cmk", RegexOptions.IgnoreCase)) return "Corsair Vengeance RGB Pro";
        if (Regex.IsMatch(part, @"^cmt", RegexOptions.IgnoreCase)) return "Corsair Dominator Platinum";
        if (Regex.IsMatch(part, @"^cmd", RegexOptions.IgnoreCase)) return "Corsair Dominator";
        if (Regex.IsMatch(part, @"^cmw", RegexOptions.IgnoreCase)) return "Corsair Vengeance RGB";
        if (Regex.IsMatch(part, @"^cms", RegexOptions.IgnoreCase)) return "Corsair";
        if (partLow.Contains("vengeance")) return "Corsair Vengeance";
        if (partLow.Contains("dominator")) return "Corsair Dominator";

        // Kingston
        if (Regex.IsMatch(part, @"^khx", RegexOptions.IgnoreCase)) return "Kingston HyperX";
        if (Regex.IsMatch(part, @"^hx\d", RegexOptions.IgnoreCase)) return "Kingston HyperX";
        if (Regex.IsMatch(part, @"^kf\d", RegexOptions.IgnoreCase)) return "Kingston Fury";
        if (Regex.IsMatch(part, @"^kcp", RegexOptions.IgnoreCase)) return "Kingston";
        if (partLow.Contains("fury")) return "Kingston Fury";

        // Crucial / Micron
        if (Regex.IsMatch(part, @"^ble", RegexOptions.IgnoreCase)) return "Crucial Ballistix";
        if (Regex.IsMatch(part, @"^bls", RegexOptions.IgnoreCase)) return "Crucial Ballistix Sport";
        if (Regex.IsMatch(part, @"^ct\d", RegexOptions.IgnoreCase)) return "Crucial";
        if (Regex.IsMatch(part, @"^mt\d", RegexOptions.IgnoreCase)) return "Micron";

        // SK Hynix / Samsung
        if (Regex.IsMatch(part, @"^hma|^hmt|^hmab", RegexOptions.IgnoreCase)) return "SK Hynix";
        if (Regex.IsMatch(part, @"^m3[78]", RegexOptions.IgnoreCase)) return "Samsung";

        // TeamGroup
        if (Regex.IsMatch(part, @"^tf[ab]\d|^tdeed", RegexOptions.IgnoreCase)) return "TeamGroup T-Force";
        if (Regex.IsMatch(part, @"^tf\d", RegexOptions.IgnoreCase)) return "TeamGroup";

        // Patriot
        if (Regex.IsMatch(part, @"^psd|^pv[e34]", RegexOptions.IgnoreCase)) return "Patriot Viper";

        // JEDEC manufacturer ID lookup
        var jedecMap = new Dictionary<string, string>
        {
            ["04f1"] = "G.Skill", ["04cd"] = "Kingston", ["9e"] = "Kingston",
            ["ce"] = "Samsung", ["00ce"] = "Samsung", ["80ce"] = "Samsung",
            ["ad"] = "SK Hynix", ["00ad"] = "SK Hynix", ["80ad"] = "SK Hynix",
            ["2c"] = "Micron", ["002c"] = "Micron", ["802c"] = "Micron",
            ["859b"] = "Corsair", ["0cf8"] = "Crucial", ["0b"] = "Nanya", ["0783"] = "Transcend",
        };
        var mfrKey = mfrLow.Replace("0x", "");
        if (jedecMap.TryGetValue(mfrKey, out var brand)) return brand;

        // If manufacturer is a human-readable name (not just hex), return it
        if (mfr != null && !Regex.IsMatch(mfr.Trim(), @"^[0-9a-fA-F]{2,8}$") && mfr.Trim().Length > 1)
            return mfr.Trim();

        return "";
    }

    #endregion

    #region Disk

    private static void CollectDisk(Dictionary<string, object?> info)
    {
        string diskName = "Unknown Disk", diskType = "", diskHealth = "";
        int diskTotalGB = 0;

        // Try MSFT_PhysicalDisk first (equivalent to Get-PhysicalDisk)
        // Prefer the boot disk; skip USB/removable (BusType 7=USB, 12=SD)
        bool found = false;
        try
        {
            using var searcher = new ManagementObjectSearcher(
                @"root\microsoft\windows\storage",
                "SELECT FriendlyName, MediaType, HealthStatus, Size, BusType, DeviceId FROM MSFT_PhysicalDisk");

            string? fallbackName = null, fallbackType = null, fallbackHealth = null;
            int fallbackTotalGB = 0;

            // Find the boot disk's DeviceId via MSFT_Disk → BootFromDisk
            int bootDiskNumber = -1;
            try
            {
                using var bootSearcher = new ManagementObjectSearcher(
                    @"root\microsoft\windows\storage",
                    "SELECT Number FROM MSFT_Disk WHERE BootFromDisk=TRUE");
                foreach (ManagementObject bd in bootSearcher.Get())
                {
                    bootDiskNumber = WmiInt(bd, "Number");
                    break;
                }
            }
            catch { }

            foreach (ManagementObject d in searcher.Get())
            {
                var busType = WmiInt(d, "BusType");
                // Skip USB (7) and SD (12) drives
                if (busType == 7 || busType == 12) continue;

                var name = WmiStr(d, "FriendlyName") ?? "Unknown Disk";
                var mt = WmiInt(d, "MediaType");
                var type = mt switch { 3 => "HDD", 4 => "SSD", _ => "Unknown" };
                var hs = WmiInt(d, "HealthStatus");
                var health = hs switch { 0 => "Healthy", 1 => "Warning", 2 => "Unhealthy", _ => WmiStr(d, "HealthStatus") ?? "Unknown" };
                var size = WmiLong(d, "Size");
                var totalGB = (int)Math.Round(size / (1024.0 * 1024 * 1024));

                // Check if this is the boot disk
                var devId = WmiStr(d, "DeviceId") ?? "";
                int.TryParse(devId, out var diskNum);

                if (bootDiskNumber >= 0 && diskNum == bootDiskNumber)
                {
                    diskName = name; diskType = type; diskHealth = health; diskTotalGB = totalGB;
                    found = true;
                    break;
                }

                // Keep first non-USB disk as fallback
                if (fallbackName == null)
                {
                    fallbackName = name; fallbackType = type; fallbackHealth = health; fallbackTotalGB = totalGB;
                }
            }

            // Use fallback if boot disk wasn't identified
            if (!found && fallbackName != null)
            {
                diskName = fallbackName; diskType = fallbackType!; diskHealth = fallbackHealth!; diskTotalGB = fallbackTotalGB;
                found = true;
            }
        }
        catch { }

        // Fallback: Win32_DiskDrive (skip USB)
        if (!found)
        {
            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT Model, MediaType, Size, Status, InterfaceType FROM Win32_DiskDrive");
                foreach (ManagementObject d in searcher.Get())
                {
                    var iface = (WmiStr(d, "InterfaceType") ?? "").ToUpperInvariant();
                    if (iface == "USB") continue;
                    diskName = WmiStr(d, "Model") ?? "Unknown Disk";
                    diskType = WmiStr(d, "MediaType") ?? "Unknown";
                    var status = WmiStr(d, "Status") ?? "";
                    diskHealth = status.Equals("OK", StringComparison.OrdinalIgnoreCase) ? "Healthy" : status;
                    var size = WmiLong(d, "Size");
                    diskTotalGB = (int)Math.Round(size / (1024.0 * 1024 * 1024));
                    break;
                }
            }
            catch { }
        }

        // C: drive size comparison (take the larger of physical disk size vs C: size)
        try
        {
            var cDrive = new DriveInfo("C");
            if (cDrive.IsReady)
            {
                var cSizeGB = (int)Math.Round(cDrive.TotalSize / (1024.0 * 1024 * 1024));
                if (cSizeGB > diskTotalGB) diskTotalGB = cSizeGB;
            }
        }
        catch { }

        // Normalize disk type
        var dtLow = diskType.ToLower();
        if (dtLow.Contains("ssd") || dtLow == "4" || dtLow.Contains("solid")) diskType = "SSD";
        else if (dtLow.Contains("hdd") || dtLow == "3" || dtLow.Contains("unspecified")) diskType = "HDD";
        else if (dtLow.Contains("nvme")) diskType = "NVMe";

        // Normalize disk health
        var dhLow = diskHealth.ToLower().Trim();
        if (new[] { "healthy", "ok", "good", "0" }.Contains(dhLow)) diskHealth = "Healthy";
        else if (new[] { "warning", "caution", "degraded", "1" }.Contains(dhLow)) diskHealth = "Warning";
        else if (new[] { "unhealthy", "bad", "critical", "2" }.Contains(dhLow)) diskHealth = "Unhealthy";

        info["diskName"] = diskName;
        info["diskType"] = diskType;
        info["diskHealth"] = diskHealth;
        info["diskTotalGB"] = diskTotalGB;

        // Disk free space for C:
        try
        {
            var cDrive = new DriveInfo("C");
            if (cDrive.IsReady)
                info["diskFreeGB"] = Math.Round(cDrive.AvailableFreeSpace / (1024.0 * 1024 * 1024), 1);
        }
        catch { info["diskFreeGB"] = 0; }
    }

    private static void CollectAllDrives(Dictionary<string, object?> info)
    {
        var drives = new List<Dictionary<string, object>>();
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT DeviceID, Size, FreeSpace, VolumeName FROM Win32_LogicalDisk WHERE DriveType=3");
            foreach (ManagementObject d in searcher.Get())
            {
                var letter = WmiStr(d, "DeviceID") ?? "";
                var totalGB = Math.Round(WmiLong(d, "Size") / (1024.0 * 1024 * 1024), 1);
                var freeGB = Math.Round(WmiLong(d, "FreeSpace") / (1024.0 * 1024 * 1024), 1);
                var label = WmiStr(d, "VolumeName") ?? "";
                drives.Add(new Dictionary<string, object>
                {
                    ["letter"] = letter, ["totalGB"] = totalGB, ["freeGB"] = freeGB, ["label"] = label
                });
            }
        }
        catch { }
        info["allDrives"] = drives;
    }

    private static void CollectPhysicalDisks(Dictionary<string, object?> info)
    {
        var disks = new List<Dictionary<string, object>>();
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT Model, SerialNumber, FirmwareRevision, Size FROM Win32_DiskDrive");
            foreach (ManagementObject d in searcher.Get())
            {
                disks.Add(new Dictionary<string, object>
                {
                    ["model"] = (WmiStr(d, "Model") ?? "").Replace("\n", " "),
                    ["serial"] = (WmiStr(d, "SerialNumber") ?? "").Trim(),
                    ["firmware"] = (WmiStr(d, "FirmwareRevision") ?? "").Trim(),
                    ["sizeGB"] = (int)Math.Round(WmiLong(d, "Size") / (1024.0 * 1024 * 1024)),
                });
            }
        }
        catch { }
        info["physicalDisks"] = disks;
    }

    #endregion

    #region Network

    private static void CollectNetwork(Dictionary<string, object?> info)
    {
        var interfaces = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up
                        && n.NetworkInterfaceType != NetworkInterfaceType.Loopback
                        && n.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
            .ToList();

        var primary = interfaces.FirstOrDefault();
        if (primary == null)
        {
            info["networkAdapter"] = "";
            return;
        }

        info["networkAdapter"] = $"{primary.Name} ({primary.Description})";
        info["networkLinkSpeed"] = FormatLinkSpeed(primary.Speed);
        info["macAddress"] = FormatMac(primary.GetPhysicalAddress());

        var ipProps = primary.GetIPProperties();

        var ipv4 = ipProps.UnicastAddresses
            .FirstOrDefault(a => a.Address.AddressFamily == AddressFamily.InterNetwork);
        info["ipAddress"] = ipv4?.Address.ToString() ?? "";

        var ipv6 = ipProps.UnicastAddresses
            .FirstOrDefault(a => a.Address.AddressFamily == AddressFamily.InterNetworkV6);
        info["ipv6Address"] = ipv6?.Address.ToString() ?? "";

        var gw = ipProps.GatewayAddresses
            .FirstOrDefault(g => g.Address.AddressFamily == AddressFamily.InterNetwork);
        info["gateway"] = gw?.Address.ToString() ?? "";

        var dnsAddrs = ipProps.DnsAddresses
            .Where(d => d.AddressFamily == AddressFamily.InterNetwork)
            .Select(d => d.ToString());
        info["dns"] = string.Join(",", dnsAddrs);

        // All active adapters
        var adapters = new List<Dictionary<string, object>>();
        foreach (var iface in interfaces)
        {
            var adType = iface.NetworkInterfaceType switch
            {
                NetworkInterfaceType.Wireless80211 => "WiFi",
                NetworkInterfaceType.Ethernet => "Ethernet",
                _ => "Other"
            };
            // Name-based fallback
            if (adType == "Other")
            {
                if (Regex.IsMatch(iface.Name, @"Wi-?Fi|Wireless|WLAN", RegexOptions.IgnoreCase)) adType = "WiFi";
                else if (Regex.IsMatch(iface.Name, @"Ethernet|LAN", RegexOptions.IgnoreCase)) adType = "Ethernet";
            }

            adapters.Add(new Dictionary<string, object>
            {
                ["name"] = iface.Name,
                ["type"] = adType,
                ["linkSpeed"] = FormatLinkSpeed(iface.Speed),
            });
        }
        info["networkAdapters"] = adapters;
    }

    private static string FormatLinkSpeed(long bps)
    {
        if (bps <= 0) return "";
        if (bps >= 1_000_000_000) return $"{bps / 1_000_000_000} Gbps";
        if (bps >= 1_000_000) return $"{bps / 1_000_000} Mbps";
        return $"{bps / 1_000} Kbps";
    }

    private static string FormatMac(PhysicalAddress mac)
    {
        var bytes = mac.GetAddressBytes();
        if (bytes.Length == 0) return "";
        return string.Join(":", bytes.Select(b => b.ToString("X2")));
    }

    #endregion

    #region Windows

    private static void CollectWindows(Dictionary<string, object?> info)
    {
        string prod = "", dispVer = "", build = "";

        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            if (key != null)
            {
                prod = key.GetValue("ProductName")?.ToString() ?? "";
                dispVer = key.GetValue("DisplayVersion")?.ToString() ?? "";
                build = key.GetValue("CurrentBuildNumber")?.ToString() ?? "";
            }
        }
        catch { }

        // Fallback via WMI
        if (string.IsNullOrEmpty(prod))
        {
            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT Caption FROM Win32_OperatingSystem");
                foreach (ManagementObject os in searcher.Get())
                {
                    prod = WmiStr(os, "Caption") ?? "";
                    break;
                }
            }
            catch { }
        }

        // Win10/11 correction based on build number
        if (int.TryParse(build, out var buildNum))
        {
            if (buildNum >= 22000 && !prod.Contains("11"))
                prod = prod.Replace("Windows 10", "Windows 11");
            else if (buildNum < 22000 && prod.Contains("11"))
                prod = prod.Replace("Windows 11", "Windows 10");
        }

        info["windowsVersion"] = !string.IsNullOrEmpty(prod) ? prod : "Unknown";
        info["windowsBuild"] = !string.IsNullOrEmpty(build)
            ? $"{(dispVer.Length > 0 ? dispVer + " " : "")}(Build {build})"
            : "Unknown";
    }

    #endregion

    #region Uptime

    private static void CollectUptime(Dictionary<string, object?> info)
    {
        long uptimeSec = Environment.TickCount64 / 1000;
        long days = uptimeSec / 86400;
        long hours = (uptimeSec % 86400) / 3600;
        long mins = (uptimeSec % 3600) / 60;
        info["systemUptime"] = $"{days}d {hours}h {mins}m";
    }

    #endregion

    #region Power Plan

    private static readonly Dictionary<string, string> KnownPowerPlans = new(StringComparer.OrdinalIgnoreCase)
    {
        ["381b4222-f694-41f0-9685-ff5bb260df2e"] = "Balanced",
        ["8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"] = "High Performance",
        ["a1841308-3541-4fab-bc81-f71556f20b4a"] = "Power Saver",
        ["e9a42b02-d5df-448d-aa00-03f14749eb61"] = "Ultimate Performance",
    };

    private static void CollectPowerPlan(Dictionary<string, object?> info)
    {
        string powerPlan = "";

        try
        {
            using var searcher = new ManagementObjectSearcher(
                @"root\cimv2\power",
                "SELECT InstanceID, ElementName FROM Win32_PowerPlan WHERE IsActive=TRUE");
            foreach (ManagementObject pp in searcher.Get())
            {
                var instanceId = WmiStr(pp, "InstanceID") ?? "";
                var elementName = WmiStr(pp, "ElementName") ?? "";

                var guidMatch = Regex.Match(instanceId, @"\{([0-9a-f\-]+)\}", RegexOptions.IgnoreCase);
                if (guidMatch.Success)
                {
                    var guid = guidMatch.Groups[1].Value.ToLower();
                    if (KnownPowerPlans.TryGetValue(guid, out var knownName))
                        powerPlan = knownName;
                    else
                        powerPlan = elementName; // Custom plan — use OS name
                }
                else if (!string.IsNullOrEmpty(elementName))
                {
                    powerPlan = elementName;
                }
                break;
            }
        }
        catch { }

        // Fallback: powercfg
        if (string.IsNullOrEmpty(powerPlan))
        {
            try
            {
                var psi = new ProcessStartInfo("powercfg", "/getactivescheme")
                {
                    CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true,
                };
                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    var output = proc.StandardOutput.ReadToEnd().Trim();
                    proc.WaitForExit(4000);
                    var guidMatch = Regex.Match(output,
                        @"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
                        RegexOptions.IgnoreCase);
                    if (guidMatch.Success)
                    {
                        var g = guidMatch.Groups[1].Value.ToLower();
                        if (KnownPowerPlans.TryGetValue(g, out var name))
                            powerPlan = name;
                        else
                        {
                            var nameMatch = Regex.Match(output, @"\(([^)]+)\)$");
                            if (nameMatch.Success) powerPlan = nameMatch.Groups[1].Value.Trim();
                        }
                    }
                }
            }
            catch { }
        }

        info["powerPlan"] = powerPlan;
    }

    #endregion

    #region Battery

    private static void CollectBattery(Dictionary<string, object?> info)
    {
        info["hasBattery"] = false;
        info["batteryPercent"] = 0;
        info["batteryStatus"] = "";

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT BatteryStatus, EstimatedChargeRemaining FROM Win32_Battery");
            foreach (ManagementObject b in searcher.Get())
            {
                info["hasBattery"] = true;
                info["batteryPercent"] = WmiInt(b, "EstimatedChargeRemaining");
                var status = WmiInt(b, "BatteryStatus");
                info["batteryStatus"] = status switch
                {
                    1 => "Discharging", 2 => "AC Connected", 3 => "Fully Charged",
                    4 => "Low", 5 => "Critical", 6 => "Charging",
                    7 => "Charging (High)", 8 => "Charging (Low)", 9 => "Charging (Critical)",
                    _ => "Unknown"
                };
                break;
            }
        }
        catch { }
    }

    #endregion

    #region Motherboard

    private static void CollectMotherboard(Dictionary<string, object?> info)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Manufacturer, Product, SerialNumber FROM Win32_BaseBoard");
            foreach (ManagementObject bb in searcher.Get())
            {
                info["motherboardManufacturer"] = CleanField(WmiStr(bb, "Manufacturer"));
                info["motherboardProduct"] = CleanField(WmiStr(bb, "Product") ?? WmiStr(bb, "Name") ?? WmiStr(bb, "Caption"));
                var rawSerial = (WmiStr(bb, "SerialNumber") ?? "").Trim();
                info["motherboardSerial"] = CleanSerial(rawSerial);
                break;
            }
        }
        catch { }
    }

    private static void CollectMotherboardSerial(Dictionary<string, object?> updates)
    {
        var candidates = new List<string>();

        // Source 1: Win32_SystemEnclosure
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT SerialNumber FROM Win32_SystemEnclosure");
            foreach (ManagementObject obj in searcher.Get())
            {
                var v = WmiStr(obj, "SerialNumber");
                if (!string.IsNullOrEmpty(v)) candidates.Add(v.Trim());
                break;
            }
        }
        catch { }

        // Source 2: Win32_ComputerSystemProduct
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT IdentifyingNumber FROM Win32_ComputerSystemProduct");
            foreach (ManagementObject obj in searcher.Get())
            {
                var v = WmiStr(obj, "IdentifyingNumber");
                if (!string.IsNullOrEmpty(v)) candidates.Add(v.Trim());
                break;
            }
        }
        catch { }

        // Source 3: Win32_BIOS
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT SerialNumber FROM Win32_BIOS");
            foreach (ManagementObject obj in searcher.Get())
            {
                var v = WmiStr(obj, "SerialNumber");
                if (!string.IsNullOrEmpty(v)) candidates.Add(v.Trim());
                break;
            }
        }
        catch { }

        var valid = candidates.FirstOrDefault(s => !string.IsNullOrEmpty(CleanSerial(s)));
        if (!string.IsNullOrEmpty(valid))
            updates["motherboardSerial"] = CleanSerial(valid);
    }

    #endregion

    #region BIOS

    private static void CollectBios(Dictionary<string, object?> info)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT SMBIOSBIOSVersion, Version, ReleaseDate FROM Win32_BIOS");
            foreach (ManagementObject b in searcher.Get())
            {
                var ver = WmiStr(b, "SMBIOSBIOSVersion") ?? WmiStr(b, "Version") ?? "";
                info["biosVersion"] = CleanField(ver);

                var relDate = WmiStr(b, "ReleaseDate") ?? "";
                if (relDate.Length >= 8)
                {
                    // WMI date format: YYYYMMDDHHMMSS.000000+000
                    info["biosDate"] = $"{relDate[..4]}-{relDate[4..6]}-{relDate[6..8]}";
                }
                else
                {
                    info["biosDate"] = "";
                }
                break;
            }
        }
        catch { }
    }

    #endregion

    #region SecureBoot

    private static void CollectSecureBoot(Dictionary<string, object?> info)
    {
        info["secureBoot"] = "Unknown";
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\SecureBoot\State");
            if (key != null)
            {
                var val = key.GetValue("UEFISecureBootEnabled");
                if (val is int iv)
                    info["secureBoot"] = iv == 1 ? "Enabled" : "Disabled";
            }
        }
        catch { }
    }

    #endregion

    #region Keyboard

    private static void CollectKeyboard(Dictionary<string, object?> info)
    {
        info["keyboardName"] = "";

        try
        {
            // Step 1: Get VID/PIDs of keyboard devices
            var vidPids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            using (var searcher = new ManagementObjectSearcher(
                       "SELECT DeviceID FROM Win32_PnPEntity WHERE PNPClass='Keyboard' AND Status='OK'"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    var deviceId = WmiStr(obj, "DeviceID") ?? "";
                    var m = Regex.Match(deviceId, @"(VID_[0-9A-Fa-f]+&PID_[0-9A-Fa-f]+)");
                    if (m.Success) vidPids.Add(m.Groups[1].Value);
                }
            }

            // Step 2: Find HID device with a friendly name matching VID/PID
            if (vidPids.Count > 0)
            {
                using var searcher = new ManagementObjectSearcher(
                    "SELECT DeviceID, Name, PNPClass FROM Win32_PnPEntity WHERE PNPClass='HIDClass' AND Status='OK'");
                foreach (ManagementObject obj in searcher.Get())
                {
                    var deviceId = WmiStr(obj, "DeviceID") ?? "";
                    var name = WmiStr(obj, "Name") ?? "";

                    // Skip generic names
                    if (Regex.IsMatch(name, @"^HID |^USB Input|^HID-compliant|^Standard|^PS/2", RegexOptions.IgnoreCase))
                        continue;

                    foreach (var vp in vidPids)
                    {
                        if (deviceId.Contains(vp, StringComparison.OrdinalIgnoreCase) && name.Length > 0)
                        {
                            info["keyboardName"] = CleanField(name);
                            return;
                        }
                    }
                }
            }

            // Fallback: Win32_Keyboard
            using (var searcher = new ManagementObjectSearcher("SELECT Description, Name FROM Win32_Keyboard"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    var desc = WmiStr(obj, "Description") ?? WmiStr(obj, "Name") ?? "";
                    info["keyboardName"] = CleanField(desc);
                    return;
                }
            }
        }
        catch { }
    }

    #endregion

    #region Memory Stats

    private static void CollectMemoryStats(Dictionary<string, object?> info)
    {
        // Page file
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT CurrentUsage, AllocatedBaseSize FROM Win32_PageFileUsage");
            foreach (ManagementObject pf in searcher.Get())
            {
                info["ramPageFileUsed"] = WmiInt(pf, "CurrentUsage");
                info["ramPageFileTotal"] = WmiInt(pf, "AllocatedBaseSize");
                break;
            }
        }
        catch { }

        // Performance counters: non-paged pool, standby, modified
        try
        {
            using var npCounter = new PerformanceCounter("Memory", "Pool Nonpaged Bytes");
            info["ramNonPagedPool"] = (int)Math.Round(npCounter.NextValue() / (1024 * 1024));
        }
        catch { info["ramNonPagedPool"] = 0; }

        try
        {
            using var stCounter = new PerformanceCounter("Memory", "Standby Cache Normal Priority Bytes");
            info["ramStandby"] = (int)Math.Round(stCounter.NextValue() / (1024 * 1024));
        }
        catch { info["ramStandby"] = 0; }

        try
        {
            using var modCounter = new PerformanceCounter("Memory", "Modified Page List Bytes");
            info["ramModified"] = (int)Math.Round(modCounter.NextValue() / (1024 * 1024));
        }
        catch { info["ramModified"] = 0; }
    }

    #endregion

    #region Top Processes

    private static void CollectTopProcesses(Dictionary<string, object?> info)
    {
        var top = new List<Dictionary<string, object>>();
        try
        {
            var getProcsTask = Task.Run(() => Process.GetProcesses());
            if (!getProcsTask.Wait(3000))
            {
                Log("PROC_TIMEOUT:GetProcesses exceeded 3s");
                info["ramTopProcesses"] = top;
                return;
            }
            var grouped = getProcsTask.Result
                .GroupBy(p => p.ProcessName)
                .Select(g => new { Name = g.Key, TotalWS = g.Sum(p => { try { return p.WorkingSet64; } catch { return 0L; } }) })
                .OrderByDescending(g => g.TotalWS)
                .Take(4);

            foreach (var g in grouped)
            {
                top.Add(new Dictionary<string, object>
                {
                    ["name"] = g.Name,
                    ["mb"] = (int)Math.Round(g.TotalWS / (1024.0 * 1024)),
                });
            }
        }
        catch { }
        info["ramTopProcesses"] = top;
    }

    #endregion

    #region Slow Fetch: Windows Update

    private static void CollectLastWindowsUpdate(Dictionary<string, object?> updates)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT InstalledOn FROM Win32_QuickFixEngineering");
            DateTime latest = DateTime.MinValue;
            foreach (ManagementObject obj in searcher.Get())
            {
                var dateStr = WmiStr(obj, "InstalledOn");
                if (DateTime.TryParse(dateStr, out var dt) && dt > latest)
                    latest = dt;
            }
            updates["lastWindowsUpdate"] = latest > DateTime.MinValue
                ? latest.ToString("yyyy-MM-dd")
                : "Unknown";
        }
        catch { updates["lastWindowsUpdate"] = "Unknown"; }
    }

    #endregion

    #region Slow Fetch: Windows Activation

    private static void CollectWindowsActivation(Dictionary<string, object?> updates)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT LicenseStatus FROM SoftwareLicensingProduct WHERE PartialProductKey IS NOT NULL AND ApplicationId = '55c92734-d682-4d71-983e-d6ec3f16059f'");
            foreach (ManagementObject obj in searcher.Get())
            {
                var status = WmiInt(obj, "LicenseStatus");
                updates["windowsActivation"] = status == 1 ? "Licensed" : "Not Activated";
                return;
            }
            updates["windowsActivation"] = "Not Activated";
        }
        catch { updates["windowsActivation"] = "Unknown"; }
    }

    #endregion

    #region Helpers

    private static string? WmiStr(ManagementObject obj, string prop)
    {
        try { return obj[prop]?.ToString(); }
        catch { return null; }
    }

    private static int WmiInt(ManagementObject obj, string prop)
    {
        try
        {
            var val = obj[prop];
            if (val == null) return 0;
            return Convert.ToInt32(val);
        }
        catch { return 0; }
    }

    private static long WmiLong(ManagementObject obj, string prop)
    {
        try
        {
            var val = obj[prop];
            if (val == null) return 0;
            return Convert.ToInt64(val);
        }
        catch { return 0; }
    }

    private static bool IsEmpty(Dictionary<string, object?> dict, string key)
    {
        if (!dict.TryGetValue(key, out var val)) return true;
        return string.IsNullOrEmpty(val?.ToString());
    }

    private static string? GetRegistryString(string subKey, string valueName)
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(subKey);
            return key?.GetValue(valueName)?.ToString();
        }
        catch { return null; }
    }

    private static readonly string[] InvalidSerials =
    [
        "default string", "to be filled by o.e.m.", "to be filled by oem",
        "system serial number", "not specified", "none", "unknown",
        "baseboard serial number"
    ];

    private static readonly string[] Placeholders =
    [
        "default string", "to be filled by o.e.m.", "to be filled by oem",
        "not specified", "none", "system product name", "system manufacturer",
        "base board product", "base board manufacturer"
    ];

    private static string CleanField(string? val)
    {
        if (string.IsNullOrEmpty(val)) return "";
        var v = val.Trim();
        if (Placeholders.Contains(v.ToLower())) return "";
        if (Regex.IsMatch(v, @"^0+$")) return "";
        if (v.Length < 2) return "";
        return v;
    }

    private static string CleanSerial(string? val)
    {
        if (string.IsNullOrEmpty(val)) return "";
        var v = val.Trim();
        if (v.Length < 3) return "";
        if (Regex.IsMatch(v, @"^0+$")) return "";
        if (InvalidSerials.Contains(v.ToLower())) return "";
        return v;
    }

    private static void Log(string msg)
    {
        try { Console.Error.WriteLine($"GCMON_HW:{msg}"); }
        catch { /* stderr might be closed */ }
    }

    #endregion
}
