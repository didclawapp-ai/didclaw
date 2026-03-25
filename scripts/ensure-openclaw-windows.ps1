#Requires -Version 5.1
# Must be saved as UTF-8 with BOM; Windows PowerShell 5.1 defaults to ANSI which breaks
# non-ASCII characters in string literals and can trigger a ParserError.
<#
.SYNOPSIS
  Windows only: detect openclaw; install via npm or official install.ps1 if missing;
  optionally run non-interactive onboard.

.DESCRIPTION
  Primary install path  : if npm is available (Node already installed), run
                          `npm install -g openclaw@latest` directly.
  Fallback install path : download https://openclaw.ai/install.ps1 and run it
                          with -NoOnboard (handles Node install automatically).
  Onboard               : non-interactive `openclaw onboard` with --auth-choice skip
                          (model configured later in the DidClaw UI).
  Default: no --install-daemon flag so no scheduled task / gateway.cmd popup;
           the gateway is launched as a hidden child process by DidClaw.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\ensure-openclaw-windows.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\ensure-openclaw-windows.ps1 -SkipOnboard
    powershell -NoProfile -ExecutionPolicy Bypass -File .\ensure-openclaw-windows.ps1 -OllamaModelId 'qwen2.5:7b'
    $env:POLLINATIONS_API_KEY='sk_...'; .\ensure-openclaw-windows.ps1
    powershell ...\ensure-openclaw-windows.ps1 -OnboardAuthChoice ollama
    powershell ...\ensure-openclaw-windows.ps1 -OnboardAuthChoice skip
    powershell ...\ensure-openclaw-windows.ps1 -FallbackToSkipAuthIfOllamaUnreachable
    powershell ...\ensure-openclaw-windows.ps1 -FailIfOllamaUnreachable
    powershell ...\ensure-openclaw-windows.ps1 -RequirePollinationsApiKey
    powershell ...\ensure-openclaw-windows.ps1 -InstallGatewayDaemon

  Parameters can also be forwarded from ensure-openclaw-windows.bat.
#>

[CmdletBinding()]
param(
    [switch]$SkipOnboard,
    [string]$OllamaModelId = 'glm-4.7-flash',
    [string]$OllamaBaseUrl = 'http://127.0.0.1:11434',
    [int]$GatewayPort = 18789,
    [switch]$SkipHealth,
    [ValidateSet('pollinations', 'ollama', 'skip')]
    [string]$OnboardAuthChoice = 'pollinations',
    [string]$PollinationsApiKey = '',
    [string]$PollinationsModelId = 'openai',
    [switch]$FallbackToSkipAuthIfOllamaUnreachable,
    [switch]$FailIfOllamaUnreachable,
    [switch]$SkipOllamaPreflight,
    [switch]$RequirePollinationsApiKey,
    [switch]$InstallGatewayDaemon
)

# Do not enable StrictMode here: the official install.ps1 reads uninitialised variables
# in some branches. Do not dot-source install.ps1 in the same process either, to avoid
# inheriting this script's ErrorActionPreference.
$ErrorActionPreference = 'Stop'

# Write-Host output is often lost when the process stdout is redirected;
# Write-Output ensures lines reach the DidClaw streaming log.
function Write-UiLine {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [ValidateSet('', 'Yellow', 'Red', 'Green', 'DarkGray')]
        [string]$ForegroundColor = ''
    )
    Write-Output $Text
    switch ($ForegroundColor) {
        'Yellow'   { Write-Host $Text -ForegroundColor Yellow;   break }
        'Red'      { Write-Host $Text -ForegroundColor Red;      break }
        'Green'    { Write-Host $Text -ForegroundColor Green;    break }
        'DarkGray' { Write-Host $Text -ForegroundColor DarkGray; break }
        default    { Write-Host $Text }
    }
}

function Sync-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ([string]::IsNullOrEmpty($machine)) { $machine = '' }
    if ([string]::IsNullOrEmpty($user))    { $user    = '' }
    $env:Path = ($machine.TrimEnd(';') + ';' + $user.TrimEnd(';')).Trim(';')
}

function Test-OllamaApiReachable {
    param([Parameter(Mandatory = $true)][string]$BaseUrl)
    $u = $BaseUrl.TrimEnd('/')
    try {
        Invoke-WebRequest -Uri ($u + '/api/tags') -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Install-NodeJsLts {
    # Returns $true if Node/npm is available after this function returns.
    # Strategy 1: winget (no UAC required on modern Windows 10/11 with App Installer)
    # Strategy 2: download Node.js LTS MSI from nodejs.org with per-user (no UAC) flags
    # If both fail: return $false so the caller can emit node_required_manual and exit 6.
    [OutputType([bool])]
    param()

    $wingetCmd = $null
    try {
        $wgList = @(Get-Command winget -CommandType Application -ErrorAction SilentlyContinue)
        if ($wgList.Count -ge 1 -and -not [string]::IsNullOrWhiteSpace($wgList[0].Source)) {
            $wingetCmd = [string]$wgList[0].Source
        }
    } catch { }

    if ($wingetCmd) {
        Write-UiLine '[ensure-openclaw] winget found — installing Node.js LTS...' -ForegroundColor Yellow
        Write-Output '[ensure-openclaw] ui=node_install_winget'
        try {
            & $wingetCmd install --id OpenJS.NodeJS.LTS --source winget `
                --accept-package-agreements --accept-source-agreements --silent
            # 0 = success; -1978335135 (0x8A150021) = already installed
            if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335135) {
                Sync-PathFromRegistry
                $chk = @(Get-Command npm -CommandType Application -ErrorAction SilentlyContinue)
                if ($chk.Count -ge 1) {
                    Write-UiLine '[ensure-openclaw] Node.js installed via winget.' -ForegroundColor Green
                    return $true
                }
            }
        } catch { }
        Write-Output '[ensure-openclaw] winget install Node.js failed or npm not in PATH yet; trying MSI...'
    }

    # Strategy 2: download Node.js LTS MSI and run with per-user (ALLUSERS="") — no UAC needed
    Write-UiLine '[ensure-openclaw] Downloading Node.js LTS installer from nodejs.org...' -ForegroundColor Yellow
    Write-Output '[ensure-openclaw] ui=node_install_msi'

    $arch = if (
        [System.Environment]::Is64BitOperatingSystem -and
        [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq
        [System.Runtime.InteropServices.Architecture]::Arm64
    ) { 'arm64' } else { 'x64' }
    $nodeVersion = '22.16.0'
    $msiUrl  = ('https://nodejs.org/dist/v{0}/node-v{0}-{1}.msi' -f $nodeVersion, $arch)
    $tmpMsi  = Join-Path ([System.IO.Path]::GetTempPath()) ('node-lts-{0}.msi' -f [guid]::NewGuid())

    try {
        Invoke-WebRequest -Uri $msiUrl -OutFile $tmpMsi -UseBasicParsing -TimeoutSec 600 -ErrorAction Stop

        if (-not (Test-Path -LiteralPath $tmpMsi)) {
            throw 'Node.js MSI not written to disk.'
        }
        $sz = (Get-Item -LiteralPath $tmpMsi).Length
        if ($sz -lt 1048576) {
            throw ('Node.js MSI too small ({0} bytes) — download may be incomplete.' -f $sz)
        }

        # ALLUSERS="" = per-user install (no UAC elevation required)
        # ADDLOCAL=ALL = include npm + add node dir to user PATH
        $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList @(
            '/i', $tmpMsi, '/qn', '/norestart', 'ADDLOCAL=ALL', 'ALLUSERS=""'
        ) -Wait -PassThru

        # 0=success, 1641=reboot initiated, 3010=success+reboot needed (rare for Node)
        if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 1641 -or $proc.ExitCode -eq 3010) {
            Sync-PathFromRegistry
            $chk = @(Get-Command npm -CommandType Application -ErrorAction SilentlyContinue)
            if ($chk.Count -ge 1) {
                Write-UiLine '[ensure-openclaw] Node.js LTS installed from nodejs.org.' -ForegroundColor Green
                return $true
            }
            # Per-user MSI may install to %LocalAppData%\Programs\nodejs; manually add to session PATH
            $localNode = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\nodejs'
            if (Test-Path -LiteralPath $localNode) {
                $env:Path = $env:Path + ';' + $localNode
                $chk2 = @(Get-Command npm -CommandType Application -ErrorAction SilentlyContinue)
                if ($chk2.Count -ge 1) {
                    Write-UiLine '[ensure-openclaw] Node.js installed (user-local path patched into session).' -ForegroundColor Green
                    return $true
                }
            }
        }
        Write-Output ('[ensure-openclaw] Node.js MSI installer exited with code: {0}' -f $proc.ExitCode)
    } catch {
        Write-Output ('[ensure-openclaw] Node.js MSI download/install error: {0}' -f $_)
    } finally {
        if (Test-Path -LiteralPath $tmpMsi) {
            Remove-Item -LiteralPath $tmpMsi -Force -ErrorAction SilentlyContinue
        }
    }
    return $false
}

function Test-OpenclawOnPath {
    try {
        # Get-Command may return an array when multiple PATHEXT entries match;
        # .Source would become string[], which cannot bind to [string].
        $cmds = @(Get-Command openclaw -CommandType Application -ErrorAction Stop)
        if ($cmds.Count -lt 1) { return $null }
        $src = $cmds[0].Source
        if ([string]::IsNullOrWhiteSpace($src)) { return $null }
        return [string]$src
    } catch {
        return $null
    }
}

function Invoke-OpenclawOnboardNonInteractive {
    param(
        [Parameter(Mandatory = $true)]
        [string]$OpenclawExe,
        [ValidateSet('pollinations', 'ollama', 'skip')]
        [string]$AuthChoice,
        [string]$ModelId,
        [string]$BaseUrl,
        [string]$PollinationsKey,
        [string]$PollinationsModel,
        [int]$Port,
        [switch]$SkipHealthCheck,
        [switch]$InstallGatewayDaemon
    )

    $onboardArgs = [System.Collections.Generic.List[string]]::new()
    $onboardArgs.Add('onboard')
    $onboardArgs.Add('--non-interactive')
    $onboardArgs.Add('--accept-risk')
    $onboardArgs.Add('--mode')
    $onboardArgs.Add('local')
    $onboardArgs.Add('--flow')
    $onboardArgs.Add('quickstart')
    if ($AuthChoice -eq 'pollinations') {
        $onboardArgs.Add('--auth-choice')
        $onboardArgs.Add('custom-api-key')
        $onboardArgs.Add('--custom-base-url')
        $onboardArgs.Add('https://gen.pollinations.ai/v1')
        $onboardArgs.Add('--custom-model-id')
        $onboardArgs.Add($PollinationsModel)
        $onboardArgs.Add('--custom-compatibility')
        $onboardArgs.Add('openai')
        $onboardArgs.Add('--custom-api-key')
        $onboardArgs.Add($PollinationsKey)
        $onboardArgs.Add('--secret-input-mode')
        $onboardArgs.Add('plaintext')
    } else {
        $onboardArgs.Add('--auth-choice')
        $onboardArgs.Add($AuthChoice)
        if ($AuthChoice -eq 'ollama') {
            if (-not [string]::IsNullOrWhiteSpace($BaseUrl)) {
                $onboardArgs.Add('--custom-base-url')
                $onboardArgs.Add($BaseUrl)
            }
            if (-not [string]::IsNullOrWhiteSpace($ModelId)) {
                $onboardArgs.Add('--custom-model-id')
                $onboardArgs.Add($ModelId)
            }
        }
    }
    $onboardArgs.Add('--gateway-port')
    $onboardArgs.Add("$Port")
    $onboardArgs.Add('--gateway-bind')
    $onboardArgs.Add('loopback')
    if ($InstallGatewayDaemon) {
        $onboardArgs.Add('--install-daemon')
        $onboardArgs.Add('--daemon-runtime')
        $onboardArgs.Add('node')
    }
    $onboardArgs.Add('--skip-channels')
    $onboardArgs.Add('--skip-search')
    $onboardArgs.Add('--skip-skills')
    $onboardArgs.Add('--skip-ui')
    if ($SkipHealthCheck) {
        $onboardArgs.Add('--skip-health')
    }

    $flowDesc = switch ($AuthChoice) {
        'pollinations' { 'QuickStart + Pollinations (OpenAI-compatible) + skip channels/search/skills/ui' }
        'ollama'       { 'QuickStart + Ollama + skip channels/search/skills/ui' }
        default        { 'QuickStart + skip auth + skip channels/search/skills/ui' }
    }
    Write-UiLine ('[ensure-openclaw] Running non-interactive onboard ({0})...' -f $flowDesc) -ForegroundColor Yellow
    if ($InstallGatewayDaemon) {
        Write-UiLine '[ensure-openclaw] -InstallGatewayDaemon enabled: registering official Gateway scheduled task (may open a separate CMD window).' -ForegroundColor DarkGray
    } else {
        Write-UiLine '[ensure-openclaw] No Gateway scheduled task installed; DidClaw will launch the local gateway as a hidden child process.' -ForegroundColor DarkGray
    }
    Write-UiLine '[ensure-openclaw] Docs: https://docs.openclaw.ai/start/wizard' -ForegroundColor DarkGray
    Write-Output '[ensure-openclaw] ui=onboard_exec'

    & $OpenclawExe @($onboardArgs.ToArray())
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw ('openclaw onboard exited with code: {0}' -f $LASTEXITCODE)
    }
}

Write-Output '[ensure-openclaw] ui=env_begin'
Sync-PathFromRegistry
Write-Output '[ensure-openclaw] ui=env_path_ok'
try {
    $nc = @(Get-Command node -CommandType Application -ErrorAction SilentlyContinue)
    if ($nc.Count -ge 1 -and -not [string]::IsNullOrWhiteSpace($nc[0].Source)) {
        Write-Output '[ensure-openclaw] ui=node_ok'
    } else {
        Write-Output '[ensure-openclaw] ui=node_not_found'
    }
} catch {
    Write-Output '[ensure-openclaw] ui=node_not_found'
}
$openclawExe = Test-OpenclawOnPath

if (-not $openclawExe) {
    Write-Output '[ensure-openclaw] ui=stage_cli_install_begin'

    # Primary path: if npm is available (Node already installed), run
    #   npm install -g openclaw@latest  directly — faster and does not depend on
    #   https://openclaw.ai/install.ps1 being reachable.
    # Fallback path: download the official install.ps1 when npm is not found
    #   (the official script handles Node installation as well).
    $npmCmd = $null
    try {
        $nc2 = @(Get-Command npm -CommandType Application -ErrorAction SilentlyContinue)
        if ($nc2.Count -ge 1 -and -not [string]::IsNullOrWhiteSpace($nc2[0].Source)) {
            $npmCmd = [string]$nc2[0].Source
        }
    } catch { }

    if ($npmCmd) {
        Write-UiLine '[ensure-openclaw] npm found — installing openclaw@latest via npm...' -ForegroundColor Yellow
        Write-Output '[ensure-openclaw] ui=running_official_install_ps1_wait'
        try {
            & $npmCmd install -g openclaw@latest
            if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
                throw ('npm install -g openclaw@latest exited with code: {0}' -f $LASTEXITCODE)
            }
            Write-Output '[ensure-openclaw] ui=official_install_ps1_finished'
        } catch {
            Write-Output ('[ensure-openclaw] npm install failed: {0}' -f $_)
            exit 1
        }
    } else {
        # No npm found — Node.js is not installed.
        # Try to install Node.js automatically (winget, then nodejs.org MSI per-user).
        Write-Output '[ensure-openclaw] ui=node_install_begin'
        $nodeReady = Install-NodeJsLts

        if (-not $nodeReady) {
            # All automatic methods failed — ask the user to install Node.js manually.
            Write-Output '[ensure-openclaw] ui=node_required_manual'
            Write-Output '[ensure-openclaw] Automatic Node.js install failed. Please download and install Node.js manually:'
            Write-Output '[ensure-openclaw] https://nodejs.org/en/download'
            Write-Output '[ensure-openclaw] After installation, restart DidClaw and click Retry.'
            exit 6
        }

        # Re-discover npm after Node install
        $npmCmd = $null
        try {
            $nc3 = @(Get-Command npm -CommandType Application -ErrorAction SilentlyContinue)
            if ($nc3.Count -ge 1 -and -not [string]::IsNullOrWhiteSpace($nc3[0].Source)) {
                $npmCmd = [string]$nc3[0].Source
            }
        } catch { }

        if (-not $npmCmd) {
            Write-Output '[ensure-openclaw] ui=node_required_manual'
            Write-Output '[ensure-openclaw] Node.js was installed but npm is not yet in PATH. Please restart DidClaw and click Retry, or open a new terminal and run: npm install -g openclaw@latest'
            exit 6
        }

        Write-UiLine '[ensure-openclaw] Node.js ready — installing openclaw@latest...' -ForegroundColor Yellow
        Write-Output '[ensure-openclaw] ui=running_official_install_ps1_wait'
        try {
            & $npmCmd install -g openclaw@latest
            if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
                throw ('npm install -g openclaw@latest exited with code: {0}' -f $LASTEXITCODE)
            }
            Write-Output '[ensure-openclaw] ui=official_install_ps1_finished'
        } catch {
            Write-Output ('[ensure-openclaw] npm install failed: {0}' -f $_)
            exit 1
        }
    }

    Sync-PathFromRegistry
    $openclawExe = Test-OpenclawOnPath
    if (-not $openclawExe) {
        Write-Output '[ensure-openclaw] Install completed but openclaw is still not found in PATH. Check npm global bin dir (run: npm prefix -g) and ensure it is in your PATH.'
        exit 2
    }

    Write-UiLine ('[ensure-openclaw] CLI installed: {0}' -f $openclawExe) -ForegroundColor Green
} else {
    Write-Output '[ensure-openclaw] ui=openclaw_already_installed'
    Write-UiLine ('[ensure-openclaw] openclaw already installed: {0} — skipping CLI install.' -f $openclawExe) -ForegroundColor Green
}

if ($SkipOnboard) {
    Write-UiLine '[ensure-openclaw] -SkipOnboard specified, skipping onboard.' -ForegroundColor DarkGray
    Write-Output '[ensure-openclaw] ui=skip_onboard_exit'
    exit 0
}

$effectiveAuth = $OnboardAuthChoice
$pollinationsKeyResolved = $PollinationsApiKey
if ([string]::IsNullOrWhiteSpace($pollinationsKeyResolved)) {
    $pollinationsKeyResolved = [Environment]::GetEnvironmentVariable('POLLINATIONS_API_KEY', 'User')
}
if ([string]::IsNullOrWhiteSpace($pollinationsKeyResolved)) {
    $pollinationsKeyResolved = [Environment]::GetEnvironmentVariable('POLLINATIONS_API_KEY', 'Machine')
}
if ([string]::IsNullOrWhiteSpace($pollinationsKeyResolved)) {
    $pollinationsKeyResolved = $env:POLLINATIONS_API_KEY
}

if ($effectiveAuth -eq 'pollinations' -and [string]::IsNullOrWhiteSpace($pollinationsKeyResolved)) {
    if ($RequirePollinationsApiKey) {
        Write-UiLine '[ensure-openclaw] Pollinations selected and -RequirePollinationsApiKey set, but no API key provided.' -ForegroundColor Red
        Write-UiLine '  Register at https://enter.pollinations.ai/ to get a sk_ key, then:' -ForegroundColor Yellow
        Write-UiLine '  Set env var POLLINATIONS_API_KEY, or pass: -PollinationsApiKey ''sk_...''' -ForegroundColor DarkGray
        exit 5
    }
    Write-UiLine '[ensure-openclaw] POLLINATIONS_API_KEY not found — switching to --auth-choice skip to complete onboard (config files written; no scheduled task).' -ForegroundColor Yellow
    Write-UiLine '  You can set the key later and re-run this script (onboard only), or configure in DidClaw settings.' -ForegroundColor DarkGray
    Write-UiLine '  Register: https://enter.pollinations.ai/' -ForegroundColor DarkGray
    $effectiveAuth = 'skip'
}

if ($effectiveAuth -eq 'ollama' -and -not $SkipOllamaPreflight) {
    if (-not (Test-OllamaApiReachable -BaseUrl $OllamaBaseUrl)) {
        Write-UiLine ('[ensure-openclaw] Ollama HTTP API not reachable ({0}/api/tags).' -f ($OllamaBaseUrl.TrimEnd('/'))) -ForegroundColor Yellow
        Write-UiLine '  To use local inference: install and start Ollama — https://ollama.com/download or: winget install Ollama.Ollama' -ForegroundColor DarkGray
        Write-UiLine '  To use cloud models only: ignore this, or add -SkipOllamaPreflight to suppress.' -ForegroundColor DarkGray
        Write-UiLine '  Unattended without Ollama: add -OnboardAuthChoice skip or -FallbackToSkipAuthIfOllamaUnreachable.' -ForegroundColor DarkGray
        if ($FallbackToSkipAuthIfOllamaUnreachable) {
            Write-UiLine '[ensure-openclaw] -FallbackToSkipAuthIfOllamaUnreachable enabled — onboard will use --auth-choice skip (configure model later).' -ForegroundColor Yellow
            $effectiveAuth = 'skip'
        } elseif ($FailIfOllamaUnreachable) {
            exit 4
        }
    }
}

Write-Output '[ensure-openclaw] ui=onboard_prepare'
try {
    Invoke-OpenclawOnboardNonInteractive -OpenclawExe $openclawExe -AuthChoice $effectiveAuth `
        -ModelId $OllamaModelId -BaseUrl $OllamaBaseUrl `
        -PollinationsKey $pollinationsKeyResolved -PollinationsModel $PollinationsModelId `
        -Port $GatewayPort -SkipHealthCheck:$SkipHealth -InstallGatewayDaemon:$InstallGatewayDaemon
} catch {
    Write-UiLine ('[ensure-openclaw] onboard failed: {0}' -f $_) -ForegroundColor Red
    exit 3
}

Write-Output '[ensure-openclaw] ui=script_finished_ok'
Write-UiLine '[ensure-openclaw] onboard complete.' -ForegroundColor Green
exit 0
