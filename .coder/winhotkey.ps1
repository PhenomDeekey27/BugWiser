
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CoderHotKey {
  [StructLayout(LayoutKind.Sequential)]
  public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);
  [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG lpMsg);
  [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG lpMsg);
}
"@
$MOD_WIN = 0x0008
$MOD_NOREPEAT = 0x4000
$VK_O = 0x4F
$HOTKEY_ID = 0xC0DE

if (-not [CoderHotKey]::RegisterHotKey([IntPtr]::Zero, $HOTKEY_ID, ($MOD_WIN -bor $MOD_NOREPEAT), $VK_O)) {
  [Console]::WriteLine("failed")
  [Console]::Out.Flush()
  exit 1
}

[Console]::WriteLine("registered")
[Console]::Out.Flush()

try {
  while ($true) {
    $msg = New-Object CoderHotKey+MSG
    if ([CoderHotKey]::GetMessage([ref]$msg, [IntPtr]::Zero, 0, 0) -ne 0) {
      if ($msg.message -eq 0x0312) {
        [Console]::WriteLine("toggle")
        [Console]::Out.Flush()
      }
      [void][CoderHotKey]::TranslateMessage([ref]$msg)
      [void][CoderHotKey]::DispatchMessage([ref]$msg)
    }
  }
} finally {
  [void][CoderHotKey]::UnregisterHotKey([IntPtr]::Zero, $HOTKEY_ID)
}
