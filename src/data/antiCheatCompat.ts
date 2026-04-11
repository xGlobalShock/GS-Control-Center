/* ── Anti-Cheat Compatibility Database ─────────────────────────────
 *  All registry/system tweaks in GC Center are SAFE — anti-cheats
 *  scan for runtime behaviour (drivers, injection, memory hacks),
 *  not Windows registry values.
 *
 *  This file focuses on detecting **risky software** installed on
 *  the PC that anti-cheats are verified to flag / ban for.
 *
 *  Status levels:
 *  'safe'    = no known issues  (green badge)
 *  'caution' = flagged when running alongside the game  (yellow badge)
 *  'risky'   = known to trigger bans even when not in use  (red badge)
 * ─────────────────────────────────────────────────────────────────── */

export type CompatStatus = 'safe' | 'caution' | 'risky';

export interface AntiCheatSystem {
  id: string;
  name: string;
  shortName: string;
  games: string[];
}

export interface RiskyApp {
  /** Process name(s) without .exe — matched against running procs */
  processNames: string[];
  /** Display name shown in UI */
  label: string;
  /** Per anti-cheat severity */
  status: Record<string, CompatStatus>;
  /** Why this app is flagged */
  note: string;
  /** How to resolve / stay safe */
  resolution: string;
}

/* ── Anti-cheat systems ────────────────────────────────────────── */

export const antiCheatSystems: AntiCheatSystem[] = [
  {
    id: 'eac',
    name: 'Easy Anti-Cheat',
    shortName: 'EAC',
    games: ['Fortnite', 'Apex Legends', 'Rust', 'Dead by Daylight', 'The Finals'],
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    shortName: 'VGD',
    games: ['Valorant', 'League of Legends'],
  },
  {
    id: 'battleye',
    name: 'BattlEye',
    shortName: 'BE',
    games: ['Rainbow Six Siege', 'PUBG', 'Escape from Tarkov', 'DayZ', 'Arma 3'],
  },
  {
    id: 'faceit',
    name: 'FACEIT Anti-Cheat',
    shortName: 'FACEIT',
    games: ['CS2 (FACEIT)'],
  },
  {
    id: 'esea',
    name: 'ESEA Anti-Cheat',
    shortName: 'ESEA',
    games: ['CS2 (ESEA)'],
  },
];

/* ── Risky Applications ───────────────────────────────────────────
 *  Verified via official AC docs, community ban reports, and AC
 *  vendor statements. Each entry has confirmed detection history.
 *
 *  Categories:
 *  1. Memory editors / debuggers / reverse-engineering
 *  2. Automation / macro / scripting tools
 *  3. DLL injection / overlays / game modifiers
 *  4. Sandbox / virtualisation / emulation
 *  5. Network interception / packet tools
 *  6. Cheat / exploit software
 *  7. Kernel-driver utilities blocked by Vanguard
 *  8. HWID spoofers / ban-evasion tools
 * ─────────────────────────────────────────────────────────────── */

export const riskyApps: RiskyApp[] = [
  /* ═══════════════════════════════════════════════════════════════
   * 1. MEMORY EDITORS / DEBUGGERS / REVERSE-ENGINEERING
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['cheatengine-x86_64', 'cheatengine-i386', 'cheatengine', 'cheatengine-x86_64-SSE4-AVX2'],
    label: 'Cheat Engine',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Universally detected. Bans reported even when not attached to the game. Its kernel driver (dbk64.sys) is flagged on load.',
    resolution: 'Fully uninstall Cheat Engine (including its kernel driver via "Uninstall" in the CE installer). Reboot before playing.',
  },
  {
    processNames: ['processhacker', 'systeminformer'],
    label: 'Process Hacker / System Informer',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'Kernel-level process inspection tool. Vanguard blocks its driver (kprocesshacker.sys) on boot. FACEIT/ESEA ban outright.',
    resolution: 'Close the application and stop its driver service before playing. Use Task Manager instead for basic process monitoring.',
  },
  {
    processNames: ['x64dbg', 'x32dbg'],
    label: 'x64dbg / x32dbg',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'User-mode debugger. Anti-cheats detect debugger APIs. Vanguard blocks at kernel level even when idle.',
    resolution: 'Close x64dbg completely before launching any protected game. Do not debug and play simultaneously.',
  },
  {
    processNames: ['ollydbg', 'ollydbg2'],
    label: 'OllyDbg',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'Legacy debugger. Same detection profile as x64dbg — detected via debug API hooks.',
    resolution: 'Close OllyDbg and reboot before playing to clear any debug flags.',
  },
  {
    processNames: ['windbg', 'windbgx', 'kd'],
    label: 'WinDbg (Windows Debugger)',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Kernel debugger. BattlEye explicitly blocks kernel debugging mode. Vanguard refuses to start if kernel debug is enabled.',
    resolution: 'Close WinDbg. Disable kernel debugging: run "bcdedit /debug off" as admin and reboot.',
  },
  {
    processNames: ['reclass', 'reclass.net', 'reclassnet64'],
    label: 'ReClass.NET',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Memory structure reverse-engineering tool. Universally flagged as cheat tooling.',
    resolution: 'Fully close ReClass.NET before playing. Consider uninstalling if you play competitively.',
  },
  {
    processNames: ['ida', 'ida64', 'idaq', 'idaq64'],
    label: 'IDA Pro / IDA Free',
    status: { eac: 'safe', vanguard: 'caution', battleye: 'safe', faceit: 'caution', esea: 'caution' },
    note: 'Disassembler. Vanguard and kernel-level ACs may flag if running during gameplay.',
    resolution: 'Close IDA before launching the game. Having it installed is fine, just don\'t run it while playing.',
  },
  {
    processNames: ['ghidra', 'ghidrarun'],
    label: 'Ghidra',
    status: { eac: 'safe', vanguard: 'caution', battleye: 'safe', faceit: 'caution', esea: 'safe' },
    note: 'NSA reverse-engineering framework. Similar to IDA — may be flagged if running alongside game.',
    resolution: 'Close Ghidra before playing. Installed files alone are not flagged.',
  },
  {
    processNames: ['hxd', 'hxd64'],
    label: 'HxD Hex Editor',
    status: { eac: 'safe', vanguard: 'caution', battleye: 'safe', faceit: 'caution', esea: 'safe' },
    note: 'Hex editor. Can be flagged by kernel ACs when accessing game memory regions.',
    resolution: 'Close HxD before playing. Do not open game files while the game is running.',
  },
  {
    processNames: ['dnspy', 'dnspy-x86'],
    label: 'dnSpy (.NET Debugger)',
    status: { eac: 'caution', vanguard: 'caution', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: '.NET assembly debugger/editor. Flagged as potential cheat development tool.',
    resolution: 'Close dnSpy before launching any protected game.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 2. AUTOMATION / MACRO / SCRIPTING TOOLS
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['autohotkey', 'autohotkey32', 'autohotkey64', 'autohotkeysc', 'autohotkeyu64', 'autohotkeyu32'],
    label: 'AutoHotkey',
    status: { eac: 'caution', vanguard: 'caution', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'FACEIT and ESEA ban macro/scripting tools outright. BattlEye kicks (not bans) for macros. EAC flags if sending inputs to game.',
    resolution: 'Close all AHK scripts before playing. FACEIT/ESEA: uninstall or don\'t have any scripts running at all.',
  },
  {
    processNames: ['autoit', 'autoit3', 'aut2exe'],
    label: 'AutoIt',
    status: { eac: 'caution', vanguard: 'caution', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'Automation scripting. Same detection profile as AutoHotkey.',
    resolution: 'Close all AutoIt scripts and processes before playing.',
  },
  {
    processNames: ['tinytask'],
    label: 'TinyTask',
    status: { eac: 'caution', vanguard: 'caution', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'Macro recorder/playback. Detected as input automation.',
    resolution: 'Close TinyTask before playing any competitive game.',
  },
  {
    processNames: ['pulover', 'pulovermacrocreator'],
    label: 'Pulover\'s Macro Creator',
    status: { eac: 'caution', vanguard: 'caution', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'AHK-based macro creator. Detected as AutoHotkey variant.',
    resolution: 'Close before playing. FACEIT/ESEA treat it the same as AHK.',
  },
  {
    processNames: ['keytweak'],
    label: 'KeyTweak',
    status: { eac: 'safe', vanguard: 'safe', battleye: 'safe', faceit: 'caution', esea: 'caution' },
    note: 'Registry-based key remapper. Generally safe but FACEIT may flag input-modifying tools.',
    resolution: 'Close KeyTweak before FACEIT matches. Remappings applied via registry persist without it running.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 3. DLL INJECTION / OVERLAYS / GAME MODIFIERS
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['reshade', 'reshade64'],
    label: 'ReShade',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'DLL injection into game process. Vanguard blocks. BattlEye FAQ states it can be blocked per-game (PUBG, Fortnite). EAC allows whitelisted versions.',
    resolution: 'Remove ReShade DLLs (dxgi.dll, d3d9.dll, reshade-shaders) from game folder. Use NVIDIA/AMD native filters instead.',
  },
  {
    processNames: ['sweetfx'],
    label: 'SweetFX',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'Graphics injection. Same detection as ReShade — uses DLL injection.',
    resolution: 'Remove SweetFX DLLs from the game directory.',
  },
  {
    processNames: ['enb', 'enbinjector'],
    label: 'ENBSeries',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'Graphics enhancer using DLL injection (d3d9.dll proxy). Detected as injected code.',
    resolution: 'Remove ENB files (d3d9.dll, enbseries.ini, enblocal.ini) from game directory before playing online.',
  },
  {
    processNames: ['specialk', 'skif'],
    label: 'Special K (Game Modifier)',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'caution', esea: 'caution' },
    note: 'Global DLL injection for framerate/HDR mods. Detected as injected DLL in game process.',
    resolution: 'Disable Special K\'s global injection before playing. Remove its DLL from game folders.',
  },
  {
    processNames: ['extremeinjector', 'extreme_injector'],
    label: 'Extreme Injector',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'DLL injector explicitly designed for game hacking. Universally banned.',
    resolution: 'Uninstall immediately. Having this on your PC is a major red flag for all anti-cheats.',
  },
  {
    processNames: ['xenos', 'xenos64'],
    label: 'Xenos Injector',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Advanced DLL injector (manual map, thread hijacking). Universally flagged.',
    resolution: 'Delete and uninstall. All major anti-cheats detect this on sight.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 4. SANDBOX / VIRTUALISATION / EMULATION
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['sandboxie', 'sbiesvc', 'sbiectrl', 'sbiedrv'],
    label: 'Sandboxie',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'caution', esea: 'caution' },
    note: 'Vanguard blocks Sandboxie driver at kernel level. Other ACs flag if the game runs inside a sandbox.',
    resolution: 'Don\'t run games inside Sandboxie. Stop the Sandboxie service before Vanguard games.',
  },
  {
    processNames: ['vmware', 'vmplayer', 'vmware-vmx', 'vmnat', 'vmnetdhcp'],
    label: 'VMware (Virtual Machine)',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'caution', esea: 'caution' },
    note: 'Vanguard blocks play from VMs. Other ACs may detect VM environment and refuse to run.',
    resolution: 'Don\'t play anti-cheat protected games from inside a VM. Having VMware installed on your host is fine.',
  },
  {
    processNames: ['virtualbox', 'vboxsvc', 'vboxmanage', 'vboxheadless'],
    label: 'VirtualBox',
    status: { eac: 'caution', vanguard: 'risky', battleye: 'caution', faceit: 'caution', esea: 'caution' },
    note: 'Same as VMware — playing from inside the VM is blocked/flagged.',
    resolution: 'Don\'t play inside VirtualBox. The host machine is safe to have VirtualBox installed.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 5. NETWORK INTERCEPTION / PACKET TOOLS
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['wireshark', 'dumpcap', 'tshark'],
    label: 'Wireshark',
    status: { eac: 'safe', vanguard: 'safe', battleye: 'safe', faceit: 'risky', esea: 'caution' },
    note: 'FACEIT bans packet capture tools during matches. Other ACs generally allow it.',
    resolution: 'Close Wireshark and stop any captures before FACEIT/ESEA matches.',
  },
  {
    processNames: ['fiddler', 'fiddlereverywhere'],
    label: 'Fiddler',
    status: { eac: 'safe', vanguard: 'caution', battleye: 'safe', faceit: 'risky', esea: 'caution' },
    note: 'HTTP proxy / traffic interception. FACEIT flags network monitoring tools.',
    resolution: 'Close Fiddler and disable its proxy before playing.',
  },
  {
    processNames: ['charles', 'charlesproxy'],
    label: 'Charles Proxy',
    status: { eac: 'safe', vanguard: 'caution', battleye: 'safe', faceit: 'risky', esea: 'caution' },
    note: 'HTTP/HTTPS debugging proxy. Same category as Fiddler for anti-cheat detection.',
    resolution: 'Close Charles Proxy and remove proxy settings before playing.',
  },
  {
    processNames: ['mitmproxy', 'mitmweb', 'mitmdump'],
    label: 'mitmproxy (Man-in-the-Middle)',
    status: { eac: 'caution', vanguard: 'caution', battleye: 'safe', faceit: 'risky', esea: 'risky' },
    note: 'Network interception tool. Explicitly designed for MITM attacks — heavily flagged.',
    resolution: 'Stop mitmproxy and remove any proxy configuration before playing.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 6. CHEAT / EXPLOIT / TRAINER SOFTWARE
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['wemod', 'wemodapp'],
    label: 'WeMod (Game Trainer)',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Game trainer/cheat tool. Uses memory injection. Detected by all major anti-cheats.',
    resolution: 'Fully close WeMod before playing online games. Only use on single-player offline games.',
  },
  {
    processNames: ['artmoney', 'artmoneypro', 'artmoneyse'],
    label: 'ArtMoney',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Memory editor / game cheating tool. Same detection signature as Cheat Engine.',
    resolution: 'Uninstall before playing online. Functions identically to Cheat Engine for detection purposes.',
  },
  {
    processNames: ['l4dmultihack', 'cheathappens', 'fling', 'flingtrainer'],
    label: 'Cheat Happens / Fling Trainers',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Game trainers that modify memory. Universally detected by anti-cheats.',
    resolution: 'Close all trainer applications and reboot before playing multiplayer games.',
  },
  {
    processNames: ['cosmosmanager', 'cosmos'],
    label: 'Cosmos (Cheat Engine Plugin)',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Frontend for Cheat Engine. Detected via CE\'s underlying driver/process.',
    resolution: 'Uninstall Cosmos and Cheat Engine. Remove the dbk64 kernel driver.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 7. KERNEL-DRIVER UTILITIES (Vanguard-specific blocks)
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['cpuz', 'cpuz_x64', 'cpuz_x32'],
    label: 'CPU-Z (vulnerable driver versions)',
    status: { eac: 'safe', vanguard: 'caution', battleye: 'safe', faceit: 'safe', esea: 'safe' },
    note: 'Older cpuz driver versions (cpuz1xx.sys) have known vulnerabilities exploitable by cheats. Vanguard blocks vulnerable driver versions.',
    resolution: 'Update CPU-Z to the latest version. Close CPU-Z before launching Valorant if you get driver errors.',
  },
  {
    processNames: ['gpuz', 'gpu-z'],
    label: 'GPU-Z (vulnerable driver)',
    status: { eac: 'safe', vanguard: 'caution', battleye: 'safe', faceit: 'safe', esea: 'safe' },
    note: 'Uses a kernel driver that Vanguard may block if it contains known vulnerabilities.',
    resolution: 'Update GPU-Z to latest version. Close before playing Valorant if issues occur.',
  },
  {
    processNames: ['rweverything', 'rw', 'rweverything64'],
    label: 'RWEverything',
    status: { eac: 'safe', vanguard: 'risky', battleye: 'safe', faceit: 'safe', esea: 'safe' },
    note: 'Low-level hardware access tool. Its kernel driver (RwDrv.sys) is on Vanguard\'s vulnerable driver blocklist.',
    resolution: 'Uninstall RWEverything or stop its driver: "sc stop RwDrv" as admin, then reboot.',
  },
  {
    processNames: ['speedfan'],
    label: 'SpeedFan',
    status: { eac: 'safe', vanguard: 'risky', battleye: 'caution', faceit: 'safe', esea: 'safe' },
    note: 'Uses vulnerable kernel driver. BattlEye FAQ confirms it blocks "kernel drivers with known security issues." Vanguard blocks on boot.',
    resolution: 'Use HWiNFO64 or Libre Hardware Monitor instead. Uninstall SpeedFan and reboot.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 8. HWID SPOOFERS / BAN-EVASION TOOLS
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['hwid', 'hwidspoofer', 'spoofersvc', 'serialchanger'],
    label: 'HWID Spoofer (any variant)',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Ban-evasion tool. Anti-cheats actively scan for HWID manipulation. Using one triggers hardware bans.',
    resolution: 'Completely remove the spoofer and all its drivers. A clean Windows reinstall may be needed if kernel drivers persist.',
  },
  {
    processNames: ['macaddresschanger', 'tmac', 'technitium'],
    label: 'Technitium MAC Changer',
    status: { eac: 'caution', vanguard: 'caution', battleye: 'caution', faceit: 'risky', esea: 'risky' },
    note: 'MAC address spoofing. FACEIT/ESEA treat network identity changes as ban evasion.',
    resolution: 'Do not change MAC address while playing on FACEIT/ESEA. Reset to original MAC.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 9. SCREEN CAPTURE / PIXEL READING BOTS
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['pixelbot', 'colorbot', 'pixelaim'],
    label: 'Pixel / Color Bot',
    status: { eac: 'risky', vanguard: 'risky', battleye: 'risky', faceit: 'risky', esea: 'risky' },
    note: 'Screen-reading automation that generates simulated input (aimbots). All ACs detect via input pattern analysis.',
    resolution: 'Delete and remove all pixel bot software. These are classified as cheats.',
  },

  /* ═══════════════════════════════════════════════════════════════
   * 10. MISCELLANEOUS — COMMONLY ASKED ABOUT
   * ═══════════════════════════════════════════════════════════════ */
  {
    processNames: ['obs64', 'obs32', 'obs'],
    label: 'OBS Studio',
    status: { eac: 'safe', vanguard: 'safe', battleye: 'safe', faceit: 'safe', esea: 'safe' },
    note: 'Streaming/recording software. Safe with all anti-cheats — does not inject into game process.',
    resolution: 'No action needed. OBS is safe to use while gaming.',
  },
  {
    processNames: ['discord', 'discordptb', 'discordcanary'],
    label: 'Discord',
    status: { eac: 'safe', vanguard: 'safe', battleye: 'safe', faceit: 'safe', esea: 'safe' },
    note: 'Voice chat with game overlay. Safe — its overlay is whitelisted by all major anti-cheats.',
    resolution: 'No action needed. Discord is safe to use.',
  },
  {
    processNames: ['msiafterburner', 'msiafterburner64'],
    label: 'MSI Afterburner',
    status: { eac: 'safe', vanguard: 'safe', battleye: 'safe', faceit: 'safe', esea: 'safe' },
    note: 'GPU overclocking + monitoring. Generally safe. Old RTSS versions could be flagged — keep RTSS updated.',
    resolution: 'Keep MSI Afterburner and RTSS updated to latest versions. Safe to use.',
  },
  {
    processNames: ['hwinfo64', 'hwinfo32', 'hwinfo'],
    label: 'HWiNFO',
    status: { eac: 'safe', vanguard: 'safe', battleye: 'safe', faceit: 'safe', esea: 'safe' },
    note: 'Hardware monitoring. Safe with all anti-cheats — recommended alternative to SpeedFan.',
    resolution: 'No action needed. HWiNFO is safe to use.',
  },
];

/* ── Helpers ───────────────────────────────────────────────────── */

export const statusColor: Record<CompatStatus, string> = {
  safe: '#00CC6A',
  caution: '#FFD600',
  risky: '#ef4444',
};

export const statusLabel: Record<CompatStatus, string> = {
  safe: 'Safe',
  caution: 'Caution',
  risky: 'Risky',
};
