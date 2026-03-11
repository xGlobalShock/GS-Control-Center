$source = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class ResEnum {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public ushort dmSpecVersion;
        public ushort dmDriverVersion;
        public ushort dmSize;
        public ushort dmDriverExtra;
        public uint dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public uint dmDisplayOrientation;
        public uint dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public ushort dmLogPixels;
        public uint dmBitsPerPel;
        public uint dmPelsWidth;
        public uint dmPelsHeight;
        public uint dmDisplayFlags;
        public uint dmDisplayFrequency;
        public uint dmICMMethod;
        public uint dmICMIntent;
        public uint dmMediaType;
        public uint dmDitherType;
        public uint dmReserved1;
        public uint dmReserved2;
        public uint dmPanningWidth;
        public uint dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    public static extern bool EnumDisplaySettingsA(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode);

    public static string[] GetResolutions() {
        var seen = new HashSet<string>();
        var results = new List<string>();
        DEVMODE dm = new DEVMODE();
        dm.dmSize = (ushort)Marshal.SizeOf(dm);
        int i = 0;
        while (EnumDisplaySettingsA(null, i, ref dm)) {
            if (dm.dmPelsWidth >= 800) {
                string key = dm.dmPelsWidth + "x" + dm.dmPelsHeight;
                if (seen.Add(key)) results.Add(key);
            }
            i++;
        }
        return results.ToArray();
    }
}
"@
Add-Type -TypeDefinition $source
[ResEnum]::GetResolutions() | ForEach-Object { Write-Output $_ }
