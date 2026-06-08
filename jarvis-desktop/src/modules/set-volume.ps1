param([int]$Level)

# COM-based volume control using IAudioEndpointVolume
# Much faster and silent compared to SendKeys approach
try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int _A(); int _B(); int _C(); int _D();
    int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
    int _F();
    int GetMasterVolumeLevelScalar(out float pfLevel);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref System.Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    [return: MarshalAs(UnmanagedType.IUnknown)]
    object GetDefaultAudioEndpoint(int dataFlow, int role);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorClass {}

public class VolumeControl {
    public static void SetVolume(float level) {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorClass();
        var device = (IMMDevice)enumerator.GetDefaultAudioEndpoint(0, 1);
        var iid = typeof(IAudioEndpointVolume).GUID;
        object volObj;
        device.Activate(ref iid, 23, IntPtr.Zero, out volObj);
        var volume = (IAudioEndpointVolume)volObj;
        volume.SetMasterVolumeLevelScalar(level, Guid.Empty);
    }
}
"@

    $normalizedLevel = [Math]::Max(0, [Math]::Min(100, $Level)) / 100.0
    [VolumeControl]::SetVolume($normalizedLevel)
    Write-Output "SUCCESS:$Level"
}
catch {
    # Fallback: SendKeys approach (slower, audible beeps)
    Write-Output "COM_FAILED:$($_.Exception.Message)"
    $wshShell = New-Object -ComObject WScript.Shell
    for ($i = 0; $i -lt 50; $i++) {
        $wshShell.SendKeys([char]174)
        Start-Sleep -Milliseconds 10
    }
    $steps = [Math]::Round($Level / 2)
    for ($i = 0; $i -lt $steps; $i++) {
        $wshShell.SendKeys([char]175)
        Start-Sleep -Milliseconds 10
    }
    Write-Output "SUCCESS:$Level"
}
